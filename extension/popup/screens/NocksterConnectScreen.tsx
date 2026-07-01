import { useState } from 'react';
import { useStore } from '../store';
import { AnimatedLogo } from '../components/AnimatedLogo';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { pairNocksterAccount } from '../utils/nockster';
import vectorLeft from '../assets/vector-left.svg';
import vectorRight from '../assets/vector-right.svg';

export function NocksterConnectScreen() {
  const { navigate, createExternalSeedSource } = useStore();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');

  async function handleConnect() {
    setIsConnecting(true);
    setError('');
    try {
      const paired = await pairNocksterAccount();
      const result = await createExternalSeedSource({
        address: paired.address,
        name: 'Nockster',
        provider: 'nockster',
        sourceRef: JSON.stringify({
          slot: paired.slot,
          path: paired.path,
          publicKeyHex: paired.publicKeyHex,
          publicKeyBase58: paired.publicKeyBase58,
          firmware: paired.firmware,
        }),
        accountRef: paired.publicKeyBase58,
        publicKeyHex: paired.publicKeyHex,
        slot: paired.slot,
        path: paired.path,
      });

      if (result?.error) {
        throw new Error(result.error);
      }
      navigate('home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Nockster');
    } finally {
      setIsConnecting(false);
    }
  }

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
        <div className="flex flex-col items-center gap-8 pt-10">
          <div className="w-[104px] h-[104px] flex items-center justify-center">
            <AnimatedLogo />
          </div>
          <div className="flex flex-col gap-2 items-center text-center w-full">
            <h2 className="font-serif font-medium text-[var(--color-text-primary)] text-2xl leading-8">
              Pair hardware wallet
            </h2>
            <p className="font-sans text-sm leading-5 text-[var(--color-text-muted)]">
              Select your Nockster, then confirm the address on the device.
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
        </div>

        <div className="flex flex-col gap-3 w-full">
          <button
            type="button"
            onClick={handleConnect}
            disabled={isConnecting}
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
            {isConnecting ? 'Connecting...' : 'Connect Nockster'}
          </button>
          <button
            type="button"
            onClick={() => navigate('wallet-add-start')}
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
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
