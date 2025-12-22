/**
 * Onboarding Create Screen - Set password and create wallet
 */

import { useState } from 'react';
import { INTERNAL_METHODS, UI_CONSTANTS } from '../../../shared/constants';
import { setOnboardingInProgress } from '../../../shared/onboarding';
import { useStore } from '../../store';
import { send } from '../../utils/messaging';
import { formatWalletError } from '../../utils/formatWalletError';
import { Alert } from '../../components/Alert';
import lockIcon from '../../assets/lock-icon.svg';
import { EyeIcon } from '../../components/icons/EyeIcon';
import { EyeOffIcon } from '../../components/icons/EyeOffIcon';

export function CreateScreen() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const { navigate, syncWallet, setOnboardingMnemonic } = useStore();

  async function handleCreate() {
    // Clear previous errors
    setError('');

    // Validate password
    if (!password) {
      setError('Please enter a password');
      return;
    }

    if (password.length < UI_CONSTANTS.MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${UI_CONSTANTS.MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Create wallet
    const result = await send<{
      ok?: boolean;
      address?: string;
      mnemonic?: string;
      error?: string;
    }>(INTERNAL_METHODS.SETUP, [password]);

    if (result?.error) {
      setError(formatWalletError(result.error));
    } else {
      // Mark onboarding as in-progress (backup not yet complete)
      await setOnboardingInProgress();

      // Store mnemonic temporarily for backup/verification flow
      setOnboardingMnemonic(result.mnemonic || '');
      // After setup, we have the first account (Wallet 1)
      const firstAccount = {
        name: 'Wallet 1',
        address: result.address || '',
        index: 0,
      };
      syncWallet({
        locked: false,
        address: result.address || null,
        accounts: [firstAccount],
        currentAccount: firstAccount,
        balance: 0, // New wallet starts with 0 balance
        availableBalance: 0,
        spendableBalance: 0,
        accountBalances: {},
        accountSpendableBalances: {},
        accountBalanceDetails: {},
      });
      navigate('onboarding-backup');
    }
  }

  return (
    <div className="relative w-[357px] h-[600px] bg-[var(--color-bg)]">
      {/* Header with back button */}
      <div className="flex items-center justify-between h-16 px-4 py-3 border-b border-[var(--color-divider)]">
        <button
          onClick={() => navigate('onboarding-start')}
          className="p-2 -ml-2 hover:opacity-70 transition-opacity"
          aria-label="Go back"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 12L6 8L10 4"
              stroke="var(--color-text-primary)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h2
          className="font-sans font-medium text-[var(--color-text-primary)]"
          style={{
            fontSize: 'var(--font-size-lg)',
            lineHeight: 'var(--line-height-normal)',
            letterSpacing: '0.01em',
          }}
        >
          Create new wallet
        </h2>
        <div className="w-8" /> {/* Spacer for centering */}
      </div>

      {/* Main content */}
      <div className="flex flex-col justify-between h-[536px]">
        <div className="px-4 py-2 flex flex-col gap-6">
          {/* Icon and heading */}
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10">
              <img src={lockIcon} alt="" className="w-full h-full" />
            </div>
            <h1
              className="font-serif font-medium text-center text-[var(--color-text-primary)]"
              style={{
                fontSize: 'var(--font-size-xl)',
                lineHeight: 'var(--line-height-relaxed)',
                letterSpacing: '-0.02em',
              }}
            >
              First, let's secure your
              <br />
              wallet with a password
            </h1>
          </div>

          {/* Password inputs */}
          <div className="flex flex-col gap-6">
            {/* Create password */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="password"
                className="font-sans font-medium text-[var(--color-text-primary)]"
                style={{
                  fontSize: 'var(--font-size-sm)',
                  lineHeight: 'var(--line-height-snug)',
                  letterSpacing: '0.02em',
                }}
              >
                Create password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                  className="w-full h-[52px] px-3 py-4 bg-transparent border border-[var(--color-surface-700)] rounded-lg font-sans font-medium text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)]"
                  style={{
                    fontSize: 'var(--font-size-base)',
                    lineHeight: 'var(--line-height-snug)',
                    letterSpacing: '0.01em',
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeIcon className="w-4 h-4" />
                  ) : (
                    <EyeOffIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Confirm password */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="confirmPassword"
                className="font-sans font-medium text-[var(--color-text-primary)]"
                style={{
                  fontSize: 'var(--font-size-sm)',
                  lineHeight: 'var(--line-height-snug)',
                  letterSpacing: '0.02em',
                }}
              >
                Confirm password
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => {
                    setConfirmPassword(e.target.value);
                    setError('');
                  }}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  className="w-full h-[52px] px-3 py-4 bg-transparent border border-[var(--color-surface-700)] rounded-lg font-sans font-medium text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)]"
                  style={{
                    fontSize: 'var(--font-size-base)',
                    lineHeight: 'var(--line-height-snug)',
                    letterSpacing: '0.01em',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                  tabIndex={-1}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? (
                    <EyeIcon className="w-4 h-4" />
                  ) : (
                    <EyeOffIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Info box */}
          <div className="bg-[var(--color-surface-900)] rounded-lg p-3">
            <p
              className="font-sans font-medium text-center text-[var(--color-text-muted)]"
              style={{
                fontSize: 'var(--font-size-xs)',
                lineHeight: 'var(--line-height-tight)',
                letterSpacing: '0.02em',
              }}
            >
              This password encrypts your wallet on this device. Choose something strong but
              memorable. Your private keys never leave your browser.
            </p>
          </div>

          {/* Error message */}
          {error && (
            <Alert type="error" className="mt-2">
              {error}
            </Alert>
          )}
        </div>

        {/* Bottom button */}
        <div className="border-t border-[var(--color-surface-800)] px-4 py-3">
          <button
            onClick={handleCreate}
            className="w-full h-12 px-5 py-[15px] bg-[var(--color-text-primary)] text-[var(--color-bg)] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-base)',
              fontWeight: 500,
              lineHeight: 'var(--line-height-snug)',
              letterSpacing: '0.01em',
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
