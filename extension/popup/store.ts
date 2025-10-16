/**
 * Zustand store for popup UI state and navigation
 */

import { create } from 'zustand';
import { INTERNAL_METHODS } from '../shared/constants';
import { Account } from '../shared/types';
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

  // Main app screens
  | 'home'
  | 'settings'
  | 'recovery-phrase'

  // Transaction screens
  | 'send'
  | 'receive'
  | 'tx-details'

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
  currentScreen: 'locked',
  history: [],

  wallet: {
    locked: true,
    address: null,
    accounts: [],
    currentAccount: null,
    balance: 0,
  },

  onboardingMnemonic: null,

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

  // Initialize app on load
  initialize: async () => {
    try {
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

      if (!walletState.address) {
        // No vault exists - start onboarding
        initialScreen = 'onboarding-start';
      } else if (walletState.locked) {
        // Vault exists but locked
        initialScreen = 'locked';
      } else {
        // Vault unlocked - go to home
        initialScreen = 'home';
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
      console.error('Failed to initialize app:', error);
      // Default to locked screen on error
      set({ currentScreen: 'locked' });
    }
  },

  // Fetch balance from blockchain
  fetchBalance: async () => {
    try {
      const result = await send<{ balance: number }>(INTERNAL_METHODS.GET_BALANCE);
      set({
        wallet: {
          ...get().wallet,
          balance: result.balance || 0,
        },
      });
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    }
  },
}));
