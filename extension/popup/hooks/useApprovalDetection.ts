/**
 * useApprovalDetection - Detect and handle approval requests from URL hash or side panel messages
 *
 * This hook monitors the URL hash for approval request parameters (popup windows) and
 * runtime messages / background queries (side panel), then navigates to the appropriate
 * approval screen when the wallet is unlocked.
 */

import { useEffect, useCallback, useRef } from 'react';
import { send } from '../utils/messaging';
import {
  INTERNAL_METHODS,
  APPROVAL_CONSTANTS,
  RUNTIME_MESSAGE_TYPES,
} from '../../shared/constants';
import type { ApprovalType } from '../../shared/constants';
import type {
  TransactionRequest,
  SignRequest,
  ConnectRequest,
  SignRawTxRequest,
} from '../../shared/types';
import type { Screen } from '../store';
import { isSidePanel } from '../utils/displayContext';

interface UseApprovalDetectionProps {
  currentScreen: Screen;
  walletAddress: string | null;
  walletLocked: boolean;
  setPendingConnectRequest: (request: ConnectRequest | null) => void;
  setPendingTransactionRequest: (request: TransactionRequest | null) => void;
  setPendingSignRequest: (request: SignRequest | null) => void;
  setPendingSignRawTxRequest: (request: SignRawTxRequest | null) => void;
  navigate: (screen: Screen) => void;
}

const APPROVAL_SCREENS = new Set<Screen>([
  'connect-approval',
  'approve-transaction',
  'sign-message',
  'approve-sign-raw-tx',
]);

function getApprovalScreen(type: ApprovalType): Screen {
  switch (type) {
    case 'connect':
      return 'connect-approval';
    case 'transaction':
      return 'approve-transaction';
    case 'sign-message':
      return 'sign-message';
    case 'sign-raw-tx':
      return 'approve-sign-raw-tx';
  }
}

