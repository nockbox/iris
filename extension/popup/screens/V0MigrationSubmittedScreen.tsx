import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { SendPaperPlaneIcon } from '../components/icons/SendPaperPlaneIcon';
import { PlusIcon } from '../components/icons/PlusIcon';
import { clearV0MigrationSigningMnemonic } from '../../shared/v0-migration';
import { truncateAddress } from '../utils/format';

export function V0MigrationSubmittedScreen() {
  const { navigate, v0MigrationDraft, resetV0MigrationDraft } = useStore();
  const sentAmount = v0MigrationDraft.migratedAmountNock ?? v0MigrationDraft.v0BalanceNock;
  const txId = v0MigrationDraft.txId;

  function handleBackToOverview() {
    clearV0MigrationSigningMnemonic();
    resetV0MigrationDraft();
    navigate('home');
  }

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      <header className="flex items-center justify-between h-16 px-4">
        <button type="button" onClick={handleBackToOverview} className="p-2" aria-label="Back">
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-[16px] font-medium tracking-[0.01em]">Submitted</h1>
        <div className="w-7" />
      </header>

      <div className="flex-1 px-6 py-2 flex flex-col">
        <div className="flex flex-col items-center text-center gap-2 mt-3">
          <div className="w-10 h-10" style={{ color: 'var(--color-primary)' }}>
            <SendPaperPlaneIcon className="w-10 h-10" />
          </div>
          <h2 className="font-display text-[28px] leading-[34px] tracking-[-0.03em] mt-2">
            Your transaction
            <br />
            was submitted
          </h2>
          <p className="text-[14px] leading-[20px]" style={{ color: 'var(--color-text-muted)' }}>
            Check the transaction activity below
          </p>
        </div>

        <div className="mt-6 rounded-[14px] p-3 flex items-start justify-between" style={{ backgroundColor: 'var(--color-surface-900)' }}>
          <div className="text-[14px] font-medium">You sent</div>
          <div className="text-right">
            <div className="text-[14px] font-medium">{sentAmount.toLocaleString()} NOCK</div>
          </div>
        </div>

        {txId && (
          <div
            className="mt-2 rounded-[14px] p-3 flex items-center justify-between gap-3"
            style={{ backgroundColor: 'var(--color-surface-900)' }}
          >
            <div className="min-w-0">
              <div className="text-[14px] font-medium">Transaction ID</div>
              <div
                className="text-[12px] leading-[18px] truncate"
                style={{ color: 'var(--color-text-muted)' }}
                title={txId}
              >
                {truncateAddress(txId)}
              </div>
            </div>
            <button
              type="button"
              className="text-[12px] font-medium underline"
              style={{ color: 'var(--color-text-primary)' }}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(txId);
                } catch (error) {
                  console.warn('[V0 Migration] Failed to copy tx id:', error);
                }
              }}
            >
              Copy
            </button>
          </div>
        )}

        <button
          type="button"
          className="mt-auto mb-3 w-full rounded-[14px] p-3 flex items-center justify-between"
          style={{ backgroundColor: 'var(--color-surface-900)' }}
        >
          <span className="text-[14px] font-medium">Activity log</span>
          <PlusIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 px-6">
        <button
          type="button"
          onClick={handleBackToOverview}
          className="w-full h-12 rounded-[14px] text-[14px] font-medium"
          style={{ backgroundColor: '#000', color: '#fff' }}
        >
          Back to overview
        </button>
      </div>
    </div>
  );
}

