/**
 * useApprovalDetection - Detect and handle approval requests from URL hash
 *
 * This hook monitors the URL hash for approval request parameters and automatically
 * fetches the corresponding request data from the background script, then navigates
 * to the appropriate approval screen when the wallet is unlocked.
 *
 * @param walletAddress - The current wallet address (null if not initialized)
 * @param walletLocked - Whether the wallet is currently locked
 * @param setPendingTransactionRequest - Function to set pending transaction request
 * @param setPendingSignRequest - Function to set pending sign request
 * @param navigate - Navigation function to switch screens
 */

import { useEffect } from 'react';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS, APPROVAL_CONSTANTS } from '../../shared/constants';
import type {
  TransactionRequest,
  SignRequest,
  ConnectRequest,
  SignRawTxRequest,
} from '../../shared/types';
import type { Screen } from '../store';

interface UseApprovalDetectionProps {
  walletAddress: string | null;
  walletLocked: boolean;
  setPendingConnectRequest: (request: ConnectRequest | null) => void;
  setPendingTransactionRequest: (request: TransactionRequest | null) => void;
  setPendingSignRequest: (request: SignRequest | null) => void;
  setPendingSignRawTxRequest: (request: SignRawTxRequest | null) => void;
  navigate: (screen: Screen) => void;
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
  useEffect(() => {
    // Wait for wallet state to be initialized
    if (walletAddress === null) return;

    const hash = window.location.hash.slice(1); // Remove '#'

    if (hash.startsWith(APPROVAL_CONSTANTS.CONNECT_HASH_PREFIX)) {
      const requestId = hash.replace(APPROVAL_CONSTANTS.CONNECT_HASH_PREFIX, '');

      // Fetch pending connect request from background
      send<ConnectRequest>(INTERNAL_METHODS.GET_PENDING_CONNECTION, [requestId])
        .then(request => {
          if (request && !('error' in request)) {
            setPendingConnectRequest(request);
            // Navigate to approval screen if unlocked, or locked screen if locked
            if (!walletLocked) {
              navigate('connect-approval');
            } else {
              navigate('locked');
            }
          }
        })
        .catch(console.error);
    } else if (hash.startsWith(APPROVAL_CONSTANTS.TRANSACTION_HASH_PREFIX)) {
      const requestId = hash.replace(APPROVAL_CONSTANTS.TRANSACTION_HASH_PREFIX, '');

      // Fetch pending transaction request from background
      send<TransactionRequest>(INTERNAL_METHODS.GET_PENDING_TRANSACTION, [requestId])
        .then(request => {
          if (request && !('error' in request)) {
            setPendingTransactionRequest(request);
            // Navigate to approval screen if unlocked, or locked screen if locked
            if (!walletLocked) {
              navigate('approve-transaction');
            } else {
              navigate('locked');
            }
          }
        })
        .catch(console.error);
    } else if (hash.startsWith(APPROVAL_CONSTANTS.SIGN_MESSAGE_HASH_PREFIX)) {
      const requestId = hash.replace(APPROVAL_CONSTANTS.SIGN_MESSAGE_HASH_PREFIX, '');

      // Fetch pending sign request from background
      send<SignRequest>(INTERNAL_METHODS.GET_PENDING_SIGN_REQUEST, [requestId])
        .then(request => {
          if (request && !('error' in request)) {
            setPendingSignRequest(request);
            // Navigate to approval screen if unlocked, or locked screen if locked
            if (!walletLocked) {
              navigate('sign-message');
            } else {
              navigate('locked');
            }
          }
        })
        .catch(console.error);
    } else if (hash.startsWith(APPROVAL_CONSTANTS.SIGN_RAW_TX_HASH_PREFIX)) {
      const requestId = hash.replace(APPROVAL_CONSTANTS.SIGN_RAW_TX_HASH_PREFIX, '');

      // Fetch pending sign raw tx request from background
      send<SignRawTxRequest>(INTERNAL_METHODS.GET_PENDING_SIGN_RAW_TX_REQUEST, [requestId])
        .then(request => {
          if (request && !('error' in request)) {
            setPendingSignRawTxRequest(request);
            // Navigate to approval screen if unlocked, or locked screen if locked
            if (!walletLocked) {
              navigate('approve-sign-raw-tx');
            } else {
              navigate('locked');
            }
          }
        })
        .catch(console.error);
    }
  }, [
    walletAddress,
    walletLocked,
    setPendingConnectRequest,
    setPendingTransactionRequest,
    setPendingSignRequest,
    navigate,
  ]);
}