export function useApprovalDetection({
  currentScreen,
  walletAddress,
  walletLocked,
  setPendingConnectRequest,
  setPendingTransactionRequest,
  setPendingSignRequest,
  setPendingSignRawTxRequest,
  navigate,
}: UseApprovalDetectionProps) {
  const walletReady = walletAddress !== null;
  const walletReadyRef = useRef(walletReady);
  walletReadyRef.current = walletReady;
  const currentScreenRef = useRef(currentScreen);
  currentScreenRef.current = currentScreen;
  const approvalVersion = useRef(0);

  const clearPendingApproval = useCallback(() => {
    setPendingConnectRequest(null);
    setPendingTransactionRequest(null);
    setPendingSignRequest(null);
    setPendingSignRawTxRequest(null);

    // An empty approval queue should dismiss stale confirmations, without
    // interrupting settings, drafts, or a wallet waiting to be unlocked.
    if (APPROVAL_SCREENS.has(currentScreenRef.current)) {
      navigate(walletLocked ? 'locked' : 'home');
    }
  }, [
    walletLocked,
    setPendingConnectRequest,
    setPendingTransactionRequest,
    setPendingSignRequest,
    setPendingSignRawTxRequest,
    navigate,
  ]);

  const handleApproval = useCallback(
    async (requestId: string, type: ApprovalType) => {
      const version = ++approvalVersion.current;
      const targetScreen = getApprovalScreen(type);
      const lockedScreen: Screen = 'locked';

      if (type === 'connect') {
        const request = await send<ConnectRequest>(INTERNAL_METHODS.GET_PENDING_CONNECTION, [
          requestId,
        ]);
        if (version === approvalVersion.current && request && !('error' in request)) {
          setPendingConnectRequest(request);
          navigate(walletLocked ? lockedScreen : targetScreen);
        }
        return;
      }

      if (type === 'transaction') {
        const request = await send<TransactionRequest>(INTERNAL_METHODS.GET_PENDING_TRANSACTION, [
          requestId,
        ]);
        if (version === approvalVersion.current && request && !('error' in request)) {
          setPendingTransactionRequest(request);
          navigate(walletLocked ? lockedScreen : targetScreen);
        }
        return;
      }

      if (type === 'sign-message') {
        const request = await send<SignRequest>(INTERNAL_METHODS.GET_PENDING_SIGN_REQUEST, [
          requestId,
        ]);
        if (version === approvalVersion.current && request && !('error' in request)) {
          setPendingSignRequest(request);
          navigate(walletLocked ? lockedScreen : targetScreen);
        }
        return;
      }

      const request = await send<SignRawTxRequest>(
        INTERNAL_METHODS.GET_PENDING_SIGN_RAW_TX_REQUEST,
        [requestId]
      );
      if (version === approvalVersion.current && request && !('error' in request)) {
        setPendingSignRawTxRequest(request);
        navigate(walletLocked ? lockedScreen : targetScreen);
      }
    },
    [
      walletLocked,
      setPendingConnectRequest,
      setPendingTransactionRequest,
      setPendingSignRequest,
      setPendingSignRawTxRequest,
      navigate,
    ]
  );

  const handleApprovalRef = useRef(handleApproval);
  handleApprovalRef.current = handleApproval;

  const fetchPendingApproval = useCallback(async () => {
    const version = ++approvalVersion.current;
    const pending = await send<{ requestId: string; approvalType: ApprovalType } | null>(
      INTERNAL_METHODS.GET_PENDING_APPROVAL
    );

    // A newer check or approval notification supersedes this response.
    if (version !== approvalVersion.current) return;

    if (pending === null) {
      clearPendingApproval();
    } else if (pending?.requestId && pending.approvalType) {
      await handleApproval(pending.requestId, pending.approvalType);
    }
  }, [clearPendingApproval, handleApproval]);

  // Side panel: listen for approval messages immediately (may arrive before wallet init)
  useEffect(() => {
    if (!isSidePanel()) return;

    const handleRuntimeMessage = (message: {
      type?: string;
      requestId?: string;
      approvalType?: ApprovalType;
    }) => {
      if (
        message?.type === RUNTIME_MESSAGE_TYPES.APPROVAL_PENDING &&
        message.requestId &&
        message.approvalType
      ) {
        if (walletReadyRef.current) {
          void handleApprovalRef
            .current(message.requestId, message.approvalType)
            .catch(console.error);
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  }, []);

  // Side panel: fetch the current approval once the wallet is ready
  useEffect(() => {
    if (!isSidePanel() || !walletReady) return;

    // Re-query even if a notification arrived during initialization: that
    // request may have been resolved by another panel before we became ready.
    void fetchPendingApproval().catch(console.error);
  }, [walletReady, fetchPendingApproval]);

  // Side panel: re-check when panel becomes visible (e.g. reopened or refocused)
  useEffect(() => {
    if (!isSidePanel() || !walletReady) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;

      void fetchPendingApproval().catch(console.error);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [walletReady, fetchPendingApproval]);

  // Popup windows: route via URL hash
  useEffect(() => {
    if (!walletReady || isSidePanel()) return;

    const hash = window.location.hash.slice(1); // Remove '#'

    if (hash.startsWith(APPROVAL_CONSTANTS.CONNECT_HASH_PREFIX)) {
      const requestId = hash.replace(APPROVAL_CONSTANTS.CONNECT_HASH_PREFIX, '');
      void handleApproval(requestId, 'connect').catch(console.error);
    } else if (hash.startsWith(APPROVAL_CONSTANTS.TRANSACTION_HASH_PREFIX)) {
      const requestId = hash.replace(APPROVAL_CONSTANTS.TRANSACTION_HASH_PREFIX, '');
      void handleApproval(requestId, 'transaction').catch(console.error);
    } else if (hash.startsWith(APPROVAL_CONSTANTS.SIGN_MESSAGE_HASH_PREFIX)) {
      const requestId = hash.replace(APPROVAL_CONSTANTS.SIGN_MESSAGE_HASH_PREFIX, '');
      void handleApproval(requestId, 'sign-message').catch(console.error);
    } else if (hash.startsWith(APPROVAL_CONSTANTS.SIGN_RAW_TX_HASH_PREFIX)) {
      const requestId = hash.replace(APPROVAL_CONSTANTS.SIGN_RAW_TX_HASH_PREFIX, '');
      void handleApproval(requestId, 'sign-raw-tx').catch(console.error);
    }
  }, [walletReady, handleApproval]);
}
