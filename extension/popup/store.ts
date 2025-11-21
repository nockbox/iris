/**
 * Zustand store for popup UI state and navigation
 */

import { create } from 'zustand';
import { INTERNAL_METHODS, APPROVAL_CONSTANTS } from '../shared/constants';
import { hasIncompleteOnboarding } from '../shared/onboarding';
import {
  Account,
  TransactionDetails,
  SignRequest,
  TransactionRequest,
  ConnectRequest,
  CachedTransaction,
} from '../shared/types';
import { send } from './utils/messaging';

/**
 * All available screens in the wallet
 */
export type Screen =
  // Onboarding flow
  | 'onboarding-start'
  | 'onboarding-create'
  | 'onboarding-backup'
  | 'onboarding-verify'
  | 'onboarding-success'
  | 'onboarding-import'
  | 'onboarding-import-success'
  | 'onboarding-resume-backup'

  // Main app screens
  | 'home'
  | 'settings'
  | 'theme-settings'
  | 'lock-time'
  | 'key-settings'
  | 'view-secret-phrase'
  | 'wallet-permissions'
  | 'wallet-settings'
  | 'wallet-styling'
  | 'about'
  | 'recovery-phrase'

  // Transaction screens
  | 'send'
  | 'send-review'
  | 'send-submitted'
  | 'sent'
  | 'receive'
  | 'tx-details'

  // Approval screens
  | 'connect-approval'
  | 'sign-message'
  | 'approve-transaction'

  // System
  | 'locked';

/**
 * Wallet state synced from background service worker
 */
interface WalletState {
  locked: boolean;
  address: string | null;
  accounts: Account[];
  currentAccount: Account | null;
  balance: number;
  accountBalances: Record<string, number>; // Map of address -> balance
}

/**
 * Main app store
 */
interface AppStore {
  // Navigation
  currentScreen: Screen;
  navigate: (screen: Screen) => void;

  // Navigation history for back button
  history: Screen[];
  goBack: () => void;

  // Wallet state (synced from service worker)
  wallet: WalletState;
  syncWallet: (state: WalletState) => void;

  // Temporary onboarding state (cleared after completion)
  onboardingMnemonic: string | null;
  setOnboardingMnemonic: (mnemonic: string | null) => void;

  // Last transaction details (for showing confirmation screen)
  lastTransaction: TransactionDetails | null;
  setLastTransaction: (transaction: TransactionDetails | null) => void;

  // Pending connect request (for showing approval screen)
  pendingConnectRequest: ConnectRequest | null;
  setPendingConnectRequest: (request: ConnectRequest | null) => void;

  // Pending sign request (for showing approval screen)
  pendingSignRequest: SignRequest | null;
  setPendingSignRequest: (request: SignRequest | null) => void;

  // Pending transaction request (for showing approval screen)
  pendingTransactionRequest: TransactionRequest | null;
  setPendingTransactionRequest: (request: TransactionRequest | null) => void;

  // Cached transactions for current account
  cachedTransactions: CachedTransaction[];
  setCachedTransactions: (transactions: CachedTransaction[]) => void;

  // Selected transaction for viewing details
  selectedTransaction: CachedTransaction | null;
  setSelectedTransaction: (transaction: CachedTransaction | null) => void;

  // Balance fetching state
  isBalanceFetching: boolean;

  // Price data
  priceUsd: number;
  priceChange24h: number;
  isPriceFetching: boolean;

  // Initialize app - checks vault status and navigates appropriately
  initialize: () => Promise<void>;

  // Fetch balance from blockchain
  fetchBalance: () => Promise<void>;

  // Fetch price from CoinGecko
  fetchPrice: () => Promise<void>;

  // Fetch cached transactions for current account
  fetchCachedTransactions: () => Promise<void>;

  // Add a sent transaction to cache
  addSentTransactionToCache: (
    txid: string,
    amount: number,
    fee: number,
    to: string
  ) => Promise<void>;

  // Update transaction status in cache
  updateTransactionStatus: (
    txid: string,
    status: 'confirmed' | 'pending' | 'failed'
  ) => Promise<void>;
}

/**
 * Create the store
 */
