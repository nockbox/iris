import { useState } from 'react';
import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import BaseIconAsset from '../assets/base_icon.svg';
import { BRIDGE_PROTOCOL_FEE_DISPLAY } from '../../shared/constants';

function truncate(addr: string): string {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
}

export function SwapReviewScreen() {
  const { navigate, pendingBridgeSwap, setPendingBridgeSwap } = useStore();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!pendingBridgeSwap) {
    navigate('swap');
    return null;
  }
  const prepared = pendingBridgeSwap;

  const amountNock = prepared.amountNock.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  async function handleSwap() {
    setSubmitting(true);
    setError('Bridge execution is temporarily disabled while API migration is in progress.');
    setSubmitting(false);
  }

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      <header
        className="flex items-center justify-between h-16 px-4"
        style={{ borderBottom: '1px solid var(--color-divider)' }}
      >
        <button className="p-2" onClick={() => navigate('swap')} aria-label="Back">
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-[16px] font-medium tracking-[0.01em]">Swap review</h1>
        <div className="w-7" />
      </header>

      <div className="flex-1 px-4 py-5 flex flex-col gap-4">
        <div className="text-[20px] font-medium">You&apos;re swapping</div>

        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-home-accent)' }}>
          <div className="text-[50px] font-[Lora] leading-[50px] tracking-[-0.03em]">
            {amountNock} NOCK
          </div>
          <div className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
            Nockchain
          </div>
        </div>

        <div className="text-center text-[20px]" style={{ color: 'var(--color-text-muted)' }}>
          ↓
        </div>

        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-home-accent)' }}>
          <div className="text-[50px] font-[Lora] leading-[50px] tracking-[-0.03em]">
            {amountNock} NOCK
          </div>
          <div className="text-[13px] flex items-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
            Base <img src={BaseIconAsset} alt="" className="w-3 h-3" />
          </div>
        </div>

        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-home-accent)' }}>
          <div className="flex items-center justify-between text-[15px]">
            <span>Receiving address</span>
            <span className="flex items-center gap-2">
              {truncate(prepared.destinationAddress)}
              <img src={BaseIconAsset} alt="" className="w-3 h-3" />
            </span>
          </div>
        </div>

        <div className="h-px" style={{ backgroundColor: 'var(--color-divider)' }} />

        <div className="flex items-center justify-between text-[15px]">
          <span>Bridge fee {BRIDGE_PROTOCOL_FEE_DISPLAY}</span>
          <span style={{ color: 'var(--color-text-muted)' }}>{prepared.bridgeFeeLabel}</span>
        </div>

        {error && (
          <div
            className="rounded-lg px-3 py-2 text-[13px] font-medium"
            style={{ backgroundColor: 'var(--color-red-light)', color: 'var(--color-red)' }}
          >
            {error}
          </div>
        )}
      </div>

      <div className="flex gap-3 p-3" style={{ borderTop: '1px solid var(--color-divider)' }}>
        <button
          className="flex-1 rounded-lg px-5 py-3.5 text-[14px] leading-[18px] font-medium"
          style={{ backgroundColor: 'var(--color-surface-800)' }}
          onClick={() => {
            setPendingBridgeSwap(null);
            navigate('swap');
          }}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          className="flex-1 rounded-lg px-5 py-3.5 text-[14px] leading-[18px] font-medium"
          style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
          onClick={handleSwap}
          disabled={submitting}
        >
          {submitting ? 'Loading...' : 'Swap'}
        </button>
      </div>
    </div>
  );
}

