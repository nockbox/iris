/**
 * Zustand store for popup UI state and navigation
 */

import { create } from 'zustand';
import { INTERNAL_METHODS, APPROVAL_CONSTANTS, NOCK_TO_NICKS } from '../shared/constants';
import { hasIncompleteOnboarding } from '../shared/onboarding';
import {
  Account,
  AccountBalance,
  TransactionDetails,
  SignRequest,
  SignRawTxRequest,
  TransactionRequest,
  ConnectRequest,
  WalletTransaction,
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
  | 'v0-migration'

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
  | 'approve-sign-raw-tx'

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
  availableBalance: number;
  spendableBalance: number; // Sum of UTXOs that are available (not in_flight) - can be spent NOW
  accountBalances: Record<string, number>; // Map of address -> confirmed balance
  accountSpendableBalances: Record<string, number>; // Map of address -> spendable balance (available UTXOs only)
  accountBalanceDetails: Record<string, AccountBalance>; // Map of address -> detailed balance
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

  // Pending sign raw transaction request (for showing approval screen)
  pendingSignRawTxRequest: SignRawTxRequest | null;
  setPendingSignRawTxRequest: (request: SignRawTxRequest | null) => void;

  // Pending transaction request (for showing approval screen)
  pendingTransactionRequest: TransactionRequest | null;
  setPendingTransactionRequest: (request: TransactionRequest | null) => void;

  // Wallet transactions for current account (from UTXO store)
  walletTransactions: WalletTransaction[];
  setWalletTransactions: (transactions: WalletTransaction[]) => void;

  // Selected transaction for viewing details
  selectedTransaction: WalletTransaction | null;
  setSelectedTransaction: (transaction: WalletTransaction | null) => void;

  // Balance fetching state
  isBalanceFetching: boolean;

  // Initialization state - true once cached balances have been loaded
  isInitialized: boolean;

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

  // Fetch wallet transactions from UTXO store
  fetchWalletTransactions: () => Promise<void>;
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
    availableBalance: 0,
    spendableBalance: 0,
    accountBalances: {},
    accountSpendableBalances: {},
    accountBalanceDetails: {},
  },

  onboardingMnemonic: null,
  lastTransaction: null,
  pendingConnectRequest: null,
  pendingSignRequest: null,
  pendingSignRawTxRequest: null,
  pendingTransactionRequest: null,
  walletTransactions: [],
  selectedTransaction: null,
  isBalanceFetching: false,
  isInitialized: false,
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

  // Set pending sign raw transaction request
  setPendingSignRawTxRequest: (request: SignRawTxRequest | null) => {
    set({ pendingSignRawTxRequest: request });
  },

  // Set pending transaction request
  setPendingTransactionRequest: (request: TransactionRequest | null) => {
    set({ pendingTransactionRequest: request });
  },

  // Set wallet transactions
  setWalletTransactions: (transactions: WalletTransaction[]) => {
    set({ walletTransactions: transactions });
  },

  // Set selected transaction for viewing details
  setSelectedTransaction: (transaction: WalletTransaction | null) => {
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

      // Initial wallet state with confirmed balances (available balance computed after TX fetch)
      const confirmedBalance = state.currentAccount
        ? cachedBalances[state.currentAccount.address] || 0
        : 0;
      const walletState: WalletState = {
        locked: state.locked,
        address: state.address || null,
        accounts: state.accounts || [],
        currentAccount: state.currentAccount || null,
        balance: confirmedBalance,
        availableBalance: confirmedBalance, // Will be recalculated after fetching transactions
        spendableBalance: confirmedBalance, // Will be recalculated after fetching transactions
        accountBalances: cachedBalances, // Load all cached balances
        accountSpendableBalances: cachedBalances, // Will be recalculated after fetching transactions
        accountBalanceDetails: {},
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
        isInitialized: true,
      });

      // Fetch balance if wallet is unlocked
      if (!walletState.locked && walletState.address) {
        get().fetchBalance();
        get().fetchWalletTransactions();
      }
    } catch (error) {
      console.error('Failed to initialize app:', error);
      // Default to locked screen on error
      set({ currentScreen: 'locked' });
    }
  },

  // Fetch balance from UTXO store for all accounts
  // Also syncs UTXOs from chain (runs in popup context where WASM works)
  fetchBalance: async () => {
    try {
      set({ isBalanceFetching: true });

      const accounts = get().wallet.accounts;
      const currentAccount = get().wallet.currentAccount;

      if (!currentAccount || accounts.length === 0) {
        set({ isBalanceFetching: false });
        return;
      }

      // Sync UTXOs from chain for all accounts (runs in popup context where WASM works)
      try {
        const { syncAccountUTXOs } = await import('../shared/utxo-sync');
        const { createBrowserClient } = await import('../shared/rpc-client-browser');
        const rpcClient = createBrowserClient();

        for (const account of accounts) {
          try {
            await syncAccountUTXOs(account.address, rpcClient);
          } catch (syncErr) {
            console.warn(`[Store] UTXO sync failed for ${account.name}:`, syncErr);
          }
        }
      } catch (importErr) {
        console.warn('[Store] Could not import sync modules:', importErr);
      }

      // Fetch UTXO store balance for ALL accounts
      const accountBalances: Record<string, number> = {};
      const accountSpendableBalances: Record<string, number> = {};

      for (const account of accounts) {
        try {
          const storeBalance = await send<{
            available: number;
            spendableNow: number;
            pendingOut: number;
            pendingChange: number;
            total: number;
            utxoCount: number;
            availableUtxoCount: number;
          }>(INTERNAL_METHODS.GET_BALANCE_FROM_STORE, [account.address]);

          // Convert from nicks to NOCK for display
          const availableNock = storeBalance.available / NOCK_TO_NICKS;
          const spendableNock = storeBalance.spendableNow / NOCK_TO_NICKS;
          accountBalances[account.address] = availableNock;
          accountSpendableBalances[account.address] = spendableNock;
        } catch (err) {
          console.warn(`[Store] Could not get balance for ${account.name}:`, err);
          // Keep previous balance if fetch fails
          accountBalances[account.address] = get().wallet.accountBalances[account.address] ?? 0;
          accountSpendableBalances[account.address] =
            get().wallet.accountSpendableBalances[account.address] ?? 0;
        }
      }

      // Get current account's detailed balance
      const currentBalance = accountBalances[currentAccount.address] ?? 0;
      const currentSpendable = accountSpendableBalances[currentAccount.address] ?? 0;

      // Persist balances to chrome.storage.local for offline access
      try {
        const { STORAGE_KEYS } = await import('../shared/constants');
        await chrome.storage.local.set({
          [STORAGE_KEYS.CACHED_BALANCES]: accountBalances,
        });
      } catch (cacheErr) {
        console.warn('[Store] Failed to cache balances:', cacheErr);
      }

      set({
        wallet: {
          ...get().wallet,
          balance: currentBalance,
          availableBalance: currentBalance,
          spendableBalance: currentSpendable,
          accountBalances,
          accountSpendableBalances,
        },
        isBalanceFetching: false,
      });
    } catch (error) {
      console.error('[Store] Failed to fetch balance:', error);
      set({ isBalanceFetching: false });
    }
  },

  // Fetch price from CoinGecko
  fetchPrice: async () => {
    try {
      set({ isPriceFetching: true });

      const { fetchNockPrice } = await import('../shared/price-api');
      const priceData = await fetchNockPrice();

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

  // Fetch wallet transactions from UTXO store
  // Called directly from popup context (not via background) to avoid service worker limitations
  fetchWalletTransactions: async () => {
    try {
      const currentAccount = get().wallet.currentAccount;
      if (!currentAccount) return;

      // Capture the address we're fetching for to detect account switches
      const fetchingForAddress = currentAccount.address;

      // Import and call directly from popup context (avoids service worker document issue)
      const { getWalletTransactions } = await import('../shared/utxo-store');
      const transactions = await getWalletTransactions(fetchingForAddress);

      // Check if user switched accounts while we were fetching
      const accountAfterFetch = get().wallet.currentAccount;
      if (accountAfterFetch?.address !== fetchingForAddress) {
        return;
      }

      set({ walletTransactions: transactions });
    } catch (error) {
      console.error('Failed to fetch wallet transactions:', error);
    }
  },
}));
