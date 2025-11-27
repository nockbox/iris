import { useState } from 'react';
import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { CheckIcon } from '../components/icons/CheckIcon';
import LockIcon from '../assets/lock-icon-yellow.svg';
import { exportKeyfile, downloadKeyfile } from '../../shared/keyfile';
import { Alert } from '../components/Alert';

/**
 * ViewSecretPhraseScreen - Display user's 24-word secret phrase
 * Shows mnemonic secret phrase with security warnings and reveal functionality
 */
export function ViewSecretPhraseScreen() {
  const { navigate, onboardingMnemonic, setOnboardingMnemonic } = useStore();
  const [isRevealed, setIsRevealed] = useState(false);
  const [error, setError] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [copiedSeed, setCopiedSeed] = useState(false);

  // Get secret phrase from temporary store (set by KeySettingsPasswordScreen)
  const secretPhrase = onboardingMnemonic ? onboardingMnemonic.split(' ') : [];

  function handleBack() {
    // Clear mnemonic from memory when leaving screen
    setOnboardingMnemonic(null);
    navigate('settings');
  }

  function handleReveal() {
    setIsRevealed(true);
  }

  async function handleCopySecretPhrase() {
    if (onboardingMnemonic) {
      try {
        await navigator.clipboard.writeText(onboardingMnemonic);
        setCopiedSeed(true);
        setTimeout(() => setCopiedSeed(false), 2000);
      } catch (err) {
        console.error('Failed to copy secret phrase:', err);
      }
    }
  }

  function handleDownloadKeyfile() {
    if (!onboardingMnemonic) {
      setError('No mnemonic available');
      return;
    }

    setIsExporting(true);
    setError('');

    try {
      const keyfile = exportKeyfile(onboardingMnemonic);
      const timestamp = new Date().toISOString().split('T')[0];
      downloadKeyfile(keyfile, `nockchain-keyfile-${timestamp}.json`);
    } catch (err) {
      setError('Failed to export keyfile');
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 min-h-[64px]"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <button
          className="w-8 h-8 flex items-center justify-center p-2 transition-opacity hover:opacity-70"
          onClick={handleBack}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="font-sans font-medium text-base tracking-[0.16px] leading-[22px]">
          View secret phrase
        </h1>
        <div className="w-8 h-8" />
      </header>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto pt-2">
        <div className="px-4 pb-4 flex flex-col gap-6">
          {/* Title Section */}
          <div className="flex flex-col items-center gap-3 w-full">
            <div className="w-10 h-10 flex items-center justify-center">
              <img src={LockIcon} alt="Lock" className="w-full h-full" />
            </div>
            <div className="flex flex-col gap-2 text-center w-full">
              <h2 className="font-display font-medium text-2xl tracking-[-0.48px] leading-7">
                View secret phrase
              </h2>
              <p
                className="font-sans font-normal text-[13px] tracking-[0.26px] leading-[18px]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Make sure no one is looking at your screen
              </p>
            </div>
          </div>

          {/* Download Keyfile Link */}
          <button
            onClick={handleDownloadKeyfile}
            disabled={isExporting}
            className="font-sans font-medium text-sm tracking-[0.14px] leading-[18px] text-center underline hover:opacity-70 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? 'Downloading...' : 'Download keyfile'}
          </button>

          {/* Secret Phrase Grid */}
          <div className="relative flex flex-col gap-2">
            {/* 12 rows of 2 words each */}
            {[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22].map(startIndex => (
              <div key={startIndex} className="flex gap-2">
                {/* Left word */}
                <div
                  className="flex-1 rounded-lg overflow-hidden"
                  style={{
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-surface-800)',
                  }}
                >
                  <div className="flex items-center gap-2.5 p-2">
                    <div
                      className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: 'var(--color-surface-800)' }}
                    >
                      <span className="font-sans font-medium text-sm tracking-[0.14px] leading-[18px]">
                        {startIndex + 1}
                      </span>
                    </div>
                    <span className="font-sans font-medium text-sm tracking-[0.14px] leading-[18px] flex-1">
                      {secretPhrase[startIndex]}
                    </span>
                  </div>
                </div>

                {/* Right word */}
                <div
                  className="flex-1 rounded-lg overflow-hidden"
                  style={{
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-surface-800)',
                  }}
                >
                  <div className="flex items-center gap-2.5 p-2">
                    <div
                      className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: 'var(--color-surface-800)' }}
                    >
                      <span className="font-sans font-medium text-sm tracking-[0.14px] leading-[18px]">
                        {startIndex + 2}
                      </span>
                    </div>
                    <span className="font-sans font-medium text-sm tracking-[0.14px] leading-[18px] flex-1">
                      {secretPhrase[startIndex + 1]}
                    </span>
                  </div>
                </div>
              </div>
            ))}

            {/* Blur Overlay */}
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
      </div>

      {/* Bottom Button - Pinned to bottom */}
      <div
        className="px-4 py-3 shrink-0"
        style={{ borderTop: '1px solid var(--color-divider)', backgroundColor: 'var(--color-bg)' }}
      >
        <button
          onClick={isRevealed ? handleCopySecretPhrase : handleReveal}
          disabled={copiedSeed}
          className="w-full h-12 rounded-lg font-sans font-medium text-sm tracking-[0.14px] leading-[18px] transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
          style={{
            backgroundColor: 'var(--color-primary)',
            color: '#000',
          }}
        >
          {copiedSeed && <CheckIcon className="w-5 h-5" />}
          {!isRevealed ? 'Show secret phrase' : copiedSeed ? 'Copied!' : 'Copy Secret Phrase'}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="px-4 pb-3">
          <Alert type="error">{error}</Alert>
        </div>
      )}
    </div>
  );
}
