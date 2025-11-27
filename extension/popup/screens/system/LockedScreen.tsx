/**
 * Locked Screen - Unlock wallet with password
 */

import { useState } from 'react';
import { INTERNAL_METHODS, ERROR_CODES } from '../../../shared/constants';
import { useStore } from '../../store';
import { send } from '../../utils/messaging';
import { Alert } from '../../components/Alert';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EyeIcon } from '../../components/icons/EyeIcon';
import { EyeOffIcon } from '../../components/icons/EyeOffIcon';
import { AnimatedLogo } from '../../components/AnimatedLogo';

export function LockedScreen() {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const {
    navigate,
    syncWallet,
    wallet,
    fetchBalance,
    pendingConnectRequest,
    pendingTransactionRequest,
    pendingSignRequest,
    pendingSignRawTxRequest,
  } = useStore();

  async function handleUnlock() {
    // Clear previous errors
    setError('');

    if (!password) {
      setError('Please enter a password');
      return;
    }

    const result = await send<{
      ok?: boolean;
      address?: string;
      accounts?: Array<{ name: string; address: string; index: number }>;
      currentAccount?: { name: string; address: string; index: number };
      error?: string;
    }>(INTERNAL_METHODS.UNLOCK, [password]);

    if (result?.error) {
      setError(
        result.error === ERROR_CODES.BAD_PASSWORD ? 'Incorrect password' : `Error: ${result.error}`
      );
      setPassword(''); // Clear password on error
    } else {
      setPassword('');
      const accounts = result.accounts || [];
      const currentAccount = result.currentAccount || accounts[0] || null;

      // Load cached balances from storage
      const { STORAGE_KEYS } = await import('../../../shared/constants');
      const stored = await chrome.storage.local.get([STORAGE_KEYS.CACHED_BALANCES]);
      const cachedBalances = (stored[STORAGE_KEYS.CACHED_BALANCES] || {}) as Record<string, number>;
      const cachedBalance = currentAccount ? (cachedBalances[currentAccount.address] ?? 0) : 0;

      syncWallet({
        ...wallet,
        locked: false,
        address: result.address || null,
        accounts,
        currentAccount,
        balance: cachedBalance,
        availableBalance: cachedBalance,
        accountBalances: cachedBalances,
      });

      // Trigger balance fetch after successful unlock
      fetchBalance();

      // Navigate to pending approval if one exists, otherwise go home
      if (pendingConnectRequest) {
        navigate('connect-approval');
      } else if (pendingTransactionRequest) {
        navigate('approve-transaction');
      } else if (pendingSignRequest) {
        navigate('sign-message');
      } else if (pendingSignRawTxRequest) {
        navigate('approve-sign-raw-tx');
      } else {
        navigate('home');
      }
    }
  }

  function handleResetWallet() {
    setShowResetConfirm(true);
  }

  async function confirmResetWallet() {
    // Reset the wallet via the background service
    const result = await send<{ ok?: boolean }>(INTERNAL_METHODS.RESET_WALLET, []);

    if (result?.ok) {
      // Navigate to onboarding start
      navigate('onboarding-start');
      setShowResetConfirm(false);
    }
  }

  function cancelResetWallet() {
    setShowResetConfirm(false);
  }

  return (
    <div className="h-screen flex items-center justify-center bg-[var(--color-bg)]">
      <div className="relative w-[357px] h-[calc(max(min(600px,100vh),500px))] bg-[var(--color-bg)]">
        <div className="flex flex-col justify-between h-full px-4 py-8">
          {/* Main content */}
          <div className="flex flex-col gap-8 w-full">
            {/* Logo and heading */}
            <div className="flex flex-col items-center gap-3 w-full">
              <AnimatedLogo />
              <div className="flex flex-col gap-2 items-center text-center w-full">
                <h1
                  className="font-serif font-medium text-[var(--color-text-primary)]"
                  style={{
                    fontSize: 'var(--font-size-xl)',
                    lineHeight: 'var(--line-height-relaxed)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  Welcome back
                </h1>
                <p
                  className="font-sans text-[var(--color-text-muted)]"
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    lineHeight: 'var(--line-height-snug)',
                    letterSpacing: '0.02em',
                  }}
                >
                  Your safe wallet for Nockchain
                </p>
              </div>
            </div>

            {/* Password input and unlock button */}
            <div className="flex flex-col gap-4 w-full">
              <div className="flex flex-col gap-1.5 w-full">
                <label
                  className="font-sans font-medium text-[var(--color-text-primary)]"
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    lineHeight: 'var(--line-height-snug)',
                    letterSpacing: '0.02em',
                  }}
                >
                  Password
                </label>
                <div className="bg-[var(--color-bg)] border border-[var(--color-surface-700)] rounded-lg p-3 flex items-center gap-2.5 h-[52px]">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => {
                      setPassword(e.target.value);
                      setError('');
                    }}
                    onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                    placeholder="Enter your password"
                    autoFocus
                    className="flex-1 bg-transparent font-sans font-medium text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] outline-none"
                    style={{
                      fontSize: 'var(--font-size-base)',
                      lineHeight: 'var(--line-height-snug)',
                      letterSpacing: '0.01em',
                    }}
                  />
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  >
                    {showPassword ? (
                      <EyeOffIcon className="h-4 w-4" />
                    ) : (
                      <EyeIcon className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Error message */}
              {error && <Alert type="error">{error}</Alert>}

              {/* Unlock button */}
              <button
                onClick={handleUnlock}
                className="w-full h-12 px-5 py-[15px] bg-[var(--color-text-primary)] text-[var(--color-bg)] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--font-size-base)',
                  fontWeight: 500,
                  lineHeight: 'var(--line-height-snug)',
                  letterSpacing: '0.01em',
                }}
              >
                Unlock
              </button>
            </div>
          </div>

          {/* Bottom text with reset link */}
          <div className="flex flex-col gap-3 items-center text-center w-full">
            <p
              className="font-sans text-[var(--color-text-muted)]"
              style={{
                fontSize: 'var(--font-size-sm)',
                lineHeight: 'var(--line-height-snug)',
                letterSpacing: '0.02em',
              }}
            >
              Can't login? You can delete your current wallet and create a new one
            </p>
            <button
              onClick={handleResetWallet}
              className="font-sans font-medium text-[var(--color-text-primary)] underline hover:opacity-80"
              style={{
                fontSize: 'var(--font-size-base)',
                lineHeight: 'var(--line-height-snug)',
                letterSpacing: '0.01em',
              }}
            >
              Reset wallet
            </button>
          </div>
        </div>

        {/* Reset Confirmation Modal */}
        <ConfirmModal
          isOpen={showResetConfirm}
          title="Reset wallet"
          message="This will delete your current wallet and all data. You will need to create a new wallet or import an existing one."
          confirmText="Reset"
          cancelText="Cancel"
          onConfirm={confirmResetWallet}
          onCancel={cancelResetWallet}
          variant="danger"
        />
      </div>
    </div>
  );
}
