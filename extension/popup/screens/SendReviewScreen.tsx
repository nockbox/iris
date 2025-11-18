import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { truncateAddress } from '../utils/format';
import { AccountIcon } from '../components/AccountIcon';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS } from '../../shared/constants';
import { nockToNick, formatNock, formatNick } from '../../shared/currency';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';

export function SendReviewScreen() {
  const { navigate, wallet, lastTransaction } = useStore();

  // If no transaction data, go back to send screen
  if (!lastTransaction) {
    navigate('send');
    return null;
  }

  const currentAccount = wallet.currentAccount;

  // Format amounts for display
  const amount = formatNock(lastTransaction.amount);
  const amountInNicks = nockToNick(lastTransaction.amount);
  const feeInNocks = formatNock(lastTransaction.fee);
  const feeInNicks = nockToNick(lastTransaction.fee);
  const total = formatNock(lastTransaction.amount + lastTransaction.fee);
  const totalInNicks = nockToNick(lastTransaction.amount + lastTransaction.fee);
  const remainingBalance = formatNock(
    wallet.balance - lastTransaction.amount - lastTransaction.fee
  );
  const fromAddress = truncateAddress(lastTransaction.from);
  const toAddress = truncateAddress(lastTransaction.to);

  const [isSending, setIsSending] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [error, setError] = useState('');
  const [builtTx, setBuiltTx] = useState<{
    txid: string;
    protobufTx: any;
  } | null>(null);

  // Build and sign transaction on screen load
  useEffect(() => {
    async function buildTransaction() {
      if (!lastTransaction || builtTx) return;

      setIsBuilding(true);
      setError('');

      try {
        console.log('[SendReview] Building and signing transaction...');

        const amountInNicks = nockToNick(lastTransaction.amount);
        const feeInNicks = nockToNick(lastTransaction.fee);

        // Build and sign (but don't broadcast) the transaction
        const result = await send<{
          txid?: string;
          protobufTx?: any;
          error?: string;
        }>(INTERNAL_METHODS.BUILD_AND_SIGN_TRANSACTION, [
          lastTransaction.to,
          amountInNicks,
          feeInNicks,
        ]);

        if (result?.error) {
          setError(result.error);
          setIsBuilding(false);
          return;
        }

        if (result?.txid && result?.protobufTx) {
          console.log('[SendReview] Transaction built and signed:', result.txid);
          setBuiltTx({
            txid: result.txid,
            protobufTx: result.protobufTx,
          });
        }

        setIsBuilding(false);
      } catch (err) {
        console.error('[SendReview] Error building transaction:', err);
        setError(err instanceof Error ? err.message : 'Failed to build transaction');
        setIsBuilding(false);
      }
    }

    buildTransaction();
  }, [lastTransaction, builtTx]);

  function handleBack() {
    navigate('send');
  }
  function handleCancel() {
    navigate('send');
  }

  // Dev function: Download signed transaction for debugging
  function handleDownloadTx() {
    if (!builtTx?.protobufTx) {
      console.warn('[SendReview] No transaction built yet');
      return;
    }

    try {
      const txJson = JSON.stringify(builtTx.protobufTx, null, 2);
      const blob = new Blob([txJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tx-${builtTx.txid || 'unsigned'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      console.log('[SendReview] Transaction downloaded');
    } catch (err) {
      console.error('[SendReview] Failed to download transaction:', err);
    }
  }

  async function handleSend() {
    if (!lastTransaction || !builtTx) return;

    setIsSending(true);
    setError('');

    try {
      console.log('[SendReview] Broadcasting transaction...');

      // Broadcast the pre-built transaction
      const result = await send<{
        txid?: string;
        broadcasted?: boolean;
        error?: string;
      }>(INTERNAL_METHODS.BROADCAST_TRANSACTION, [builtTx.protobufTx]);

      if (result?.error) {
        setError(result.error);
        setIsSending(false);
        return;
      }

      if (result?.txid) {
        console.log('[SendReview] Transaction broadcasted! txid:', result.txid);

        // Update lastTransaction with txid and protobuf
        useStore.getState().setLastTransaction({
          ...lastTransaction,
          txid: builtTx.txid,
          protobufTx: builtTx.protobufTx,
        });

        // Add to transaction cache with pending status
        await useStore
          .getState()
          .addSentTransactionToCache(
            builtTx.txid,
            lastTransaction.amount,
            lastTransaction.fee,
            lastTransaction.to || ''
          );

        // Navigate to success screen
        navigate('send-submitted');
      }
    } catch (err) {
      console.error('[SendReview] Error broadcasting transaction:', err);
      setError(err instanceof Error ? err.message : 'Failed to broadcast transaction');
      setIsSending(false);
    }
  }

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
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
          className="w-8 h-8 rounded-lg p-2 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2"
          style={{ backgroundColor: 'transparent' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">Review</h1>
        <div className="w-8 h-8" />
      </header>

      {/* Content */}
      <div
        className="flex flex-col justify-between h-[536px]"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <div className="flex flex-col gap-8 px-4 py-2">
          {/* Amount Section */}
          <div className="flex flex-col items-center gap-3 w-full">
            <div
              className="w-10 h-10 rounded-lg grid place-items-center"
              style={{ backgroundColor: 'var(--color-surface-800)' }}
            >
              <AccountIcon
                styleId={currentAccount?.iconStyleId}
                color={currentAccount?.iconColor}
                className="w-6 h-6"
              />
            </div>
            <div className="flex flex-col items-center gap-0.5 w-full text-center">
              <h2 className="m-0 font-[Lora] text-[36px] font-semibold leading-10 tracking-[-0.72px]">
                {amount} <span style={{ color: 'var(--color-text-muted)' }}>NOCK</span>
              </h2>
              <p
                className="m-0 text-[10px] leading-3 tracking-[0.02em]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {formatNick(amountInNicks)} nicks
              </p>
            </div>
          </div>

          {/* Details */}
          <div className="flex flex-col gap-2 w-full">
            {/* From/To */}
            <div
              className="rounded-lg p-3 flex items-center gap-2.5"
              style={{ backgroundColor: 'var(--color-surface-800)' }}
            >
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <div className="text-sm font-medium leading-[18px] tracking-[0.14px]">From</div>
                <div
                  className="text-[13px] leading-[18px] tracking-[0.26px] truncate"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {fromAddress}
                </div>
              </div>
              <div className="p-1 shrink-0">
                <ChevronRightIcon className="w-4 h-4" />
              </div>
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <div className="text-sm font-medium leading-[18px] tracking-[0.14px]">To</div>
                <div
                  className="text-[13px] leading-[18px] tracking-[0.26px] truncate"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {toAddress}
                </div>
              </div>
            </div>

            {/* Network fee & Total */}
            <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-surface-800)' }}>
              <div className="flex flex-col gap-2.5 w-full">
                {/* Fee row */}
                <div className="flex items-center justify-between w-full">
                  <div className="text-sm font-medium leading-[18px] tracking-[0.14px]">
                    Network fee
                  </div>
                  <div className="flex flex-col items-end">
                    <div className="text-sm font-medium leading-[18px] tracking-[0.14px]">
                      {feeInNocks} NOCK
                    </div>
                    <div
                      className="text-[10px] leading-3 tracking-[0.02em]"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {formatNick(feeInNicks)} nicks
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div
                  className="w-full h-px"
                  style={{ backgroundColor: 'var(--color-surface-700)' }}
                />

                {/* Total row */}
                <div className="flex items-center justify-between w-full">
                  <div className="text-sm font-semibold leading-[18px] tracking-[0.14px]">
                    Total
                  </div>
                  <div className="flex flex-col items-end">
                    <div className="text-sm font-semibold leading-[18px] tracking-[0.14px]">
                      {total} NOCK
                    </div>
                    <div
                      className="text-[10px] leading-3 tracking-[0.02em]"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {formatNick(totalInNicks)} nicks
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Remaining balance */}
            <div
              className="text-center text-[12px] leading-4 font-medium tracking-[0.02em] mt-3"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Balance after: {remainingBalance} NOCK
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="px-4">
              <div
                className="rounded-lg p-3 text-sm"
                style={{ backgroundColor: 'var(--color-surface-800)', color: '#ff6b6b' }}
              >
                {error}
              </div>
            </div>
          )}
        </div>

        {/* DEV: Download signed transaction button */}
        {builtTx?.protobufTx && (
          <div className="px-4 pb-2">
            <button
              type="button"
              onClick={handleDownloadTx}
              className="w-full rounded-lg p-3 flex items-center justify-center transition-opacity hover:opacity-80"
              style={{ backgroundColor: 'var(--color-surface-800)' }}
            >
              <span
                className="text-sm font-medium leading-[18px] tracking-[0.14px]"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Download Signed Transaction (Dev)
              </span>
            </button>
          </div>
        )}

        {/* Actions */}
        <div
          className="flex flex-col gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--color-divider)' }}
        >
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 h-12 inline-flex items-center justify-center rounded-lg text-sm font-medium leading-[18px] tracking-[0.14px] transition-opacity focus:outline-none focus-visible:ring-2"
              style={{
                backgroundColor: 'var(--color-surface-800)',
                color: 'var(--color-text-primary)',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending || isBuilding || !builtTx}
              className="flex-1 h-12 inline-flex items-center justify-center rounded-lg text-sm font-medium leading-[18px] tracking-[0.14px] transition-opacity focus:outline-none focus-visible:ring-2"
              style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              {isBuilding ? 'Building...' : isSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
