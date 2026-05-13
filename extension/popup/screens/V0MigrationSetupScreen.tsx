import { useRef, useState } from 'react';
import { setV0MigrationMnemonic, useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { Alert } from '../components/Alert';
import lockIcon from '../assets/lock-icon.svg';
import { queryV0Balance } from '../../shared/v0-migration';

const WORD_COUNT = 24;

export function V0MigrationSetupScreen() {
  const { navigate, setV0MigrationDraft, resetV0MigrationDraft } = useStore();
  const [discoverError, setDiscoverError] = useState('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [words, setWords] = useState<string[]>(Array(WORD_COUNT).fill(''));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const canContinue = words.length === WORD_COUNT && words.every(w => Boolean(w));

  async function handlePasteAll() {
    try {
      const raw = await navigator.clipboard.readText();
      const pasted = raw.trim().toLowerCase().split(/\s+/).slice(0, WORD_COUNT);
      const next = Array(WORD_COUNT).fill('');
      pasted.forEach((word, index) => {
        next[index] = word;
      });
      setWords(next);
    } catch (error) {
      console.warn('Paste failed:', error);
    }
  }

  function handleWordChange(index: number, value: string) {
    const trimmedValue = value.trim().toLowerCase();
    const newWords = [...words];
    newWords[index] = trimmedValue;
    setWords(newWords);
    if (value.endsWith(' ')) {
      const nextIndex = index + 1;
      if (nextIndex < WORD_COUNT) {
        inputRefs.current[nextIndex]?.focus();
      }
    }
  }

  function handlePaste(index: number, e: React.ClipboardEvent<HTMLInputElement>) {
    if (index === 0) {
      const pasteData = e.clipboardData.getData('text');
      const pastedWords = pasteData.trim().toLowerCase().split(/\s+/);
      if (pastedWords.length === WORD_COUNT) {
        e.preventDefault();
        const next = Array(WORD_COUNT).fill('');
        pastedWords.forEach((word, i) => {
          next[i] = word;
        });
        setWords(next);
      }
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !words[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const nextIndex = index + 1;
      if (nextIndex < WORD_COUNT) {
        inputRefs.current[nextIndex]?.focus();
      }
    }
  }

  async function handleContinue() {
    if (!canContinue || isDiscovering) return;

    setDiscoverError('');
    setIsDiscovering(true);
    try {
      setV0MigrationMnemonic(undefined);
      const mnemonic = words.join(' ').trim();
      const result = await queryV0Balance(mnemonic);

      if (!result.v0Notes.length) {
        const rawCount = result.rawNotesFromRpc ?? 0;
        const msg =
          rawCount > 0
            ? `No v0 (Legacy) notes found. RPC returned ${rawCount} note(s) but none match Legacy format. Check DevTools console for details.`
            : `No v0 notes found for this recovery phrase. Queried address: ${result.sourceAddress?.slice(0, 12)}... (see console for full address)`;
        throw new Error(msg);
      }

      setV0MigrationMnemonic(mnemonic);
      setV0MigrationDraft({
        sourceAddress: result.sourceAddress,
        v0Notes: result.v0Notes,
        v0BalanceNock: result.totalNock,
        migratedAmountNock: undefined,
        feeNock: undefined,
        keyfileName: undefined,
        v0MigrationTxSignPayload: undefined,
        txId: undefined,
      });
      setWords(Array(WORD_COUNT).fill(''));
      navigate('v0-migration-funds');
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : 'Failed to discover v0 notes');
    } finally {
      setIsDiscovering(false);
    }
  }

  return (
    <div className="relative w-[357px] h-[600px] bg-[var(--color-bg)]">
      {/* Header - same as onboarding ImportScreen */}
      <div className="flex items-center justify-between h-16 px-4 py-3 border-b border-[var(--color-divider)]">
        <button
          type="button"
          onClick={() => navigate('v0-migration-intro')}
          className="p-2 -ml-2 hover:opacity-70 transition-opacity text-[var(--color-text-primary)]"
          aria-label="Go back"
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h2
          className="font-sans font-medium text-[var(--color-text-primary)]"
          style={{
            fontSize: 'var(--font-size-lg)',
            lineHeight: 'var(--line-height-normal)',
            letterSpacing: '0.01em',
          }}
        >
          Transfer v0 funds
        </h2>
        <div className="w-8" />
      </div>

      <div className="h-[536px] flex flex-col">
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <div className="px-4 py-2 flex flex-col gap-6">
            {/* Icon and instructions - same as ImportScreen */}
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10">
                <img src={lockIcon} alt="" className="w-full h-full" />
              </div>
              <p
                className="font-sans font-medium text-center text-[var(--color-text-primary)]"
                style={{
                  fontSize: 'var(--font-size-base)',
                  lineHeight: 'var(--line-height-snug)',
                  letterSpacing: '0.01em',
                }}
              >
                Enter your 24-word secret phrase.
                <br />
                Paste into first field to auto-fill all words.
              </p>
            </div>

            {/* 24-word input grid */}
            <div className="flex flex-col gap-2 w-full pb-4">
              {Array.from({ length: 12 }).map((_, rowIndex) => (
                <div key={rowIndex} className="flex gap-2 w-full">
                  {[0, 1].map(col => {
                    const index = rowIndex * 2 + col;
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
                          {index + 1}
                        </span>
                        <input
                          ref={el => {
                            inputRefs.current[index] = el;
                          }}
                          type="text"
                          value={words[index] || ''}
                          onChange={e => handleWordChange(index, e.target.value)}
                          onKeyDown={e => handleKeyDown(index, e)}
                          onPaste={e => handlePaste(index, e)}
                          placeholder="word"
                          autoComplete="off"
                          spellCheck="false"
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

            <button
              type="button"
              onClick={handlePasteAll}
              className="font-sans font-medium text-center text-[var(--color-text-primary)] underline hover:opacity-70 transition-opacity"
              style={{
                fontSize: 'var(--font-size-base)',
                lineHeight: 'var(--line-height-snug)',
                letterSpacing: '0.01em',
              }}
            >
              Paste all
            </button>

            {discoverError && <Alert type="error">{discoverError}</Alert>}
          </div>
        </div>

        {/* Bottom buttons */}
        <div className="border-t border-[var(--color-surface-800)] px-4 py-3">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                resetV0MigrationDraft();
                navigate('settings');
              }}
              className="flex-1 h-12 px-5 py-[15px] bg-[var(--color-surface-800)] text-[var(--color-text-primary)] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 font-sans font-medium"
              style={{
                fontSize: 'var(--font-size-base)',
                lineHeight: 'var(--line-height-snug)',
                letterSpacing: '0.01em',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canContinue || isDiscovering}
              onClick={handleContinue}
              className="flex-1 h-12 px-5 py-[15px] bg-[var(--color-primary)] text-[#000000] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed font-sans font-medium"
              style={{
                fontSize: 'var(--font-size-base)',
                lineHeight: 'var(--line-height-snug)',
                letterSpacing: '0.01em',
              }}
            >
              {isDiscovering ? 'Checking v0 balance...' : 'Import Wallet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
