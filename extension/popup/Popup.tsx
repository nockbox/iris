/**
 * Popup UI: App initialization and lifecycle management
 */

import { useEffect } from "react";
import { useStore } from "./store";
import { send } from "./utils/messaging";
import { INTERNAL_METHODS, UI_CONSTANTS } from "../shared/constants";
import { Account } from "../shared/types";
import { Router } from "./Router";
import { useApprovalDetection } from "./hooks/useApprovalDetection";

export function Popup() {
  const {
    currentScreen,
    initialize,
    wallet,
    syncWallet,
    navigate,
    setPendingConnectRequest,
    setPendingTransactionRequest,
    setPendingSignRequest,
    setPendingSignRawTxRequest,
  } = useStore();

  // Initialize app on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Handle approval requests from URL hash
  useApprovalDetection({
    walletAddress: wallet.address,
    walletLocked: wallet.locked,
    setPendingConnectRequest,
    setPendingTransactionRequest,
    setPendingSignRequest,
    setPendingSignRawTxRequest,
    navigate,
  });

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
          accountBalances: wallet.accountBalances || {},
        });
        navigate("locked");
      }
    }, UI_CONSTANTS.STATE_POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [currentScreen, wallet.locked, wallet.balance, syncWallet, navigate]);

  // Render current screen via router
  return <Router />;
}
