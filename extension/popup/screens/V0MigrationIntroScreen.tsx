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
    <div className="w-[357px] h-[600px] relative bg-greyscale-inverted-additional overflow-hidden flex flex-col">
      <header className="w-[357px] h-16 px-4 py-3 shrink-0 bg-greyscale-inverted-additional inline-flex justify-between items-center">
        <button type="button" onClick={handleBack} className="p-2 flex justify-start items-center" aria-label="Back">
          <ChevronLeftIcon className="w-4 h-4 text-greyscale-inverted-accent" />
        </button>
        <h1 className="text-greyscale-inverted-accent text-base font-medium font-sans leading-5 tracking-tight">
          Transfer v0 funds
        </h1>
        <div className="w-8 h-8" />
      </header>

      <div className="w-[325px] mx-auto flex-1 flex flex-col justify-start items-center pt-6 pb-10 overflow-auto">
        <img src={TransferV0Icon} alt="" className="w-12 h-12 shrink-0" />

        <div className="self-stretch flex flex-col justify-start items-center gap-2 mt-6">
          <div className="self-stretch text-center text-greyscale-inverted-accent text-[30px] font-medium font-display leading-[1.1] tracking-[-0.03em]">
            v0 Funds Migration
          </div>
          <div className="self-stretch text-center text-greyscale-grey-500 text-[18px] font-normal font-sans leading-[26px]">
            Transfer your balance from V0 to V1
          </div>
        </div>

        <div className="self-stretch mt-8 text-center text-greyscale-inverted-accent text-xs font-medium font-sans leading-5 tracking-tight">
          <span>The network has upgraded. If your wallet was created before </span>
          <span className="font-bold">October 25, 2025</span>
          <span> (block 39,000), your funds need to be migrated to remain accessible on the current network.</span>
        </div>
        <div className="self-stretch mt-8 text-center text-greyscale-inverted-accent text-xs font-medium font-sans leading-5 tracking-tight">
          This process transfers your full balance from your v0 wallet to v1. It only takes a moment.
        </div>
      </div>

      <div className="w-[357px] px-4 py-3 shrink-0">
        <button
          type="button"
          onClick={handleStart}
          className="w-full h-12 px-5 py-[15px] bg-[var(--color-primary)] text-[#000000] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 font-sans font-medium"
          style={{ fontSize: 'var(--font-size-base)' }}
        >
          Start Migration
        </button>
      </div>
    </div>
  );
}

