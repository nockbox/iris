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
      className="w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      <header className="flex items-center justify-between h-16 px-4">
        <button type="button" onClick={handleBack} className="p-2" aria-label="Back">
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-[16px] font-medium tracking-[0.01em]">Transfer v0 funds</h1>
        <div className="w-7" />
      </header>

      <div className="flex-1 px-4 py-3 flex flex-col">
        <div className="flex flex-col items-center text-center gap-3">
          <img src={TransferV0Icon} alt="" className="w-10 h-10 mt-1" />
          <h2 className="font-[Lora] text-[52px] leading-[52px] tracking-[-0.03em] mt-3">v0 Funds Migration</h2>
          <p className="text-[20px] leading-[26px]" style={{ color: 'var(--color-text-muted)' }}>
            Transfer your balance from V0 to V1
          </p>
        </div>

        <div className="mt-8 text-center text-[12px] leading-8 font-medium">
          <p>
            The network has upgraded. If your wallet was created before <b>October 25, 2025</b>{' '}
            (block 39,000), your funds need to be migrated to remain accessible on the current
            network.
          </p>
          <p className="mt-8">
            This process transfers your full balance from your v0 wallet to v1. It only takes a
            moment.
          </p>
        </div>
      </div>

      <div className="p-3 mt-auto">
        <button
          type="button"
          onClick={handleStart}
          className="w-full h-12 rounded-[14px] text-[16px] leading-[22px] font-medium tracking-[0.01em]"
          style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
        >
          Start Migration
        </button>
      </div>
    </div>
  );
}

