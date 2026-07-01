import { useState } from 'react';
import { useStore } from '../store';
import { AnimatedLogo } from '../components/AnimatedLogo';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { PasswordInput } from '../components/PasswordInput';
import {
  NocksterDeviceLockedError,
  listNocksterAccounts,
  type PairedNocksterAccount,
  type NocksterTransportMode,
} from '../utils/nockster';
import { truncateAddress } from '../utils/format';
import vectorLeft from '../assets/vector-left.svg';
import vectorRight from '../assets/vector-right.svg';

export function NocksterConnectScreen() {
  const { navigate, createExternalSeedSource } = useStore();
  const [connectingTransport, setConnectingTransport] = useState<NocksterTransportMode | null>(null);
  const [lastTransport, setLastTransport] = useState<NocksterTransportMode>('hid');
  const [needsPin, setNeedsPin] = useState(false);
  const [pin, setPin] = useState('');
  const [availableAccounts, setAvailableAccounts] = useState<PairedNocksterAccount[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  function accountKey(account: PairedNocksterAccount): string {
    return `${account.slot}:${account.path.join('/')}:${account.publicKeyHex}`;
  }

  function accountLabel(account: PairedNocksterAccount): string {
    return `Slot ${account.slot}`;
  }

  async function handleLoadAccounts(transport: NocksterTransportMode) {
    setLastTransport(transport);
    setConnectingTransport(transport);
    setError('');
    try {
      const unlockPin = needsPin ? pin.trim() : undefined;
      const accounts = await listNocksterAccounts(transport, unlockPin || undefined);
      setAvailableAccounts(accounts);
      setSelectedKeys(new Set(accounts.map(accountKey)));
      setNeedsPin(false);
      setPin('');
    } catch (err) {
      handleConnectionError(err);
    } finally {
      setConnectingTransport(null);
    }
  }

  function handleConnectionError(err: unknown) {
    if (err instanceof NocksterDeviceLockedError) {
      setNeedsPin(true);
      setError(err.message);
      return;
    }

    const message = err instanceof Error ? err.message : 'Failed to connect Nockster';
    if (message === 'Wrong PIN') {
      setNeedsPin(true);
      setPin('');
    }
    setError(message);
  }

  function toggleAccount(account: PairedNocksterAccount) {
    const key = accountKey(account);
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleImportSelected() {
    const selected = availableAccounts.filter(account => selectedKeys.has(accountKey(account)));
    if (!selected.length) return;

    setConnectingTransport(lastTransport);
    setError('');
    try {
      const errors: string[] = [];
      for (const account of selected) {
        const label = accountLabel(account);
        const result = await createExternalSeedSource({
          address: account.address,
          name: `Nockster ${label}`,
          provider: 'nockster',
          sourceRef: JSON.stringify({
            slot: account.slot,
            path: account.path,
            publicKeyHex: account.publicKeyHex,
            publicKeyBase58: account.publicKeyBase58,
            transport: account.transport,
            firmware: account.firmware,
          }),
          accountRef: account.publicKeyBase58,
          publicKeyHex: account.publicKeyHex,
          slot: account.slot,
          path: account.path,
        });

        if (result?.error) {
          errors.push(`${label}: ${result.error}`);
        }
      }

      if (errors.length === selected.length) {
        throw new Error(errors.join('; '));
      }

      navigate('home');
      if (errors.length) {
        console.warn('[Nockster] Some imports failed:', errors);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import Nockster accounts');
    } finally {
      setConnectingTransport(null);
    }
  }

  const isConnecting = connectingTransport !== null;

  return (
    <div className="relative w-[357px] h-[600px] bg-[var(--color-bg)] overflow-hidden">
      <img
        src={vectorLeft}
        alt=""
        className="absolute left-[-11px] top-[199px] w-[89px] h-[70px]"
        aria-hidden="true"
      />
      <img
        src={vectorRight}
        alt=""
        className="absolute left-[305px] top-[311px] w-[52px] h-[83px]"
        aria-hidden="true"
      />

      <header className="relative z-10 flex items-center justify-between px-4 py-3 min-h-[64px]">
        <button
          type="button"
          onClick={() => navigate('wallet-add-start')}
          aria-label="Back"
          className="w-8 h-8 rounded-lg p-2 flex items-center justify-center transition-colors"
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">
          Connect Nockster
        </h1>
        <div className="w-8 h-8" />
      </header>

      <div className="relative z-10 flex flex-col justify-between h-[536px] px-4 pb-3">
        <div className="flex flex-col items-center gap-5 pt-10">
          <div className="w-[104px] h-[104px] flex items-center justify-center">
            <AnimatedLogo />
          </div>
          <div className="flex flex-col gap-2 items-center text-center w-full">
            <h2 className="font-serif font-medium text-[var(--color-text-primary)] text-2xl leading-8">
              Pair hardware wallet
            </h2>
            <p className="font-sans text-sm leading-5 text-[var(--color-text-muted)]">
              Select your Nockster connection, then choose wallets to import.
            </p>
          </div>

          {error && (
            <div
              className="w-full rounded-lg p-3 text-sm"
              style={{ backgroundColor: 'var(--color-surface-800)', color: '#ff6b6b' }}
            >
              {error}
            </div>
          )}

          {needsPin && (
            <div className="flex flex-col gap-2 w-full">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                Nockster PIN
              </label>
              <PasswordInput
                value={pin}
                onChange={setPin}
                placeholder="Enter device PIN"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && pin.trim() && !isConnecting) {
                    void handleLoadAccounts(lastTransport);
                  }
                }}
              />
            </div>
          )}

          {availableAccounts.length > 0 && (
            <div className="w-full max-h-[188px] overflow-y-auto flex flex-col gap-2">
              {availableAccounts.map(account => {
                const key = accountKey(account);
                const checked = selectedKeys.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleAccount(account)}
                    className="w-full rounded-lg px-3 py-2.5 flex items-center gap-3 text-left"
                    style={{ backgroundColor: 'var(--color-surface-800)' }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      className="w-4 h-4 accent-[var(--color-primary)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[var(--color-text-primary)]">
                        {accountLabel(account)}
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)] truncate">
                        {truncateAddress(account.address)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 w-full">
          {availableAccounts.length > 0 ? (
            <button
              type="button"
              onClick={() => void handleImportSelected()}
              disabled={isConnecting || selectedKeys.size === 0}
              className="h-12 px-5 py-[15px] bg-[var(--color-primary)] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 disabled:opacity-70"
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--font-size-base)',
                fontWeight: 500,
                lineHeight: 'var(--line-height-snug)',
                letterSpacing: '0.01em',
                color: '#000000',
              }}
            >
              {isConnecting ? 'Importing...' : `Import selected (${selectedKeys.size})`}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleLoadAccounts('hid')}
                disabled={isConnecting || (needsPin && !pin.trim())}
                className="h-12 px-5 py-[15px] bg-[var(--color-primary)] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 disabled:opacity-70"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--font-size-base)',
                  fontWeight: 500,
                  lineHeight: 'var(--line-height-snug)',
                  letterSpacing: '0.01em',
                  color: '#000000',
                }}
              >
                {connectingTransport === 'hid' ? 'Connecting...' : 'Connect via HID'}
              </button>
              <button
                type="button"
                onClick={() => void handleLoadAccounts('serial')}
                disabled={isConnecting || (needsPin && !pin.trim())}
                className="h-12 px-5 py-[15px] bg-[var(--color-surface-800)] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 disabled:opacity-70"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--font-size-base)',
                  fontWeight: 500,
                  lineHeight: 'var(--line-height-snug)',
                  letterSpacing: '0.01em',
                  color: 'var(--color-text-primary)',
                }}
              >
                {connectingTransport === 'serial' ? 'Connecting...' : 'Connect via Serial'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() =>
              availableAccounts.length > 0 ? setAvailableAccounts([]) : navigate('wallet-add-start')
            }
            className="h-12 px-5 py-[15px] bg-transparent rounded-lg flex items-center justify-center transition-opacity hover:opacity-70"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-base)',
              fontWeight: 500,
              lineHeight: 'var(--line-height-snug)',
              letterSpacing: '0.01em',
              color: 'var(--color-text-muted)',
            }}
          >
            {availableAccounts.length > 0 ? 'Back' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
