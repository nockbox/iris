import { useState } from 'react';
import { useStore } from '../store';
import { formatNock } from '../../shared/currency';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { CheckIcon } from '../components/icons/CheckIcon';
import { SendPaperPlaneIcon } from '../components/icons/SendPaperPlaneIcon';
import { truncateAddress } from '../utils/format';

export function SendSubmittedScreen() {
  const { navigate, lastTransaction, priceUsd, blockExplorerUrl } = useStore();
  const [copiedTxId, setCopiedTxId] = useState(false);

  function handleBack() {
    navigate('home');
  }

  if (!lastTransaction) {
    navigate('home');
    return null;
  }

  const sentAmount = formatNock(lastTransaction.amount);
  const sentUsdValue =
    priceUsd && lastTransaction.amount > 0
      ? `$${(lastTransaction.amount * priceUsd).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : '—';

  const txId = lastTransaction.txid;

  function handleViewExplorer() {
    if (!txId) return;
    const base = blockExplorerUrl.replace(/\/$/, '');
    window.open(`${base}/tx/${txId}`, '_blank');
  }

  async function handleCopyTxId() {
    if (!txId) return;
    try {
      await navigator.clipboard.writeText(txId);
      setCopiedTxId(true);
      setTimeout(() => setCopiedTxId(false), 2000);
    } catch (err) {
      console.error('Failed to copy transaction ID:', err);
    }
  }

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 min-h-[64px]"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Back"
          className="w-8 h-8 p-2 rounded-lg flex items-center justify-center hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-text-primary)' }}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1
          className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Submitted
        </h1>
        <div className="w-8 h-8" />
      </header>

      {/* Content */}
      <div className="flex flex-col h-[536px]" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="flex flex-col gap-8 px-4 py-2 flex-1">
          {/* Success Section */}
          <div className="flex flex-col items-center gap-3 w-full">
            <div
              className="w-10 h-10 flex items-center justify-center"
              style={{ color: 'var(--color-primary)' }}
            >
              <SendPaperPlaneIcon className="w-10 h-10" />
            </div>
            <div className="flex flex-col items-center gap-2 w-full text-center">
              <h2
                className="m-0 font-[Lora] text-2xl font-medium leading-7 tracking-[-0.48px]"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Your transaction
                <br />
                is pending
              </h2>
              <p
                className="m-0 text-[13px] leading-[18px] tracking-[0.26px]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Check the transaction activity below for confirmation updates
              </p>
            </div>
          </div>

          {/* Transaction Summary */}
          <div className="flex flex-col gap-2 w-full">
            <div
              className="rounded-lg p-3 flex items-start justify-between gap-2.5"
              style={{ backgroundColor: 'var(--color-surface-900)' }}
            >
              <div
                className="text-sm font-medium leading-[18px] tracking-[0.14px]"
                style={{ color: 'var(--color-text-primary)' }}
              >
                You sent
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                <div
                  className="text-sm font-medium leading-[18px] tracking-[0.14px] whitespace-nowrap"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {sentAmount} NOCK
                </div>
                <div
                  className="text-[13px] leading-[18px] tracking-[0.26px]"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {sentUsdValue}
                </div>
              </div>
            </div>

            {txId && (
              <>
                <div
                  className="rounded-lg p-3 flex items-center justify-between gap-2.5"
                  style={{ backgroundColor: 'var(--color-surface-900)' }}
                >
                  <div
                    className="text-sm font-medium leading-[18px] tracking-[0.14px]"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    Transaction ID
                  </div>
                  <div
                    className="text-sm font-medium leading-[18px] tracking-[0.14px] truncate"
                    style={{ color: 'var(--color-text-muted)' }}
                    title={txId}
                  >
                    {truncateAddress(txId)}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleViewExplorer}
                    className="flex-1 py-[7px] px-3 bg-transparent rounded-full text-sm font-medium leading-[18px] tracking-[0.14px] transition-colors focus:outline-none focus-visible:ring-2 whitespace-nowrap"
                    style={{
                      border: '1px solid var(--color-surface-700)',
                      color: 'var(--color-text-primary)',
                    }}
                    onMouseEnter={e =>
                      (e.currentTarget.style.backgroundColor = 'var(--color-surface-900)')
                    }
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    View on explorer
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyTxId}
                    disabled={copiedTxId}
                    className="flex-1 py-[7px] px-3 bg-transparent rounded-full text-sm font-medium leading-[18px] tracking-[0.14px] transition-colors focus:outline-none focus-visible:ring-2 whitespace-nowrap disabled:opacity-100 flex items-center justify-center gap-1.5"
                    style={{
                      border: '1px solid var(--color-surface-700)',
                      color: 'var(--color-text-primary)',
                    }}
                    onMouseEnter={e => {
                      if (!copiedTxId) {
                        e.currentTarget.style.backgroundColor = 'var(--color-surface-900)';
                      }
                    }}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    {copiedTxId && <CheckIcon className="w-3.5 h-3.5" />}
                    {copiedTxId ? 'Copied!' : 'Copy transaction ID'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 px-4 py-3 w-full">
          <button
            type="button"
            onClick={handleBack}
            className="flex-1 h-12 inline-flex items-center justify-center rounded-lg text-sm font-medium leading-[18px] tracking-[0.14px] transition-opacity hover:opacity-90 active:opacity-80"
            style={{
              color: 'var(--color-bg)',
              backgroundColor: 'var(--color-text-primary)',
            }}
          >
            Back to overview
          </button>
        </div>
      </div>
    </div>
  );
}