export const useStore = create<AppStore>((set, get) => ({
  // Initial state
  currentScreen: 'locked',
  history: [],

  wallet: {
    locked: true,
    address: null,
    accounts: [],
    currentAccount: null,
    balance: 0,
    accountBalances: {},
  },

  onboardingMnemonic: null,
  lastTransaction: null,
  pendingConnectRequest: null,
  pendingSignRequest: null,
  pendingTransactionRequest: null,
  cachedTransactions: [],
  selectedTransaction: null,
  isBalanceFetching: false,
  priceUsd: 0,
  priceChange24h: 0,
  isPriceFetching: false,

  // Navigate to a new screen
  navigate: (screen: Screen) => {
    const current = get().currentScreen;
    set({
      currentScreen: screen,
      history: [...get().history, current],
    });
  },

  // Go back to previous screen
  goBack: () => {
    const history = get().history;
    if (history.length === 0) return;

    const previous = history[history.length - 1];
    set({
      currentScreen: previous,
      history: history.slice(0, -1),
    });
  },

  // Sync wallet state from background
  syncWallet: (state: WalletState) => {
    set({ wallet: state });
  },

  // Set temporary mnemonic during onboarding
  setOnboardingMnemonic: (mnemonic: string | null) => {
    set({ onboardingMnemonic: mnemonic });
  },

  // Set last transaction details
  setLastTransaction: (transaction: TransactionDetails | null) => {
    set({ lastTransaction: transaction });
  },

  // Set pending connect request
  setPendingConnectRequest: (request: ConnectRequest | null) => {
    set({ pendingConnectRequest: request });
  },

  // Set pending sign request
  setPendingSignRequest: (request: SignRequest | null) => {
    set({ pendingSignRequest: request });
  },

  // Set pending transaction request
  setPendingTransactionRequest: (request: TransactionRequest | null) => {
    set({ pendingTransactionRequest: request });
  },

  // Set cached transactions
  setCachedTransactions: (transactions: CachedTransaction[]) => {
    set({ cachedTransactions: transactions });
  },

  // Set selected transaction for viewing details
  setSelectedTransaction: (transaction: CachedTransaction | null) => {
    set({ selectedTransaction: transaction });
  },

  // Initialize app on load
  initialize: async () => {
    try {
      // Check if we're opening for an approval request
      const hash = window.location.hash.slice(1); // Remove '#'
      const isApprovalRequest =
        hash.startsWith(APPROVAL_CONSTANTS.CONNECT_HASH_PREFIX) ||
        hash.startsWith(APPROVAL_CONSTANTS.TRANSACTION_HASH_PREFIX) ||
        hash.startsWith(APPROVAL_CONSTANTS.SIGN_MESSAGE_HASH_PREFIX);

      // Get current vault state from service worker
      const state = await send<{
        locked: boolean;
        hasVault: boolean;
        address: string;
        accounts: Account[];
        currentAccount: Account | null;
      }>(INTERNAL_METHODS.GET_STATE);

      // Load cached balances from storage (for offline access)
      const { STORAGE_KEYS } = await import('../shared/constants');
      const stored = await chrome.storage.local.get([STORAGE_KEYS.CACHED_BALANCES]);
      const cachedBalances = (stored[STORAGE_KEYS.CACHED_BALANCES] || {}) as Record<string, number>;

      const walletState: WalletState = {
        locked: state.locked,
        address: state.address || null,
        accounts: state.accounts || [],
        currentAccount: state.currentAccount || null,
        balance: state.currentAccount ? cachedBalances[state.currentAccount.address] || 0 : 0,
        accountBalances: cachedBalances, // Load all cached balances
      };

      // Determine initial screen
      let initialScreen: Screen;

      if (isApprovalRequest) {
        // For approval requests, don't override the screen
        // Let the approval useEffect handle navigation
        initialScreen = walletState.locked ? 'locked' : 'home';
      } else if (!state.hasVault) {
        // No vault exists - start onboarding
        initialScreen = 'onboarding-start';
      } else {
        // Check if user has incomplete onboarding (created wallet but didn't complete backup)
        const incompleteOnboarding = await hasIncompleteOnboarding();

        if (incompleteOnboarding) {
          // User needs to complete their backup - show resume screen
          initialScreen = 'onboarding-resume-backup';
        } else if (walletState.locked) {
          // Vault exists but locked
          initialScreen = 'locked';
        } else {
          // Vault unlocked - go to home
          initialScreen = 'home';
        }
      }

      set({
        wallet: walletState,
        currentScreen: initialScreen,
      });

      // Fetch balance if wallet is unlocked
      console.log('[Store] Initialize complete. Wallet state:', {
        locked: walletState.locked,
        hasAddress: !!walletState.address,
        address: walletState.address?.slice(0, 20) + '...',
      });

      if (!walletState.locked && walletState.address) {
        console.log('[Store] Triggering automatic balance fetch...');
        get().fetchBalance();
        get().fetchCachedTransactions();
      } else {
        console.log('[Store] Skipping balance fetch - wallet is locked or no address');
      }
    } catch (error) {
      console.error('Failed to initialize app:', error);
      // Default to locked screen on error
      set({ currentScreen: 'locked' });
    }
  },

  // Fetch balance from blockchain
  fetchBalance: async () => {
    try {
      set({ isBalanceFetching: true });
      console.log('[Store] Fetching balance from blockchain...');

      // Import balance query functions lazily to avoid circular dependencies
      const { createBrowserClient } = await import('../shared/rpc-client-browser');
      const { queryV1Balance } = await import('../shared/balance-query');
      const { STORAGE_KEYS } = await import('../shared/constants');

      const currentAccount = get().wallet.currentAccount;
      if (!currentAccount) {
        console.error('[Store] No current account');
        set({ isBalanceFetching: false });
        return;
      }

      // Run balance query directly in popup context (not service worker)
      // This avoids WASM initialization issues in service worker
      const rpcClient = createBrowserClient();
      const balanceResult = await queryV1Balance(currentAccount.address, rpcClient);

      console.log('[Store] ✅ Balance fetched:', balanceResult.totalNock, 'NOCK');

      const currentWallet = get().wallet;
      const updatedBalances = {
        ...currentWallet.accountBalances,
        [currentAccount.address]: balanceResult.totalNock || 0,
      };

      // Save updated balances to storage for offline access
      await chrome.storage.local.set({
        [STORAGE_KEYS.CACHED_BALANCES]: updatedBalances,
      });

      set({
        wallet: {
          ...currentWallet,
          balance: balanceResult.totalNock || 0,
          accountBalances: updatedBalances,
        },
        isBalanceFetching: false,
      });
    } catch (error) {
      console.error('[Store] Failed to fetch balance:', error);
      // Don't reset balance on error - keep showing cached value
      // Offline doesn't mean zero balance
      set({ isBalanceFetching: false });
    }
  },

  // Fetch price from CoinGecko
  fetchPrice: async () => {
    try {
      set({ isPriceFetching: true });
      console.log('[Store] Fetching NOCK price from CoinGecko...');

      const { fetchNockPrice } = await import('../shared/price-api');
      const priceData = await fetchNockPrice();

      console.log('[Store] Price fetched:', priceData);

      set({
        priceUsd: priceData.usd,
        priceChange24h: priceData.usd_24h_change,
        isPriceFetching: false,
      });
    } catch (error) {
      console.error('[Store] Failed to fetch price:', error);
      set({ isPriceFetching: false });
    }
  },

  // Fetch cached transactions for current account
  fetchCachedTransactions: async () => {
    try {
      const currentAccount = get().wallet.currentAccount;
      if (!currentAccount) return;

      const result = await send<{ transactions: CachedTransaction[] }>(
        INTERNAL_METHODS.GET_CACHED_TRANSACTIONS,
        [currentAccount.address]
      );

      set({ cachedTransactions: result.transactions || [] });
    } catch (error) {
      console.error('Failed to fetch cached transactions:', error);
    }
  },

  // Add a sent transaction to cache
  addSentTransactionToCache: async (txid: string, amount: number, fee: number, to: string) => {
    try {
      const currentAccount = get().wallet.currentAccount;
      if (!currentAccount) return;

      const transaction: CachedTransaction = {
        txid,
        type: 'sent',
        amount,
        fee,
        address: to,
        timestamp: Date.now(),
        status: 'pending',
        priceUsd: get().priceUsd > 0 ? get().priceUsd : undefined, // Include USD price if available
      };

      await send(INTERNAL_METHODS.ADD_TRANSACTION_TO_CACHE, [currentAccount.address, transaction]);

      // Refresh cached transactions
      await get().fetchCachedTransactions();
    } catch (error) {
      console.error('Failed to add transaction to cache:', error);
    }
  },

  // Update transaction status
  updateTransactionStatus: async (txid: string, status: 'confirmed' | 'pending' | 'failed') => {
    try {
      const currentAccount = get().wallet.currentAccount;
      if (!currentAccount) return;

      await send(INTERNAL_METHODS.UPDATE_TRANSACTION_STATUS, [
        currentAccount.address,
        txid,
        status,
      ]);

      // Refresh cached transactions to show updated status
      await get().fetchCachedTransactions();
    } catch (error) {
      console.error('Failed to update transaction status:', error);
    }
  },
}));
