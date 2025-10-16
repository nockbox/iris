/**
 * Popup UI: Main router component
 */

import { useEffect } from "react";
import { useStore } from "./store";
import { send } from "./utils/messaging";
import { INTERNAL_METHODS } from "../shared/constants";
import { Account } from "../shared/types";

// Screen components
import { LockedScreen } from "./screens/system/LockedScreen";
import { StartScreen } from "./screens/onboarding/StartScreen";
import { CreateScreen } from "./screens/onboarding/CreateScreen";
import { BackupScreen } from "./screens/onboarding/BackupScreen";
import { VerifyScreen } from "./screens/onboarding/VerifyScreen";
import { SuccessScreen } from "./screens/onboarding/SuccessScreen";
import { ImportScreen } from "./screens/onboarding/ImportScreen";
import { HomeScreen } from "./screens/main/HomeScreen";
import { SendScreen } from "./screens/transactions/SendScreen";
import { ReceiveScreen } from "./screens/transactions/ReceiveScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { RecoveryPhraseScreen } from "./screens/RecoveryPhraseScreen";

export function Popup() {
  const { currentScreen, initialize, wallet, syncWallet, navigate } =
    useStore();

  // Initialize app on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Poll for vault state changes (e.g., auto-lock)
  useEffect(() => {
    const interval = setInterval(async () => {
      // Only poll if we're not already on the locked screen
      if (currentScreen === "locked") return;

      const state = await send<{
        locked: boolean;
        address: string;
        accounts: Account[];
        currentAccount: Account | null;
      }>(INTERNAL_METHODS.GET_STATE);

      // If vault became locked, navigate to locked screen
      if (state.locked && !wallet.locked) {
        syncWallet({
          locked: true,
          address: state.address || null,
          accounts: state.accounts || [],
          currentAccount: state.currentAccount || null,
          balance: wallet.balance || 0, // Preserve balance
        });
        navigate("locked");
      }
    }, 2000); // Check every 2 seconds

    return () => clearInterval(interval);
  }, [currentScreen, wallet.locked, syncWallet, navigate]);

  // Simple router - render screen based on current state
  switch (currentScreen) {
    // Onboarding
    case "onboarding-start":
      return <StartScreen />;
    case "onboarding-create":
      return <CreateScreen />;
    case "onboarding-backup":
      return <BackupScreen />;
    case "onboarding-verify":
      return <VerifyScreen />;
    case "onboarding-success":
      return <SuccessScreen />;
    case "onboarding-import":
      return <ImportScreen />;

    // Main app
    case "home":
      return <HomeScreen />;
    case "settings":
      return <SettingsScreen />;
    case "recovery-phrase":
      return <RecoveryPhraseScreen />;

    // Transactions
    case "send":
      return <SendScreen />;
    case "receive":
      return <ReceiveScreen />;

    // System
    case "locked":
      return <LockedScreen />;

    // Default fallback
    default:
      return <div>Unknown screen: {currentScreen}</div>;
  }
}
