import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { send } from '../utils/messaging';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import BaseIconAsset from '../assets/base_icon.svg';
import NockTextCircleContainer from '../assets/NockTextCircleContainer.svg';
import NockText from '../assets/NockText.svg';
import JustNText from '../assets/JustNText.svg';
import DownArrow from '../assets/downArrow.svg';
import { BRIDGE_PROTOCOL_FEE_RATE } from '@nockbox/iris-sdk';
import { INTERNAL_METHODS } from '../../shared/constants';
import { nockToNick, nickToNock } from '../../shared/currency';

const BRIDGE_DEBUG_NO_BROADCAST = true;

function truncate(addr: string): string {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
}

export function SwapReviewScreen() {
  const { navigate, pendingBridgeSwap, setPendingBridgeSwap, setSwapSubmittedToastVisible, priceUsd } = useStore();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [networkFeeNicks, setNetworkFeeNicks] = useState<number | null>(null);

  if (!pendingBridgeSwap) {
    navigate('swap');
    return null;
  }
  const prepared = pendingBridgeSwap;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await send<{ fee?: number; error?: string }>(
        INTERNAL_METHODS.ESTIMATE_BRIDGE_FEE,
        [prepared.destinationAddress, nockToNick(prepared.amountNock)]
      );
      if (!cancelled && result?.fee != null) {
        setNetworkFeeNicks(result.fee);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prepared.destinationAddress, prepared.amountNock]);

  const formatNock = (value: number, digits = 2) =>
    value.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });

  const formatUsd = (value: number) =>
    value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const sendAmountNock = prepared.amountNock;
  const bridgeProtocolFeeNock = sendAmountNock * BRIDGE_PROTOCOL_FEE_RATE;
  // Only the bridge protocol fee is deducted from the bridged amount.
  // Network fee is paid separately in NOCK on Nockchain and does not reduce
  // what lands on the destination chain.
  const receiveAmountNock = Math.max(sendAmountNock - bridgeProtocolFeeNock, 0);

  const sendAmountDisplay = formatNock(sendAmountNock);
  const receiveAmountDisplay = formatNock(receiveAmountNock);

  const sendUsdValue = priceUsd > 0 ? formatUsd(sendAmountNock * priceUsd) : null;
  const receiveUsdValue = priceUsd > 0 ? formatUsd(receiveAmountNock * priceUsd) : null;

  const networkFeeDisplay = networkFeeNicks != null ? formatNock(nickToNock(networkFeeNicks)) : '—';

  const bridgeProtocolFeeAmountDisplay = bridgeProtocolFeeNock.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
  const bridgeProtocolFeePercentLabel = `${(BRIDGE_PROTOCOL_FEE_RATE * 100).toFixed(1)}%`;

  async function handleSwap() {
    setSubmitting(true);
    setError('');

    try {
      const amountNicks = nockToNick(prepared.amountNock);
      const result = await send<{
        txid?: string;
        broadcasted?: boolean;
        walletTx?: unknown;
        error?: string;
      }>(INTERNAL_METHODS.SEND_BRIDGE_TRANSACTION, [
        prepared.destinationAddress,
        amountNicks,
        priceUsd > 0 ? priceUsd : undefined,
        BRIDGE_DEBUG_NO_BROADCAST,
      ]);

      if (result?.error) {
        setError(result.error);
        setSubmitting(false);
        return;
      }

      setPendingBridgeSwap(null);
      setSwapSubmittedToastVisible(true);
      useStore.getState().fetchBalance();
      useStore.getState().fetchWalletTransactions();
      navigate('home');
    } catch (err) {
      console.error('[SwapReview] Bridge failed:', err);
      setError(err instanceof Error ? err.message : 'Bridge transaction failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      <header
        className="flex items-center justify-between h-16 px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--color-divider)' }}
      >
        <button className="p-2 -ml-2" onClick={() => navigate('swap')} aria-label="Back">
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1
          className="text-[16px] font-medium"
          style={{ letterSpacing: '0.16px', lineHeight: '22px' }}
        >
          Swap review
        </h1>
        <div className="w-8" />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-2">
        <div
          className="text-[14px] font-medium"
          style={{ letterSpacing: '0.14px', lineHeight: '18px' }}
        >
          You&apos;re swapping
        </div>

        {/* From Nockchain card */}
        <div
          className="rounded-lg p-3 flex items-center justify-between gap-3"
          style={{ backgroundColor: 'var(--color-surface-900)' }}
        >
          <div className="flex flex-1 min-w-0 flex-col gap-1">
            <div
              className="font-[Lora] font-medium text-[24px] leading-7"
              style={{ letterSpacing: '-0.48px', color: 'var(--color-text-primary)' }}
            >
              {sendAmountDisplay} NOCK
            </div>
            <div
              className="text-[12px] font-medium"
              style={{ color: 'var(--color-text-muted)', letterSpacing: '0.24px', lineHeight: '16px' }}
            >
              {sendUsdValue !== null ? `≈${sendUsdValue} USD` : '—'}
            </div>
          </div>
          <div className="relative h-10 w-10 shrink-0">
            <img src={NockTextCircleContainer} alt="" className="h-10 w-10" />
            <img
              src={NockText}
              alt=""
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[12px] w-[30px] object-contain"
            />
            <div
              className="absolute -right-0.5 -bottom-0.5 h-4.5 w-4.5 rounded-full flex items-center justify-center shrink-0 border-2 border-[#F2F2F0]"
              style={{ backgroundColor: 'black' }}
            >
              <img src={JustNText} alt="" className="min-w-0 min-h-0 h-[7px] w-[6px] object-contain" />
            </div>
          </div>
        </div>

        {/* Down arrow */}
        <div className="flex justify-center py-0">
          <img src={DownArrow} alt="" className="w-5 h-5" />
        </div>

        {/* To Base card */}
        <div
          className="rounded-lg p-3 flex items-center justify-between gap-3"
          style={{ backgroundColor: 'var(--color-surface-900)' }}
        >
          <div className="flex flex-1 min-w-0 flex-col gap-1">
            <div
              className="font-[Lora] font-medium text-[24px] leading-7"
              style={{ letterSpacing: '-0.48px', color: 'var(--color-text-primary)' }}
            >
              {receiveAmountDisplay} NOCK
            </div>
            <div
              className="text-[12px] font-medium"
              style={{ color: 'var(--color-text-muted)', letterSpacing: '0.24px', lineHeight: '16px' }}
            >
              {receiveUsdValue !== null ? `≈${receiveUsdValue} USD` : '—'}
            </div>
          </div>
          <div className="relative h-10 w-10 shrink-0">
            <img src={NockTextCircleContainer} alt="" className="h-10 w-10" />
            <img
              src={NockText}
              alt=""
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[12px] w-[30px] object-contain"
            />
            <div
              className="absolute -right-0.5 -bottom-0.5 h-4.5 w-4.5 rounded-full flex items-center justify-center shrink-0 border-2 border-[#F2F2F0]"
              style={{ backgroundColor: 'white' }}
            >
              <img src={BaseIconAsset} alt="Base" className="min-w-0 min-h-0 h-[9px] w-[8px] object-contain" />
            </div>
          </div>
        </div>

        {/* Receiving address card */}
        <div
          className="rounded-lg p-3 flex items-center justify-between gap-2"
          style={{ backgroundColor: 'var(--color-surface-900)' }}
        >
          <div
            className="text-[14px] font-medium flex-1 min-w-0"
            style={{ letterSpacing: '0.14px', lineHeight: '18px' }}
          >
            Receiving address
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="text-[14px] font-medium"
              style={{ letterSpacing: '0.14px', lineHeight: '18px' }}
            >
              {truncate(prepared.destinationAddress)}
            </span>
            <div
              className="h-5 w-5 rounded-full flex items-center justify-center shrink-0 border-2 border-[#F2F2F0]"
              style={{ backgroundColor: 'white' }}
            >
              <img src={BaseIconAsset} alt="" className="h-[9px] w-[8px] object-contain" />
            </div>
          </div>
        </div>

        {/* Divider + Fees */}
        <div className="flex flex-col gap-3 pt-2">
          <div className="h-px" style={{ backgroundColor: 'var(--color-divider)' }} />
          <div className="flex items-center justify-between text-[14px] font-medium">
            <span style={{ letterSpacing: '0.14px', lineHeight: '18px' }}>Network fee</span>
            <span className="text-right" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.14px' }}>
              {networkFeeDisplay} NOCK
            </span>
          </div>
          <div className="flex items-center justify-between text-[14px] font-medium">
            <span style={{ letterSpacing: '0.14px', lineHeight: '18px' }}>
              Bridge fee {bridgeProtocolFeePercentLabel}
            </span>
            <span className="text-right" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.14px' }}>
              {bridgeProtocolFeeAmountDisplay} NOCK
            </span>
          </div>
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

      <div className="flex gap-3 p-3 shrink-0" style={{ borderTop: '1px solid var(--color-divider)' }}>
        <button
          className="flex-1 rounded-lg px-5 py-3.5 text-[14px] leading-[18px] font-medium transition-opacity hover:opacity-90"
          style={{
            backgroundColor: 'var(--color-surface-800)',
            color: 'var(--color-text-primary)',
            letterSpacing: '0.14px',
          }}
          onClick={() => {
            setPendingBridgeSwap(null);
            navigate('swap');
          }}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          className="flex-1 rounded-lg px-5 py-3.5 text-[14px] leading-[18px] font-medium transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--color-primary)', color: '#000', letterSpacing: '0.14px' }}
          onClick={handleSwap}
          disabled={submitting}
        >
          {submitting ? 'Loading...' : 'Swap'}
        </button>
      </div>
    </div>
  );
}
