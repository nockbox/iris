import { useRef, useState } from 'react';
import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { Alert } from '../components/Alert';
import lockIcon from '../assets/lock-icon.svg';
import { importKeyfile, type Keyfile } from '../../shared/keyfile';
import { UI_CONSTANTS } from '../../shared/constants';
import { queryV0Balance } from '../../shared/v0-migration';

const WORD_COUNT = 24;

export function V0MigrationSetupScreen() {
  const { navigate, setV0MigrationDraft } = useStore();
  const [showKeyfileImport, setShowKeyfileImport] = useState(false);
  const [keyfileError, setKeyfileError] = useState('');
  const [discoverError, setDiscoverError] = useState('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [words, setWords] = useState<string[]>(Array(WORD_COUNT).fill(''));
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setKeyfileError('');
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const keyfile = JSON.parse(e.target?.result as string) as Keyfile;
        const mnemonic = importKeyfile(keyfile);
        const importedWords = mnemonic.trim().split(/\s+/);
        if (importedWords.length !== UI_CONSTANTS.MNEMONIC_WORD_COUNT) {
          setKeyfileError('Invalid keyfile: expected 24 words');
          return;
        }
        const next = Array(WORD_COUNT).fill('');
        importedWords.forEach((word, i) => {
          next[i] = word;
        });
        setWords(next);
        setShowKeyfileImport(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (err) {
        setKeyfileError(err instanceof Error ? err.message : 'Invalid keyfile format');
      }
    };
    reader.readAsText(file);
  }

  function handleCancelKeyfileImport() {
    setShowKeyfileImport(false);
    setKeyfileError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleContinue() {
    if (!canContinue || isDiscovering) return;

    setDiscoverError('');
    setIsDiscovering(true);
    try {
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

      setV0MigrationDraft({
        sourceAddress: result.sourceAddress,
        v0Mnemonic: mnemonic,
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

            {/* Or import from keyfile - same as ImportScreen */}
            <button
              type="button"
              onClick={() => setShowKeyfileImport(true)}
              className="font-sans font-medium text-center text-[var(--color-text-primary)] underline hover:opacity-70 transition-opacity"
              style={{
                fontSize: 'var(--font-size-base)',
                lineHeight: 'var(--line-height-snug)',
                letterSpacing: '0.01em',
              }}
            >
              Or import from keyfile
            </button>

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
              onClick={() => navigate('settings')}
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

      {/* Keyfile Import Modal - same as onboarding ImportScreen */}
      {showKeyfileImport && (
        <div
          className="absolute inset-0 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', zIndex: 50 }}
        >
          <div
            className="w-full max-w-[325px] rounded-lg p-4 flex flex-col gap-4"
            style={{
              backgroundColor: 'var(--color-bg)',
              border: '1px solid var(--color-surface-800)',
            }}
          >
            <h3 className="font-sans font-medium text-[var(--color-text-primary)] text-base tracking-[0.16px] leading-[22px]">
              Import from keyfile
            </h3>
            <p
              className="font-sans text-sm tracking-[0.14px] leading-[18px]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Select your keyfile to import your wallet.
            </p>

            <div className="flex flex-col gap-1.5">
              <label className="font-sans font-medium text-sm tracking-[0.14px] leading-[18px] text-[var(--color-text-primary)]">
                Select keyfile
              </label>
              <input
                ref={fileInputRef}
                id="keyfile-upload-migration"
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-[52px] px-4 rounded-lg font-sans font-medium text-sm tracking-[0.14px] leading-[18px] text-left transition-opacity hover:opacity-90 text-[var(--color-text-primary)]"
                style={{
                  backgroundColor: 'var(--color-surface-700)',
                  border: '1px solid var(--color-surface-800)',
                }}
              >
                Choose File
              </button>
            </div>

            {keyfileError && <Alert type="error">{keyfileError}</Alert>}

            <button
              type="button"
              onClick={handleCancelKeyfileImport}
              className="w-full h-12 rounded-lg font-sans font-medium text-sm tracking-[0.14px] leading-[18px] transition-opacity hover:opacity-90 text-[var(--color-text-primary)]"
              style={{
                backgroundColor: 'var(--color-surface-700)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
