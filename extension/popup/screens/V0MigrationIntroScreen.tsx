import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import TransferV0Icon from '../assets/transferv0_icon.svg';

export function V0MigrationIntroScreen() {
  const { navigate, resetV0MigrationDraft } = useStore();

  function handleBack() {
    navigate('settings');
  }

  function handleStart() {
    resetV0MigrationDraft();
    navigate('v0-migration-setup');
  }

  return (
    <div
      className="relative w-[357px] h-[600px] flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      {/* Header - matches other migration screens */}
      <header
        className="flex h-16 items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--color-divider)' }}
      >
        <button
          type="button"
          onClick={handleBack}
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
          Transfer v0 funds
        </h1>
        <div className="w-8" />
      </header>

      {/* Content - Figma: 16px horizontal, 12px gap icon→title, 8px gap title→subtitle */}
      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-10">
        <div className="mx-auto flex max-w-[325px] flex-col items-center gap-3">
          <div className="h-10 w-10 shrink-0">
            <img src={TransferV0Icon} alt="" className="h-full w-full" />
          </div>

          <div className="w-full flex flex-col items-center gap-2 text-center">
            <h2
              className="font-display font-medium text-[var(--color-text-primary)] w-full"
              style={{
                fontSize: '24px',
                lineHeight: '28px',
                letterSpacing: '-0.48px',
              }}
            >
              v0 Funds Migration
            </h2>
            <p
              className="font-sans text-[var(--color-text-muted)] w-full"
              style={{
                fontSize: '13px',
                lineHeight: '18px',
                letterSpacing: '0.26px',
              }}
            >
              Transfer your balance from V0 to V1
            </p>
          </div>

          <div
            className="w-full text-center font-sans text-[var(--color-text-primary)]"
            style={{
              fontSize: '13px',
              lineHeight: '18px',
              letterSpacing: '0.26px',
            }}
          >
            <p className="mt-1">
              <span>The network has upgraded. If your wallet was created before </span>
              <span className="font-bold">October 25, 2025</span>
              <span>
                {' '}
                (block 39,000), your funds need to be migrated to remain accessible on the current
                network.
              </span>
            </p>
            <p className="mt-2">
              This process transfers your full balance from your v0 wallet to v1. It only takes a
              moment.
            </p>
          </div>
        </div>
      </div>

      {/* Footer CTA - matches other migration screens */}
      <div
        className="shrink-0 px-4 py-3"
        style={{ borderTop: '1px solid var(--color-surface-800)' }}
      >
        <button
          type="button"
          onClick={handleStart}
          className="w-full h-12 px-5 py-[15px] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 font-sans font-medium text-[#000000]"
          style={{
            backgroundColor: 'var(--color-primary)',
            fontSize: 'var(--font-size-base)',
            lineHeight: 'var(--line-height-snug)',
            letterSpacing: '0.01em',
          }}
        >
          Start Migration
        </button>
      </div>
    </div>
  );
}
