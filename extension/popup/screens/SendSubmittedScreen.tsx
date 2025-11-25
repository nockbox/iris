import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { SendPaperPlaneIcon } from '../components/icons/SendPaperPlaneIcon';
import { PlusIcon } from '../components/icons/PlusIcon';

export function SendSubmittedScreen() {
  const { navigate, lastTransaction, priceUsd } = useStore();

  function handleBack() {
    navigate('home');
  }
  function handleViewActivity() {
    navigate('home'); // show transactions on home
  }

  // Dev function: Download transaction protobuf for debugging
  function handleDownloadTx() {
    if (!lastTransaction?.protobufTx) {
      console.warn('[SendSubmitted] No transaction data available to download');
      return;
    }

    try {
      // Convert protobuf object to JSON string
      const txJson = JSON.stringify(lastTransaction.protobufTx, null, 2);
      const blob = new Blob([txJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tx-${lastTransaction.txid || 'unsigned'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      console.log('[SendSubmitted] Transaction downloaded');
    } catch (err) {
      console.error('[SendSubmitted] Failed to download transaction:', err);
    }
  }

  // Get real transaction data
  const sentAmount =
    lastTransaction?.amount.toLocaleString('en-US', {
      maximumFractionDigits: 0,
    }) || '0';

  // Calculate USD value based on amount and current price
  const amountInNock = lastTransaction?.amount || 0;
  const usdValue = amountInNock * priceUsd;
  const sentUsdValue =
    usdValue > 0
      ? `$${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '$0.00';

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
                was submitted
              </h2>
              <p
                className="m-0 text-[13px] leading-[18px] tracking-[0.26px]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Check the transaction activity below
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
          </div>
        </div>

        {/* Activity Log Button (commented out - not in use) */}
        {/* <div className="px-4 pb-2">
          <button
            type="button"
            onClick={handleViewActivity}
            className="w-full rounded-lg p-3 flex items-center justify-between transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'var(--color-surface-800)' }}
          >
            <span
              className="text-sm font-medium leading-[18px] tracking-[0.14px]"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Activity log
            </span>
            <PlusIcon className="w-4 h-4" />
          </button>
        </div> */}

        {/* DEV: Download transaction button */}
        {/* {lastTransaction?.protobufTx && (
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
                Download Transaction (Dev)
              </span>
            </button>
          </div>
        )} */}

        {/* Action Buttons */}
        <div className="flex gap-3 px-4 py-3 w-full">
          <button
            type="button"
            onClick={handleViewActivity}
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
