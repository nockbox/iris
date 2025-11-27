/**
 * Onboarding Verify Screen - Verify user wrote down mnemonic correctly
 */

import { useState, useMemo } from 'react';
import { useStore } from '../../store';
import { Alert } from '../../components/Alert';
import lockIcon from '../../assets/lock-icon.svg';

/**
 * Generates 6 unique random positions from 0-23 for secret phrase verification
 */
function generateRandomPositions(): number[] {
  const positions = Array.from({ length: 24 }, (_, i) => i);
  const selected: number[] = [];

  // Fisher-Yates shuffle and take first 6
  for (let i = positions.length - 1; i > 0 && selected.length < 6; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
    selected.push(positions[i]);
  }

  // Sort selected positions so they appear in order
  return selected.sort((a, b) => a - b);
}

export function VerifyScreen() {
  const { onboardingMnemonic, navigate, setOnboardingMnemonic } = useStore();
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [error, setError] = useState<string>('');

  // Generate random positions once per mnemonic (stable across re-renders)
  const testPositions = useMemo(() => generateRandomPositions(), [onboardingMnemonic]);

  if (!onboardingMnemonic) {
    return (
      <div className="w-[357px] h-[600px] bg-[var(--color-bg)] flex items-center justify-center p-4">
        <Alert type="error">No mnemonic found. Please restart onboarding.</Alert>
      </div>
    );
  }

  const words = onboardingMnemonic.split(' ');

  function handleInputChange(position: number, value: string) {
    setInputs(prev => ({ ...prev, [position]: value.trim().toLowerCase() }));
    setError('');
  }

  function handleVerify() {
    // Check if all positions are filled
    const allFilled = testPositions.every(pos => inputs[pos]?.length > 0);
    if (!allFilled) {
      setError('Please fill in all word fields');
      return;
    }

    // Verify all words are correct
    const allCorrect = testPositions.every(pos => inputs[pos] === words[pos].toLowerCase());

    if (allCorrect) {
      // Clear the mnemonic from memory and navigate to success
      setOnboardingMnemonic(null);
      navigate('onboarding-success');
    } else {
      setError('One or more words are incorrect. Please check your secret phrase and try again.');
    }
  }

  function handleBack() {
    navigate('onboarding-backup');
  }

  return (
    <div className="relative w-[357px] h-[600px] bg-[var(--color-bg)]">
      {/* Header with back button */}
      <div className="flex items-center justify-between h-16 px-4 py-3 border-b border-[var(--color-divider)]">
        <button
          onClick={handleBack}
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

      {/* Main content */}
      <div className="flex flex-col justify-between h-[536px]">
        <div className="px-4 py-2 flex flex-col gap-6">
          {/* Icon and heading */}
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10">
              <img src={lockIcon} alt="" className="w-full h-full" />
            </div>
            <div className="flex flex-col gap-2 items-center text-center w-full">
              <h1
                className="font-serif font-medium text-[var(--color-text-primary)]"
                style={{
                  fontSize: 'var(--font-size-xl)',
                  lineHeight: 'var(--line-height-relaxed)',
                  letterSpacing: '-0.02em',
                }}
              >
                Verify secret phrase.
              </h1>
              <p
                className="font-sans text-[var(--color-text-muted)]"
                style={{
                  fontSize: 'var(--font-size-sm)',
                  lineHeight: 'var(--line-height-snug)',
                  letterSpacing: '0.02em',
                }}
              >
                Please write down the words with this number
              </p>
            </div>
          </div>

          {/* Input fields */}
          <div className="flex flex-col gap-2 w-full">
            {[0, 1, 2].map(row => (
              <div key={row} className="flex gap-2 w-full">
                {[0, 1].map(col => {
                  const index = row * 2 + col;
                  const position = testPositions[index];
                  const wordNumber = position + 1;

                  return (
                    <div
                      key={col}
                      className="flex-1 min-w-0 bg-[var(--color-bg)] border border-[var(--color-surface-700)] rounded-lg p-2 flex items-center gap-2.5 h-11"
                    >
                      <span
                        className="bg-[var(--color-surface-900)] rounded w-7 h-7 flex items-center justify-center font-sans font-medium text-[var(--color-text-primary)] flex-shrink-0"
                        style={{
                          fontSize: 'var(--font-size-base)',
                          lineHeight: 'var(--line-height-snug)',
                          letterSpacing: '0.01em',
                        }}
                      >
                        {wordNumber}
                      </span>
                      <input
                        type="text"
                        value={inputs[position] || ''}
                        onChange={e => handleInputChange(position, e.target.value)}
                        placeholder="word"
                        className="flex-1 min-w-0 bg-transparent font-sans font-medium text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] outline-none"
                        style={{
                          fontSize: 'var(--font-size-base)',
                          lineHeight: 'var(--line-height-snug)',
                          letterSpacing: '0.01em',
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Error message */}
          {error && <Alert type="error">{error}</Alert>}
        </div>

        {/* Bottom buttons */}
        <div className="border-t border-[var(--color-surface-800)] px-4 py-3">
          <div className="flex gap-3">
            <button
              onClick={handleBack}
              className="flex-1 h-12 px-5 py-[15px] bg-[var(--color-surface-800)] text-[var(--color-text-primary)] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90"
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--font-size-base)',
                fontWeight: 500,
                lineHeight: 'var(--line-height-snug)',
                letterSpacing: '0.01em',
              }}
            >
              Back
            </button>
            <button
              onClick={handleVerify}
              className="flex-1 h-12 px-5 py-[15px] bg-[var(--color-primary)] text-[#000000] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90"
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--font-size-base)',
                fontWeight: 500,
                lineHeight: 'var(--line-height-snug)',
                letterSpacing: '0.01em',
              }}
            >
              Create wallet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
