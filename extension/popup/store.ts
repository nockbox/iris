/**
 * Zustand store for popup UI state and navigation
 */

import { create } from "zustand";
import { INTERNAL_METHODS, APPROVAL_CONSTANTS } from "../shared/constants";
import { hasIncompleteOnboarding } from "../shared/onboarding";
import {
  Account,
  TransactionDetails,
  SignRequest,
  TransactionRequest,
  ConnectRequest,
} from "../shared/types";
import { send } from "./utils/messaging";

/**
 * All available screens in the wallet
 */
export type Screen =
  // Onboarding flow
  | "onboarding-start"
  | "onboarding-create"
  | "onboarding-backup"
  | "onboarding-verify"
  | "onboarding-success"
  | "onboarding-import"
  | "onboarding-import-success"
  | "onboarding-resume-backup"

  // Main app screens
  | "home"
  | "settings"
  | "recovery-phrase"

  // Transaction screens
  | "send"
  | "sent"
  | "receive"
  | "tx-details"

  // Approval screens
  | "connect-approval"
  | "sign-message"
  | "approve-transaction"

  // System
  | "locked";

/**
 * Wallet state synced from background service worker
 */
interface WalletState {
  locked: boolean;
  address: string | null;
  accounts: Account[];
  currentAccount: Account | null;
  balance: number;
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

  // Initialize app - checks vault status and navigates appropriately
  initialize: () => Promise<void>;

  // Fetch balance from blockchain
  fetchBalance: () => Promise<void>;
}

/**
 * Create the store
 */
export const useStore = create<AppStore>((set, get) => ({
  // Initial state
  currentScreen: "locked",
  history: [],

  wallet: {
    locked: true,
    address: null,
    accounts: [],
    currentAccount: null,
    balance: 0,
  },

  onboardingMnemonic: null,
  lastTransaction: null,
  pendingConnectRequest: null,
  pendingSignRequest: null,
  pendingTransactionRequest: null,

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
        address: string;
        accounts: Account[];
        currentAccount: Account | null;
      }>(INTERNAL_METHODS.GET_STATE);

      const walletState: WalletState = {
        locked: state.locked,
        address: state.address || null,
        accounts: state.accounts || [],
        currentAccount: state.currentAccount || null,
        balance: 0, // Will be fetched separately
      };

      // Determine initial screen
      let initialScreen: Screen;

      if (isApprovalRequest) {
        // For approval requests, don't override the screen
        // Let the approval useEffect handle navigation
        initialScreen = walletState.locked ? "locked" : "home";
      } else if (!walletState.address) {
        // No vault exists - start onboarding
        initialScreen = "onboarding-start";
      } else {
        // Check if user has incomplete onboarding (created wallet but didn't complete backup)
        const incompleteOnboarding = await hasIncompleteOnboarding();

        if (incompleteOnboarding) {
          // User needs to complete their backup - show resume screen
          initialScreen = "onboarding-resume-backup";
        } else if (walletState.locked) {
          // Vault exists but locked
          initialScreen = "locked";
        } else {
          // Vault unlocked - go to home
          initialScreen = "home";
        }
      }

      set({
        wallet: walletState,
        currentScreen: initialScreen,
      });

      // Fetch balance if wallet is unlocked
      if (!walletState.locked && walletState.address) {
        get().fetchBalance();
      }
    } catch (error) {
      console.error("Failed to initialize app:", error);
      // Default to locked screen on error
      set({ currentScreen: "locked" });
    }
  },

  // Fetch balance from blockchain
  fetchBalance: async () => {
    try {
      const result = await send<{ balance: number }>(
        INTERNAL_METHODS.GET_BALANCE
      );
      set({
        wallet: {
          ...get().wallet,
          balance: result.balance || 0,
        },
      });
    } catch (error) {
      console.error("Failed to fetch balance:", error);
    }
  },
}));
