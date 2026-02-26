import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { SendPaperPlaneIcon } from '../components/icons/SendPaperPlaneIcon';
import { PlusIcon } from '../components/icons/PlusIcon';

export function V0MigrationSubmittedScreen() {
  const { navigate, v0MigrationDraft, resetV0MigrationDraft } = useStore();

  function handleBackToOverview() {
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

      <div className="flex-1 px-4 py-2 flex flex-col">
        <div className="flex flex-col items-center text-center gap-2 mt-3">
          <div className="w-10 h-10" style={{ color: 'var(--color-primary)' }}>
            <SendPaperPlaneIcon className="w-10 h-10" />
          </div>
          <h2 className="font-[Lora] text-[42px] leading-[44px] tracking-[-0.03em] mt-2">
            Your transaction
            <br />
            was submitted
          </h2>
          <p className="text-[20px] leading-[26px]" style={{ color: 'var(--color-text-muted)' }}>
            Check the transaction activity below
          </p>
        </div>

        <div className="mt-6 rounded-[14px] p-3 flex items-start justify-between" style={{ backgroundColor: 'var(--color-surface-900)' }}>
          <div className="text-[16px] font-medium">You sent</div>
          <div className="text-right">
            <div className="text-[16px] font-medium">{v0MigrationDraft.v0BalanceNock.toLocaleString()} NOCK</div>
          </div>
        </div>

        <button
          type="button"
          className="mt-auto mb-3 w-full rounded-[14px] p-3 flex items-center justify-between"
          style={{ backgroundColor: 'var(--color-surface-900)' }}
        >
          <span className="text-[16px] font-medium">Activity log</span>
          <PlusIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={handleBackToOverview}
          className="w-full h-12 rounded-[14px] text-[16px] font-medium"
          style={{ backgroundColor: '#000', color: '#fff' }}
        >
          Back to overview
        </button>
      </div>
    </div>
  );
}

