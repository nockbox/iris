/**
 * Onboarding Backup Screen - Display mnemonic for user to write down
 */

import { useState } from 'react';
import { useStore } from '../../store';
import { Alert } from '../../components/Alert';
import lockIcon from '../../assets/lock-icon.svg';

export function BackupScreen() {
  const { onboardingMnemonic, navigate } = useStore();
  const [isRevealed, setIsRevealed] = useState(false);
  const [hasConfirmed, setHasConfirmed] = useState(false);

  function handleCopyAll() {
    if (onboardingMnemonic) {
      navigator.clipboard.writeText(onboardingMnemonic);
    }
  }

  if (!onboardingMnemonic) {
    // Should never happen, but handle gracefully
    return (
      <div className="w-[357px] h-[600px] bg-[var(--color-bg)] flex items-center justify-center p-4">
        <Alert type="error">No mnemonic found. Please restart onboarding.</Alert>
      </div>
    );
  }

  const words = onboardingMnemonic.split(' ');

  function handleContinue() {
    if (hasConfirmed) {
      navigate('onboarding-verify');
    }
  }

  return (
    <div className="w-[357px] h-[600px] flex flex-col bg-[var(--color-bg)]">
      {/* Header with back button */}
      <div className="flex items-center justify-between h-16 px-4 py-3 border-b border-[var(--color-divider)] shrink-0">
        <button
          onClick={() => navigate('onboarding-create')}
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
          Save your secret phrase
        </h2>
        <div className="w-8" /> {/* Spacer for centering */}
      </div>

      {/* Main content - scrollable */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="px-4 py-2 pb-4 flex flex-col gap-6">
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
              Write these words
              <br />
              down in order.
            </h1>
          </div>

          {/* Secret phrase section */}
          <div className="flex flex-col gap-3">
            {/* Warning box */}
            <div className="bg-[var(--color-surface-900)] rounded-lg p-3">
              <p
                className="font-sans font-medium text-center text-[var(--color-text-muted)]"
                style={{
                  fontSize: 'var(--font-size-xs)',
                  lineHeight: 'var(--line-height-tight)',
                  letterSpacing: '0.02em',
                }}
              >
                This is your ONLY way to recover your wallet.
              </p>
            </div>

            {/* Secret phrase grid */}
            <div className="relative">
              <div className="grid grid-cols-2 gap-2">
                {words.map((word, index) => (
                  <div
                    key={index}
                    className="bg-[var(--color-bg)] border border-[var(--color-surface-900)] rounded-lg p-2 flex items-center gap-2.5 h-11"
                  >
                    <span
                      className="bg-[var(--color-surface-900)] rounded min-w-[28px] h-7 flex items-center justify-center font-sans font-medium text-[var(--color-text-primary)]"
                      style={{
                        fontSize: 'var(--font-size-base)',
                        lineHeight: 'var(--line-height-snug)',
                        letterSpacing: '0.01em',
                      }}
                    >
                      {index + 1}
                    </span>
                    <span
                      className="font-sans font-medium text-[var(--color-text-primary)]"
                      style={{
                        fontSize: 'var(--font-size-base)',
                        lineHeight: 'var(--line-height-snug)',
                        letterSpacing: '0.01em',
                      }}
                    >
                      {word}
                    </span>
                  </div>
                ))}
              </div>

              {/* Blur overlay when not revealed */}
              {!isRevealed && (
                <div
                  className="absolute inset-0 backdrop-blur-[6px] rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-popover)',
                    border: '1px solid var(--color-surface-900)',
                  }}
                />
              )}
            </div>
          </div>

          {/* Checkbox confirmation */}
          <div className="bg-[var(--color-surface-900)] rounded-lg p-3 flex items-center gap-2.5">
            <button
              onClick={() => setHasConfirmed(!hasConfirmed)}
              className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                hasConfirmed
                  ? 'bg-[var(--color-primary)]'
                  : 'bg-transparent border-2 border-[var(--color-surface-700)]'
              }`}
              aria-label="Confirm you've written down the secret phrase"
            >
              {hasConfirmed && (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M16 6L7.5 14.5L4 11"
                    stroke="#000000"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
            <p
              className="flex-1 font-sans font-medium text-[var(--color-text-muted)]"
              style={{
                fontSize: 'var(--font-size-xs)',
                lineHeight: 'var(--line-height-tight)',
                letterSpacing: '0.02em',
              }}
            >
              I've securely written down all 24 words of my secret phrase
            </p>
          </div>
        </div>
      </div>

      {/* Bottom buttons - Pinned to bottom */}
      <div className="border-t border-[var(--color-surface-800)] px-4 py-3 bg-[var(--color-bg)] shrink-0">
        {!isRevealed ? (
          <button
            onClick={() => setIsRevealed(true)}
            className="w-full h-12 px-5 py-[15px] bg-[var(--color-text-primary)] text-[var(--color-bg)] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-base)',
              fontWeight: 500,
              lineHeight: 'var(--line-height-snug)',
              letterSpacing: '0.01em',
            }}
          >
            Show secret phrase
          </button>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={handleCopyAll}
              className="flex-1 h-12 px-5 py-[15px] rounded-lg flex items-center justify-center transition-opacity bg-[var(--color-surface-900)] text-[var(--color-text-primary)] hover:opacity-90"
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--font-size-base)',
                fontWeight: 500,
                lineHeight: 'var(--line-height-snug)',
                letterSpacing: '0.01em',
              }}
            >
              Copy all
            </button>
            <button
              onClick={handleContinue}
              disabled={!hasConfirmed}
              className={`flex-1 h-12 px-5 py-[15px] rounded-lg flex items-center justify-center transition-opacity ${
                hasConfirmed
                  ? 'bg-[var(--color-text-primary)] text-[var(--color-bg)] hover:opacity-90'
                  : 'bg-[var(--color-surface-700)] text-[var(--color-text-muted)] cursor-not-allowed opacity-50'
              }`}
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
        )}
      </div>
    </div>
  );
}
