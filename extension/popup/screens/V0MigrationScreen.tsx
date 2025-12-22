import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS } from '../../shared/constants';
import IrisLogo96 from '../assets/iris-logo-96.svg';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { validateMnemonic } from '../../shared/wallet-crypto';
import { formatWalletError } from '../utils/formatWalletError';

export function V0MigrationScreen() {
  const { navigate } = useStore();

  const [seedphrase, setSeedphrase] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const [hasStored, setHasStored] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  function handleBack() {
    navigate('settings');
  }

  const canSave = useMemo(() => {
    const normalized = seedphrase.trim().toLowerCase().replace(/\s+/g, ' ');
    if (normalized.length === 0) return false;
    // BIP39 allows 12–24 words, multiples of 3 (12/15/18/21/24). We rely on validateMnemonic.
    return validateMnemonic(normalized);
  }, [seedphrase]);

  useEffect(() => {
    (async () => {
      try {
        const res = await send<{ ok?: boolean; has?: boolean; error?: string }>(
          INTERNAL_METHODS.HAS_V0_SEEDPHRASE,
          []
        );
        if (res?.ok) {
          setHasStored(Boolean(res.has));
        } else if ((res as any)?.error) {
          setError(formatWalletError((res as any).error));
        } else {
          setError('Failed to check v0 seedphrase status');
        }
      } catch {
        setError('Failed to check v0 seedphrase status');
      }
    })();
  }, []);

  async function handleSave() {
    // Prevent overwriting while the status is still unknown or already stored.
    if (hasStored !== false) {
      if (hasStored === null) {
        setError('Still checking whether a v0 seedphrase is already stored. Please wait.');
      } else {
        setError('A v0 seedphrase is already stored. Remove it to enter a new one.');
      }
      return;
    }

    setIsLoading(true);
    setError('');
    setStatus('');
    try {
      const normalized = seedphrase.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!validateMnemonic(normalized)) {
        setError('Invalid BIP39 seedphrase');
        return;
      }

      const res = await send<{ ok?: boolean; error?: unknown }>(
        INTERNAL_METHODS.SET_V0_SEEDPHRASE,
        [normalized, passphrase || '']
      );

      if ((res as any)?.error) {
        setError(formatWalletError((res as any).error));
        return;
      }

      setHasStored(true);
      setStatus('v0 seedphrase stored securely in Iris.');
      setSeedphrase('');
      setPassphrase('');
    } catch (err) {
      setError('Failed to store v0 seedphrase');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleClear() {
    setIsLoading(true);
    setError('');
    setStatus('');
    try {
      const res = await send<{ ok?: boolean; error?: unknown }>(
        INTERNAL_METHODS.CLEAR_V0_SEEDPHRASE,
        []
      );

      if ((res as any)?.error) {
        setError(formatWalletError((res as any).error));
        return;
      }

      setHasStored(false);
      setStatus('Removed stored v0 seedphrase.');
    } catch (err) {
      setError('Failed to remove v0 seedphrase');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col overflow-y-auto"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      <header
        className="flex items-center justify-between px-4 py-3 min-h-[64px]"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Back"
          className="w-8 h-8 p-2 flex items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2"
          style={{ backgroundColor: 'transparent', color: 'var(--color-text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">
          Upgrade v0 → v1
        </h1>
        <div className="w-8 h-8" />
      </header>

      <div className="flex flex-1 flex-col px-4 py-6 gap-4">
        <div className="flex flex-col items-center gap-2">
          <img src={IrisLogo96} alt="Iris" className="w-16 h-16" />
          <p
            className="m-0 text-[13px] leading-[18px] tracking-[0.26px] text-center"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Store your legacy (v0) seedphrase in Iris so websites can migrate without ever seeing
            it.
          </p>
        </div>

        <div
          className="p-3 rounded-lg text-xs"
          style={{ backgroundColor: 'var(--color-surface-800)', color: 'var(--color-text-muted)' }}
        >
          Status: {hasStored === null ? 'Checking…' : hasStored ? 'Stored' : 'Not stored'}
        </div>

        <div className="flex flex-col gap-3">
          {hasStored === true ? (
            <div
              className="p-3 rounded-lg text-xs"
              style={{
                backgroundColor: 'var(--color-surface-800)',
                color: 'var(--color-text-muted)',
              }}
            >
              A v0 seedphrase is already stored. Remove it to enter a new one.
            </div>
          ) : hasStored === false ? (
            <>
              <label className="text-[13px] leading-[18px] tracking-[0.26px] font-medium">
                v0 seedphrase
              </label>
              <textarea
                className="w-full min-h-[92px] bg-transparent rounded-lg p-3 outline-none text-sm"
                style={{
                  border: '1px solid var(--color-surface-700)',
                  color: 'var(--color-text-primary)',
                }}
                placeholder="Enter your v0 seedphrase (12–24 words)"
                value={seedphrase}
                onChange={e => {
                  setSeedphrase(e.target.value);
                  setError('');
                  setStatus('');
                }}
                disabled={isLoading || hasStored !== false}
              />

              <label className="text-[13px] leading-[18px] tracking-[0.26px] font-medium">
                Optional BIP39 passphrase
              </label>
              <input
                className="w-full h-[44px] bg-transparent rounded-lg px-3 outline-none text-sm"
                style={{
                  border: '1px solid var(--color-surface-700)',
                  color: 'var(--color-text-primary)',
                }}
                placeholder="(leave empty if none)"
                value={passphrase}
                onChange={e => {
                  setPassphrase(e.target.value);
                  setError('');
                  setStatus('');
                }}
                disabled={isLoading || hasStored !== false}
              />
            </>
          ) : (
            <div
              className="p-3 rounded-lg text-xs"
              style={{
                backgroundColor: 'var(--color-surface-800)',
                color: 'var(--color-text-muted)',
              }}
            >
              Checking if a v0 seedphrase is already stored…
            </div>
          )}

          {error && (
            <p className="m-0 text-xs" style={{ color: 'var(--color-red)' }}>
              {error}
            </p>
          )}
          {status && (
            <p className="m-0 text-xs" style={{ color: 'var(--color-text-primary)' }}>
              {status}
            </p>
          )}

          {hasStored === false && (
            <button
              onClick={handleSave}
              disabled={isLoading || !canSave}
              className="w-full h-12 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
            >
              {isLoading ? 'Working…' : 'Store v0 seedphrase'}
            </button>
          )}

          <button
            onClick={handleClear}
            disabled={isLoading || !hasStored}
            className="w-full h-12 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50"
            style={{ backgroundColor: 'transparent', border: '1px solid var(--color-surface-700)' }}
          >
            Remove stored v0 seedphrase
          </button>

          <p
            className="m-0 text-[12px] leading-4 tracking-[0.24px] text-center"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Warning: NEVER share your seedphrase.
          </p>
        </div>
      </div>
    </div>
  );
}
