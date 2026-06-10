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
  walletAddress: string | null;
  walletLocked: boolean;
  setPendingConnectRequest: (request: ConnectRequest | null) => void;
  setPendingTransactionRequest: (request: TransactionRequest | null) => void;
  setPendingSignRequest: (request: SignRequest | null) => void;
  setPendingSignRawTxRequest: (request: SignRawTxRequest | null) => void;
  navigate: (screen: Screen) => void;
}

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
  walletAddress,
  walletLocked,
  setPendingConnectRequest,
  setPendingTransactionRequest,
  setPendingSignRequest,
  setPendingSignRawTxRequest,
  navigate,
}: UseApprovalDetectionProps) {
  const walletReady = walletAddress !== null;
  const pendingSidePanelApproval = useRef<{ requestId: string; type: ApprovalType } | null>(null);
  const walletReadyRef = useRef(walletReady);
  walletReadyRef.current = walletReady;

  const handleApproval = useCallback(
    async (requestId: string, type: ApprovalType) => {
      const targetScreen = getApprovalScreen(type);
      const lockedScreen: Screen = 'locked';

      if (type === 'connect') {
        const request = await send<ConnectRequest>(INTERNAL_METHODS.GET_PENDING_CONNECTION, [
          requestId,
        ]);
        if (request && !('error' in request)) {
          setPendingConnectRequest(request);
          navigate(walletLocked ? lockedScreen : targetScreen);
        }
        return;
      }

      if (type === 'transaction') {
        const request = await send<TransactionRequest>(INTERNAL_METHODS.GET_PENDING_TRANSACTION, [
          requestId,
        ]);
        if (request && !('error' in request)) {
          setPendingTransactionRequest(request);
          navigate(walletLocked ? lockedScreen : targetScreen);
        }
        return;
      }

      if (type === 'sign-message') {
        const request = await send<SignRequest>(INTERNAL_METHODS.GET_PENDING_SIGN_REQUEST, [
          requestId,
        ]);
        if (request && !('error' in request)) {
          setPendingSignRequest(request);
          navigate(walletLocked ? lockedScreen : targetScreen);
        }
        return;
      }

      const request = await send<SignRawTxRequest>(
        INTERNAL_METHODS.GET_PENDING_SIGN_RAW_TX_REQUEST,
        [requestId]
      );
      if (request && !('error' in request)) {
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
        } else {
          pendingSidePanelApproval.current = {
            requestId: message.requestId,
            type: message.approvalType,
          };
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  }, []);

  // Side panel: process queued or pending approvals once wallet is ready
  useEffect(() => {
    if (!isSidePanel() || !walletReady) return;

    const fetchPendingApproval = () => {
      send<{ requestId: string; approvalType: ApprovalType } | null>(
        INTERNAL_METHODS.GET_PENDING_APPROVAL
      )
        .then(pending => {
          if (pending?.requestId && pending.approvalType) {
            void handleApproval(pending.requestId, pending.approvalType).catch(console.error);
          }
        })
        .catch(console.error);
    };

    const queued = pendingSidePanelApproval.current;
    if (queued) {
      pendingSidePanelApproval.current = null;
      void handleApproval(queued.requestId, queued.type).catch(console.error);
      return;
    }

    fetchPendingApproval();
  }, [walletReady, handleApproval]);

  // Side panel: re-check when panel becomes visible (e.g. reopened or refocused)
  useEffect(() => {
    if (!isSidePanel() || !walletReady) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;

      send<{ requestId: string; approvalType: ApprovalType } | null>(
        INTERNAL_METHODS.GET_PENDING_APPROVAL
      )
        .then(pending => {
          if (pending?.requestId && pending.approvalType) {
            void handleApproval(pending.requestId, pending.approvalType).catch(console.error);
          }
        })
        .catch(console.error);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [walletReady, handleApproval]);

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
