import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import SwapIconAsset from '../assets/swap_icon.svg';
import BaseIconAsset from '../assets/base_icon.svg';
import { BRIDGE_PROTOCOL_FEE_DISPLAY, MIN_BRIDGE_AMOUNT_NOCK } from '../../shared/constants';

function isEvmAddress(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  const normalized = s.startsWith('0x') ? s : `0x${s}`;
  return /^0x[0-9a-fA-F]{40}$/.test(normalized);
}

export function SwapScreen() {
  const { navigate, wallet, setPendingBridgeSwap } = useStore();
  const [amount, setAmount] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState('');

  const spendableNock = wallet.spendableBalance;
  const amountNum = parseFloat(amount);

  const amountError = useMemo(() => {
    if (!amount) return '';
    if (Number.isNaN(amountNum) || amountNum <= 0) return 'Enter a valid amount';
    if (amountNum < MIN_BRIDGE_AMOUNT_NOCK) {
      return `Minimum swap amount is ${MIN_BRIDGE_AMOUNT_NOCK.toLocaleString()} NOCK`;
    }
    if (amountNum > spendableNock) return 'Insufficient spendable balance';
    return '';
  }, [amount, amountNum, spendableNock]);

  async function handleReview() {
    setError('');
    if (!isEvmAddress(destinationAddress)) {
      setError('Enter a valid Base (EVM) address');
      return;
    }
    if (amountError) {
      setError(amountError);
      return;
    }

    setIsPreparing(true);
    try {
      setPendingBridgeSwap({
        amountNock: amountNum,
        bridgeFeeLabel: BRIDGE_PROTOCOL_FEE_DISPLAY,
        destinationAddress,
      });
      navigate('swap-review');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsPreparing(false);
    }
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
        <button className="p-2" onClick={() => navigate('home')} aria-label="Back">
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-[16px] font-medium tracking-[0.01em]">Swap</h1>
        <div className="w-7" />
      </header>

      <div className="flex-1 px-4 py-4 flex flex-col gap-3">
        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: 'var(--color-home-accent)', border: '1px solid var(--color-divider)' }}
        >
          <div className="text-[13px] mb-1" style={{ color: 'var(--color-text-muted)' }}>
            You pay (Nockchain)
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder="0.00"
            className="w-full bg-transparent border-0 outline-none text-[40px] leading-[40px] font-[Lora] font-semibold tracking-[-0.03em]"
          />
          <div className="mt-1 text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
            Spendable: {spendableNock.toLocaleString('en-US', { maximumFractionDigits: 2 })} NOCK
          </div>
        </div>

        <div className="flex justify-center">
          <div
            className="h-10 w-10 rounded-full grid place-items-center"
            style={{ backgroundColor: 'var(--color-home-accent)', border: '1px solid var(--color-divider)' }}
          >
            <img src={SwapIconAsset} alt="" className="w-5 h-5" />
          </div>
        </div>

        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: 'var(--color-home-accent)', border: '1px solid var(--color-divider)' }}
        >
          <div className="text-[13px] mb-1" style={{ color: 'var(--color-text-muted)' }}>
            You receive (Base)
          </div>
          <div className="text-[40px] leading-[40px] font-[Lora] font-semibold tracking-[-0.03em]">
            {amount
              ? Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : '0.00'}
          </div>
          <div className="mt-1 text-[13px] flex items-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
            Base <img src={BaseIconAsset} alt="Base" className="w-3 h-3" />
          </div>
        </div>

        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: 'var(--color-home-accent)', border: '1px solid var(--color-divider)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
              Receiver address
            </div>
            <div className="text-[13px] flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
              Base <img src={BaseIconAsset} alt="" className="w-3 h-3" />
            </div>
          </div>
          <input
            type="text"
            value={destinationAddress}
            onChange={e => setDestinationAddress(e.target.value.trim())}
            placeholder="0x..."
            className="w-full bg-transparent border-0 outline-none text-[14px] font-medium"
          />
        </div>

        {(error || amountError) && (
          <div
            className="rounded-lg px-3 py-2 text-[13px] font-medium"
            style={{ backgroundColor: 'var(--color-red-light)', color: 'var(--color-red)' }}
          >
            {error || amountError}
          </div>
        )}
      </div>

      <div className="flex gap-3 p-3" style={{ borderTop: '1px solid var(--color-divider)' }}>
        <button
          className="flex-1 rounded-lg px-5 py-3.5 text-[14px] leading-[18px] font-medium"
          style={{ backgroundColor: 'var(--color-surface-800)' }}
          onClick={() => navigate('home')}
        >
          Cancel
        </button>
        <button
          className="flex-1 rounded-lg px-5 py-3.5 text-[14px] leading-[18px] font-medium"
          style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
          onClick={handleReview}
          disabled={isPreparing}
        >
          {isPreparing ? 'Preparing...' : 'Review'}
        </button>
      </div>
    </div>
  );
}

