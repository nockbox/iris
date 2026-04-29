import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import DownArrow from '../assets/downArrow.svg';
import BaseIconAsset from '../assets/base_icon.svg';
import NockTextCircleContainer from '../assets/NockTextCircleContainer.svg';
import NockText from '../assets/NockText.svg';
import JustNText from '../assets/JustNText.svg';
import UpDownVec from '../assets/upDownvec.svg';
import { MIN_BRIDGE_AMOUNT_NOCK, isEvmAddress } from '@nockbox/iris-sdk';
import { formatWithCommas, parseAmount } from '../utils/format';

export function SwapScreen() {
  const { navigate, wallet, setPendingBridgeSwap, priceUsd, isBalanceFetching } = useStore();
  const [amount, setAmount] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState('');
  const [amountFontSizePx, setAmountFontSizePx] = useState(36);
  const amountContainerRef = useRef<HTMLDivElement>(null);
  const measureInputRef = useRef<HTMLSpanElement>(null);

  const spendableNock = wallet.spendableBalance;
  const amountNum = parseAmount(amount);

  // Single consolidated message: never show two at once. Uses same wallet.spendableBalance as Home.
  // Don't show spendable-below-min while balance is loading (same pattern as HomeScreen skeleton).
  const consolidatedAmountError = useMemo(() => {
    if (!amount) return '';
    if (Number.isNaN(amountNum) || amountNum <= 0) return 'Enter a valid amount';
    if (spendableNock < MIN_BRIDGE_AMOUNT_NOCK && !(isBalanceFetching && spendableNock === 0)) {
      return `Spendable balance (${spendableNock.toLocaleString('en-US', { maximumFractionDigits: 2 })} NOCK) is less than minimum bridge amount (${MIN_BRIDGE_AMOUNT_NOCK.toLocaleString()} NOCK).`;
    }
    if (amountNum < MIN_BRIDGE_AMOUNT_NOCK) {
      return `Minimum swap amount is ${MIN_BRIDGE_AMOUNT_NOCK.toLocaleString()} NOCK`;
    }
    if (amountNum > spendableNock) return 'Insufficient spendable balance';
    return '';
  }, [amount, amountNum, spendableNock, isBalanceFetching]);

  async function handleReview() {
    setError('');
    if (!isEvmAddress(destinationAddress)) {
      setError('Enter a valid Base (EVM) address');
      return;
    }
    if (!amount.trim() || Number.isNaN(amountNum) || amountNum <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (consolidatedAmountError) {
      setError(consolidatedAmountError);
      return;
    }

    setIsPreparing(true);
    try {
      setPendingBridgeSwap({
        amountNock: amountNum,
        destinationAddress,
      });
      navigate('swap-review');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsPreparing(false);
    }
  }

  const hasDecimalPart = /\.\d/.test(amount.replace(/,/g, ''));
  const displayAmount = amount
    ? amountNum.toLocaleString('en-US', {
        minimumFractionDigits: hasDecimalPart ? 2 : 0,
        maximumFractionDigits: hasDecimalPart ? 2 : 0,
      })
    : '0.00';

  const usdValue =
    amountNum > 0 && priceUsd > 0
      ? (amountNum * priceUsd).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : null;

  const amountLineHeightPx = amountFontSizePx + 4;

  // Scale font only when amount text would overflow the available area.
  // Measure raw input (what user types) so reactivity works for any number of decimal digits.
  useEffect(() => {
    const container = amountContainerRef.current;
    const measureInput = measureInputRef.current;
    if (!container || !measureInput) return;
    let ro: ResizeObserver | null = null;
    const run = () => {
      const containerWidth = container.offsetWidth;
      const inputWidth = measureInput.offsetWidth;
      if (inputWidth <= 0) {
        setAmountFontSizePx(36);
        return;
      }
      if (inputWidth > containerWidth) {
        const scaled = (36 * containerWidth) / inputWidth;
        setAmountFontSizePx(Math.max(14, Math.min(36, scaled)));
      } else {
        setAmountFontSizePx(36);
      }
    };
    // Defer to next frame so DOM has laid out the new amount before measuring
    const raf = requestAnimationFrame(() => {
      run();
      ro = new ResizeObserver(() => run());
      ro.observe(container);
    });
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [amount]);

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      {/* Header - matches Figma */}
      <header
        className="flex h-16 items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--color-divider)' }}
      >
        <button
          type="button"
          onClick={() => navigate('home')}
          className="p-2 -ml-2 hover:opacity-70 transition-opacity text-[var(--color-text-primary)]"
          aria-label="Back"
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1
          className="font-sans font-medium text-[var(--color-text-primary)] whitespace-nowrap"
          style={{
            fontSize: 'var(--font-size-lg)',
            lineHeight: 'var(--line-height-normal)',
            letterSpacing: '0.01em',
          }}
        >
          Swap
        </h1>
        <div className="w-8" />
      </header>

      {/* Content - Figma: gap-8, wallet cards + swap direction circle */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="relative flex flex-col gap-2">
          {/* You pay (Nockchain) - white/bg card with border */}
          <div
            className="rounded-lg p-3 flex items-center justify-between gap-3"
            style={{
              backgroundColor: 'var(--color-bg)',
              border: '1px solid var(--color-divider)',
            }}
          >
            <div ref={amountContainerRef} className="flex flex-1 min-w-0 flex-col gap-2">
              {/* Hidden span to measure raw input width at 36px for overflow-based font scaling */}
              <span
                ref={measureInputRef}
                aria-hidden
                className="font-[Lora] font-semibold absolute left-0 top-0 pointer-events-none whitespace-nowrap opacity-0"
                style={{
                  fontSize: '36px',
                  letterSpacing: '-0.72px',
                }}
              >
                {amount || '0'}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={e => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                onBlur={() => {
                  if (amount.trim()) setAmount(formatWithCommas(amount));
                }}
                placeholder="0.00"
                className="w-full bg-transparent border-0 outline-none font-[Lora] font-semibold placeholder:text-[var(--color-text-muted)]"
                style={{
                  fontSize: `${amountFontSizePx}px`,
                  lineHeight: `${amountLineHeightPx}px`,
                  letterSpacing: '-0.72px',
                  color: amount ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                }}
              />
              <div
                className="text-[12px] leading-4 font-medium flex items-center gap-1.5"
                style={{ color: 'var(--color-text-muted)', letterSpacing: '0.24px' }}
              >
                {usdValue !== null ? `$${usdValue} USD` : '0 USD'}
                <img src={UpDownVec} alt="" className="h-3.5 w-3.5 shrink-0" />
              </div>
            </div>
            <div className="flex items-start gap-2 shrink-0 self-start">
              <div className="flex flex-col items-end text-right">
                <div
                  className="text-[14px] font-medium leading-[18px]"
                  style={{ letterSpacing: '0.14px' }}
                >
                  NOCK
                </div>
                <div
                  className="text-[12px] leading-4"
                  style={{ color: 'var(--color-text-muted)', letterSpacing: '0.24px' }}
                >
                  Nockchain
                </div>
              </div>
              {/* NOCK logo */}
              <div className="relative h-10 w-10 shrink-0 origin-center scale-110">
                <img src={NockTextCircleContainer} alt="" className="h-10 w-10" />
                <img
                  src={NockText}
                  alt=""
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[12px] w-[30px] object-contain"
                />
                {/* Small circle: container + N separate so you can tweak size/position of each */}
                <div
                  className="absolute -right-0.5 -bottom-0.5 h-4.5 w-4.5 rounded-full flex items-center justify-center shrink-0 border-2 border-[#F2F2F0]"
                  style={{
                    backgroundColor: 'black',
                  }}
                >
                  <img
                    src={JustNText}
                    alt=""
                    className="min-w-0 min-h-0 h-[7px] w-[6px] object-contain"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Swap direction - circle between cards (overlaps) */}
          <div className="relative flex justify-center h-0 -my-1 z-10">
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center p-1.5"
              style={{
                backgroundColor: 'white',
                border: '6px solid var(--color-surface-900)',
              }}
            >
              <img src={DownArrow} alt="" className="w-5 h-5" />
            </div>
          </div>

          {/* You receive (Base) - accent card */}
          <div
            className="rounded-lg p-3 flex items-center justify-between gap-3"
            style={{
              backgroundColor: 'var(--color-surface-900)',
              border: '1px solid var(--color-divider)',
            }}
          >
            <div className="flex flex-1 min-w-0 flex-col gap-2">
              <div
                className="font-[Lora] font-semibold"
                style={{
                  fontSize: `${amountFontSizePx}px`,
                  lineHeight: `${amountLineHeightPx}px`,
                  letterSpacing: '-0.72px',
                  color: amount ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                }}
              >
                {displayAmount}
              </div>
              <div
                className="text-[12px] leading-4 font-medium flex items-center gap-1.5"
                style={{ color: 'var(--color-text-muted)', letterSpacing: '0.24px' }}
              >
                {usdValue !== null ? `$${usdValue} USD` : '0 USD'}
                <img src={UpDownVec} alt="" className="h-3.5 w-3.5 shrink-0" />
              </div>
            </div>
            <div className="flex items-start gap-2 shrink-0 self-start">
              <div className="flex flex-col items-end text-right">
                <div
                  className="text-[14px] font-medium leading-[18px]"
                  style={{ letterSpacing: '0.14px' }}
                >
                  NOCK
                </div>
                <div
                  className="text-[12px] leading-4"
                  style={{ color: 'var(--color-text-muted)', letterSpacing: '0.24px' }}
                >
                  Base
                </div>
              </div>
              {/* Same as NOCK logo but small circle has white bg + Base icon */}
              <div className="relative h-10 w-10 shrink-0 origin-center scale-110">
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
                  <img
                    src={BaseIconAsset}
                    alt="Base"
                    className="min-w-0 min-h-0 h-[9px] w-[8px] object-contain"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Receiver address */}
          <div
            className="rounded-lg p-3 flex flex-col gap-2.5"
            style={{
              backgroundColor: 'var(--color-bg)',
              border: '1px solid var(--color-divider)',
            }}
          >
            <div className="flex items-center justify-between">
              <div
                className="text-[14px] font-medium leading-[18px]"
                style={{ color: 'var(--color-text-muted)', letterSpacing: '0.14px' }}
              >
                Receiver address
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="text-[12px] font-medium leading-4"
                  style={{ letterSpacing: '0.24px' }}
                >
                  Base
                </span>
                <div
                  className="h-5 w-5 rounded-full flex items-center justify-center shrink-0 border-2 border-[#F2F2F0]"
                  style={{ backgroundColor: 'white' }}
                >
                  <img
                    src={BaseIconAsset}
                    alt=""
                    className="min-w-0 min-h-0 h-[9px] w-[8px] object-contain"
                  />
                </div>
              </div>
            </div>
            <input
              type="text"
              value={destinationAddress}
              onChange={e => setDestinationAddress(e.target.value.trim())}
              placeholder="0x..."
              className="w-full bg-transparent border-0 outline-none text-[14px] font-medium leading-[18px]"
              style={{ letterSpacing: '0.14px' }}
            />
          </div>

          {(error || consolidatedAmountError) && (
            <div
              className="rounded-lg px-3 py-2 text-[13px] font-medium"
              style={{ backgroundColor: 'var(--color-red-light)', color: 'var(--color-red)' }}
            >
              {error || consolidatedAmountError}
            </div>
          )}
        </div>
      </div>

      {/* Footer - Cancel + Review */}
      <div
        className="flex gap-3 p-3 shrink-0"
        style={{ borderTop: '1px solid var(--color-divider)' }}
      >
        <button
          type="button"
          className="flex-1 rounded-lg px-5 py-3.5 text-[14px] leading-[18px] font-medium transition-opacity hover:opacity-90"
          style={{
            backgroundColor: 'var(--color-surface-800)',
            color: 'var(--color-text-primary)',
            letterSpacing: '0.14px',
          }}
          onClick={() => navigate('home')}
        >
          Cancel
        </button>
        <button
          type="button"
          className="flex-1 rounded-lg px-5 py-3.5 text-[14px] leading-[18px] font-medium transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: 'var(--color-primary)',
            color: '#000',
            letterSpacing: '0.14px',
          }}
          onClick={handleReview}
          disabled={false}
        >
          {isPreparing ? 'Preparing...' : 'Review'}
        </button>
      </div>
    </div>
  );
}
