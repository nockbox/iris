/**
 * Resume Backup Screen
 * Shown when user closed popup during onboarding and needs to complete backup
 */

import { useState } from 'react';
import { useStore } from '../../store';
import { send } from '../../utils/messaging';
import { INTERNAL_METHODS } from '../../../shared/constants';
import { formatWalletError } from '../../utils/formatWalletError';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Alert } from '../../components/Alert';
import { PasswordInput } from '../../components/PasswordInput';

export function ResumeBackupScreen() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { navigate, setOnboardingMnemonic } = useStore();

  async function handleContinue() {
    setError('');

    if (!password) {
      setError('Please enter your password');
      return;
    }

    // Retrieve mnemonic using password
    const result = await send<{
      ok?: boolean;
      mnemonic?: string;
      error?: string;
    }>(INTERNAL_METHODS.GET_MNEMONIC, [password]);

    if (result?.error) {
      setError(formatWalletError(result.error));
      setPassword(''); // Clear password on error
    } else {
      // Store mnemonic in Zustand for backup flow
      setOnboardingMnemonic(result.mnemonic || '');
      setPassword('');
      // Navigate to backup screen
      navigate('onboarding-backup');
    }
  }

  return (
    <div className="relative w-[357px] h-[600px]" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between h-16 px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-divider)' }}
      >
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
          className="font-sans font-medium"
          style={{
            fontSize: 'var(--font-size-lg)',
            lineHeight: 'var(--line-height-normal)',
            letterSpacing: '0.01em',
            color: 'var(--color-text-primary)',
          }}
        >
          Complete Backup
        </h2>
        <div className="w-8" />
      </div>

      {/* Main content */}
      <div className="flex flex-col justify-between h-[536px]">
        <div className="px-4 py-2 flex flex-col gap-6">
          <h1
            className="font-serif font-medium text-center"
            style={{
              fontSize: 'var(--font-size-xl)',
              lineHeight: 'var(--line-height-relaxed)',
              letterSpacing: '-0.02em',
              color: 'var(--color-text-primary)',
            }}
          >
            Complete Your Backup
          </h1>

          <p
            className="font-sans text-center"
            style={{
              fontSize: 'var(--font-size-sm)',
              lineHeight: 'var(--line-height-snug)',
              letterSpacing: '0.02em',
              color: 'var(--color-text-muted)',
            }}
          >
            You need to backup your secret phrase to secure your wallet. Enter your password to
            continue.
          </p>

          <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-red-light)' }}>
            <p
              className="font-sans font-medium text-center"
              style={{
                fontSize: 'var(--font-size-xs)',
                lineHeight: 'var(--line-height-tight)',
                letterSpacing: '0.02em',
                color: 'var(--color-red)',
              }}
            >
              <strong>Important:</strong> Without backing up your secret phrase, you risk losing
              access to your wallet if you forget your password.
            </p>
          </div>

          <PasswordInput
            value={password}
            onChange={value => {
              setPassword(value);
              setError('');
            }}
            placeholder="Password"
            className="my-2"
            onKeyDown={e => e.key === 'Enter' && handleContinue()}
            autoFocus
          />

          {error && (
            <Alert type="error" className="my-2">
              {error}
            </Alert>
          )}
        </div>

        {/* Bottom button */}
        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--color-surface-800)' }}>
          <button
            onClick={handleContinue}
            className="w-full h-12 px-5 py-[15px] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90"
            style={{
              backgroundColor: 'var(--color-primary)',
              color: '#000000',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-base)',
              fontWeight: 500,
              lineHeight: 'var(--line-height-snug)',
              letterSpacing: '0.01em',
            }}
          >
            Continue Backup
          </button>
        </div>
      </div>
    </div>
  );
}
