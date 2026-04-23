/**
 * Zustand store for popup UI state and navigation
 */

import { create } from 'zustand';
import { INTERNAL_METHODS, APPROVAL_CONSTANTS, NOCK_TO_NICKS } from '../shared/constants';
import { clearOnboardingState, hasIncompleteOnboarding } from '../shared/onboarding';
import {
  SubAccount,
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
  | 'wallet-add-start'
  | 'wallet-add-create'
  | 'wallet-add-import'
  | 'wallet-add-backup'
  | 'wallet-add-verify'

  // Main app screens
  | 'home'
  | 'settings'
  | 'theme-settings'
  | 'lock-time'
  | 'key-settings'
  | 'rpc-settings'
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
  | 'approve-sign-raw-tx'

  // System
  | 'locked';

/**
 * Wallet state synced from background service worker
 */
interface WalletState {
  locked: boolean;
  address: string | null;
  accounts: SubAccount[];
  seedSources: Array<{
    id: string;
    name: string;
    type: 'mnemonic' | 'external';
    createdAt: number;
    accounts: SubAccount[];
  }>;
  currentAccount: SubAccount | null;
  activeSeedSourceId: string | null;
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
  refreshWalletAccounts: () => Promise<void>;
  /** @param importedExistingPhrase - if true, scan chain for funded sub-wallets (import path only). */
  createMnemonicSeedSource: (
    mnemonic?: string,
    name?: string,
    importedExistingPhrase?: boolean
  ) => Promise<any>;
  createExternalSeedSource: (params: {
    address: string;
    name?: string;
    provider?: 'ledger' | 'unknown';
    sourceRef?: string;
    accountRef?: string;
  }) => Promise<any>;
  createChildAccount: (seedAccountId?: string, name?: string) => Promise<any>;

  // Temporary onboarding state (cleared after completion)
  onboardingMnemonic: string | null;
  setOnboardingMnemonic: (mnemonic: string | null) => void;
  /** Password held only until main onboarding SETUP runs after verify (never persisted). */
  onboardingPassword: string | null;
  setOnboardingPassword: (password: string | null) => void;

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

  // Account whose settings are being viewed (set when opening settings from dropdown; avoids waiting for account switch)
  settingsAccountAddress: string | null;
  setSettingsAccountAddress: (address: string | null) => void;

  // Balance fetching state
  isBalanceFetching: boolean;

  // Initialization state - true once cached balances have been loaded
  isInitialized: boolean;

  // Price data
  priceUsd: number;
  priceChange24h: number;
  isPriceFetching: boolean;

  // RPC display config (currency symbol hardcoded; block explorer URL from RPC settings)
  currencySymbol: string;
  blockExplorerUrl: string;
  refreshRpcDisplayConfig: () => Promise<void>;

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
    seedSources: [],
    currentAccount: null,
    activeSeedSourceId: null,
    balance: 0,
    availableBalance: 0,
    spendableBalance: 0,
    accountBalances: {},
    accountSpendableBalances: {},
    accountBalanceDetails: {},
  },

  onboardingMnemonic: null,
  onboardingPassword: null,
  lastTransaction: null,
  pendingConnectRequest: null,
  pendingSignRequest: null,
  pendingSignRawTxRequest: null,
  pendingTransactionRequest: null,
  walletTransactions: [],
  selectedTransaction: null,
  settingsAccountAddress: null,
  setSettingsAccountAddress: (address: string | null) => set({ settingsAccountAddress: address }),
  isBalanceFetching: false,
  isInitialized: false,
  priceUsd: 0,
  priceChange24h: 0,
  isPriceFetching: false,

  currencySymbol: 'NOCK',
  blockExplorerUrl: 'https://nockscan.net',

  refreshRpcDisplayConfig: async () => {
    try {
      const { getEffectiveRpcConfig } = await import('../shared/rpc-config');
      const config = await getEffectiveRpcConfig();
      set({ blockExplorerUrl: config.blockExplorerUrl });
    } catch {
      // Keep defaults on error
    }
  },

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

  refreshWalletAccounts: async () => {
    try {
      const [accountsResult, seedSourcesResult, cachedBalancesResult] = await Promise.all([
        send<{
          accounts: SubAccount[];
          currentAccount: SubAccount | null;
          activeSeedSourceId: string | null;
        }>(INTERNAL_METHODS.GET_ACCOUNTS),
        send<{ seedSources: WalletState['seedSources'] }>(INTERNAL_METHODS.GET_SEED_SOURCES),
        send<{ balances?: Record<string, number> }>(INTERNAL_METHODS.GET_CACHED_BALANCES).catch(
          () => ({ balances: undefined })
        ),
      ]);

      const accounts = accountsResult.accounts || [];
      const fetchedBalances = cachedBalancesResult?.balances;
      const mergedAccountBalances = fetchedBalances
        ? { ...get().wallet.accountBalances, ...fetchedBalances }
        : get().wallet.accountBalances;

      set({
        wallet: {
          ...get().wallet,
          accounts,
          seedSources: seedSourcesResult?.seedSources || [],
          currentAccount: accountsResult.currentAccount || null,
          address: accountsResult.currentAccount?.address || null,
          activeSeedSourceId: accountsResult.activeSeedSourceId || null,
          accountBalances: mergedAccountBalances,
        },
      });
    } catch (error) {
      console.error('[Store] Failed to refresh wallet accounts:', error);
    }
  },

  createMnemonicSeedSource: async (mnemonic?: string, name?: string, importedExistingPhrase?: boolean) => {
    const result = await send<any>(INTERNAL_METHODS.CREATE_MNEMONIC_SEED_SOURCE, [
      mnemonic,
      name,
      importedExistingPhrase === true,
    ]);
    if (!result?.error) {
      await get().refreshWalletAccounts();
      // Non-blocking refresh: avoid delaying backup flow UX.
      void get().fetchBalance();
      void get().fetchWalletTransactions();
    }
    return result;
  },

  createExternalSeedSource: async params => {
    const result = await send<any>(INTERNAL_METHODS.CREATE_EXTERNAL_SEED_SOURCE, [params]);
    if (!result?.error) {
      await get().refreshWalletAccounts();
      // Non-blocking refresh to keep wallet actions snappy.
      void get().fetchBalance();
      void get().fetchWalletTransactions();
    }
    return result;
  },

  createChildAccount: async (seedAccountId?: string, name?: string) => {
    const result = await send<any>(INTERNAL_METHODS.CREATE_CHILD_ACCOUNT, [seedAccountId, name]);
    if (!result?.error) {
      await get().refreshWalletAccounts();
      // Non-blocking refresh to avoid blocking dropdown interactions.
      void get().fetchBalance();
      void get().fetchWalletTransactions();
    }
    return result;
  },

  // Set temporary mnemonic during onboarding
  setOnboardingMnemonic: (mnemonic: string | null) => {
    set({ onboardingMnemonic: mnemonic });
  },

  setOnboardingPassword: (password: string | null) => {
    set({ onboardingPassword: password });
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
        accounts: SubAccount[];
        currentAccount: SubAccount | null;
        activeSeedSourceId: string | null;
      }>(INTERNAL_METHODS.GET_STATE);

      // Load cached balances and seed sources from encrypted storage (only if unlocked)
      let cachedBalances: Record<string, number> = {};
      let seedSources: WalletState['seedSources'] = [];
      if (!state.locked) {
        const [balanceResp, seedSourcesResp] = await Promise.all([
          send<{ ok?: boolean; balances?: Record<string, number> }>(
            INTERNAL_METHODS.GET_CACHED_BALANCES
          ),
          send<{ seedSources: WalletState['seedSources'] }>(INTERNAL_METHODS.GET_SEED_SOURCES),
        ]);
        if (balanceResp?.ok && balanceResp.balances) {
          cachedBalances = balanceResp.balances;
        }
        seedSources = seedSourcesResp?.seedSources || [];
      }

      // Initial wallet state with confirmed balances (available balance computed after TX fetch)
      const confirmedBalance = state.currentAccount
        ? cachedBalances[state.currentAccount.address] || 0
        : 0;
      const accounts = state.accounts || [];
      const walletState: WalletState = {
        locked: state.locked,
        address: state.address || null,
        accounts,
        seedSources,
        currentAccount: state.currentAccount || null,
        activeSeedSourceId: state.activeSeedSourceId || null,
        balance: confirmedBalance,
        availableBalance: confirmedBalance,
        spendableBalance: confirmedBalance,
        accountBalances: cachedBalances,
        accountSpendableBalances: cachedBalances,
        accountBalanceDetails: {},
      };

      // Determine initial screen
      let initialScreen: Screen;

      if (isApprovalRequest) {
        // For approval requests, don't override the screen
        // Let the approval useEffect handle navigation
        initialScreen = walletState.locked ? 'locked' : 'home';
      } else if (!state.hasVault) {
        const incompleteOnboardingNoVault = await hasIncompleteOnboarding();
        if (incompleteOnboardingNoVault) {
          await clearOnboardingState();
        }
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

      await get().refreshRpcDisplayConfig();

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
      // Don't attempt to sync UTXOs while the vault is locked. SYNC_UTXOS
      // requires the encryption key to persist results; calling it while locked
      // yields cascading "Cannot save account data" / "Vault is locked" errors.
      if (get().wallet.locked) {
        set({ isBalanceFetching: false });
        return;
      }

      set({ isBalanceFetching: true });

      const accounts = get().wallet.accounts;
      const currentAccount = get().wallet.currentAccount;

      if (!currentAccount || accounts.length === 0) {
        set({ isBalanceFetching: false });
        return;
      }

      // Only sync + fetch balance for the currently-selected account. Other
      // accounts keep whatever cached balances they had; they'll be refreshed
      // when the user switches to them. This avoids scaling balance-refresh
      // latency with wallet count.
      try {
        const syncResult = await send<{
          ok: boolean;
          results?: Record<string, { success: boolean; error?: string }>;
        }>(INTERNAL_METHODS.SYNC_UTXOS, [currentAccount.address]);
        if (!syncResult.ok) {
          console.warn('[Store] UTXO sync failed:', syncResult);
        }
      } catch (syncErr) {
        console.warn('[Store] UTXO sync error:', syncErr);
      }

      // Start from existing cached balances so non-current accounts keep their
      // last-known values in the UI.
      const accountBalances: Record<string, number> = { ...get().wallet.accountBalances };
      const accountSpendableBalances: Record<string, number> = {
        ...get().wallet.accountSpendableBalances,
      };
      const accountBalanceDetails: Record<string, AccountBalance> = {
        ...get().wallet.accountBalanceDetails,
      };

      try {
        const storeBalance = await send<{
          available: number;
          spendableNow: number;
          pendingOut: number;
          pendingChange: number;
          total: number;
          utxoCount: number;
          availableUtxoCount: number;
        }>(INTERNAL_METHODS.GET_BALANCE_FROM_STORE, [currentAccount.address]);

        // Convert from nicks to NOCK for display
        const availableNock = storeBalance.available / NOCK_TO_NICKS;
        const spendableNock = storeBalance.spendableNow / NOCK_TO_NICKS;
        const totalNock = storeBalance.total / NOCK_TO_NICKS;
        const pendingOutNock = storeBalance.pendingOut / NOCK_TO_NICKS;
        accountBalances[currentAccount.address] = availableNock;
        accountSpendableBalances[currentAccount.address] = spendableNock;
        accountBalanceDetails[currentAccount.address] = {
          confirmed: totalNock,
          pendingOut: pendingOutNock,
          pendingIn: 0,
          available: availableNock,
        };
      } catch (err) {
        console.warn(`[Store] Could not get balance for ${currentAccount.name}:`, err);
        // Keep previous balance if fetch fails
        if (accountBalances[currentAccount.address] === undefined) {
          accountBalances[currentAccount.address] = 0;
        }
        if (accountSpendableBalances[currentAccount.address] === undefined) {
          accountSpendableBalances[currentAccount.address] = 0;
        }
        if (accountBalanceDetails[currentAccount.address] === undefined) {
          accountBalanceDetails[currentAccount.address] = {
            confirmed: accountBalances[currentAccount.address],
            pendingOut: 0,
            pendingIn: 0,
            available: accountBalances[currentAccount.address],
          };
        }
      }

      // Get current account's detailed balance
      const currentBalance = accountBalances[currentAccount.address] ?? 0;
      const currentSpendable = accountSpendableBalances[currentAccount.address] ?? 0;

      // Persist balances to encrypted storage
      try {
        await send(INTERNAL_METHODS.SET_CACHED_BALANCES, [accountBalances]);
      } catch (cacheErr) {
        console.warn('[Store] Failed to cache balances:', cacheErr);
      }

      // If the user switched accounts while we were awaiting the sync/fetch,
      // don't clobber the top-level `balance` / `availableBalance` / etc. with
      // stale numbers from the previous account.
      const latestCurrent = get().wallet.currentAccount;
      const accountStillCurrent = latestCurrent?.address === currentAccount.address;

      set({
        wallet: {
          ...get().wallet,
          ...(accountStillCurrent
            ? {
                balance: currentBalance,
                availableBalance: currentBalance,
                spendableBalance: currentSpendable,
              }
            : {}),
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

  // Fetch wallet transactions from encrypted store via background
  fetchWalletTransactions: async () => {
    try {
      const currentAccount = get().wallet.currentAccount;
      if (!currentAccount) return;

      // Capture the address we're fetching for to detect account switches
      const fetchingForAddress = currentAccount.address;

      const { send } = await import('./utils/messaging');
      const response = await send<{
        ok?: boolean;
        transactions?: WalletTransaction[];
        error?: string;
      }>(INTERNAL_METHODS.GET_WALLET_TRANSACTIONS, [fetchingForAddress]);

      if (response?.error) {
        console.error('Failed to fetch wallet transactions:', response.error);
        return;
      }

      // Check if user switched accounts while we were fetching
      const accountAfterFetch = get().wallet.currentAccount;
      if (accountAfterFetch?.address !== fetchingForAddress) {
        return;
      }

      set({ walletTransactions: response.transactions || [] });
    } catch (error) {
      console.error('Failed to fetch wallet transactions:', error);
    }
  },
}));
