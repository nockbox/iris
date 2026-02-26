import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { AccountIcon } from '../components/AccountIcon';
import WalletIconYellow from '../assets/wallet-icon-yellow.svg';
import { truncateAddress } from '../utils/format';

export function V0MigrationReviewScreen() {
  const { navigate, wallet, v0MigrationDraft, priceUsd } = useStore();
  const destinationWallet =
    wallet.accounts.find(account => account.index === v0MigrationDraft.destinationWalletIndex) || null;
  const amount = v0MigrationDraft.v0BalanceNock;
  const usdAmount = amount * priceUsd;

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      <header className="flex items-center justify-between h-16 px-4">
        <button type="button" onClick={() => navigate('v0-migration-setup')} className="p-2">
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-[16px] font-medium tracking-[0.01em]">Review Transfer</h1>
        <div className="w-7" />
      </header>

      <div className="flex-1 px-4 py-3 flex flex-col gap-3">
        <div className="flex flex-col items-center text-center gap-2">
          <img src={WalletIconYellow} alt="" className="w-10 h-10" />
          <div className="text-[56px] leading-[56px] font-[Lora] tracking-[-0.03em]">
            {amount.toLocaleString('en-US')} <span style={{ color: 'var(--color-text-muted)' }}>NOCK</span>
          </div>
          <div className="text-[16px] font-medium">
            ${usdAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="rounded-[14px] p-3" style={{ backgroundColor: 'var(--color-surface-900)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 rounded-[14px] p-3" style={{ backgroundColor: 'var(--color-bg)' }}>
              <div className="w-10 h-10 rounded-full grid place-items-center bg-[var(--color-surface-900)] mb-2 text-[16px] font-medium">
                vØ
              </div>
              <div className="text-[16px] font-medium">v0 Wallet</div>
              <div className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                Imported seed
              </div>
            </div>

            <div className="w-10 h-10 rounded-full grid place-items-center bg-[var(--color-bg)] text-[22px]">
              ›
            </div>

            <div className="flex-1 rounded-[14px] p-3 text-right" style={{ backgroundColor: 'var(--color-bg)' }}>
              <div className="flex justify-end mb-2">
                <AccountIcon
                  styleId={destinationWallet?.iconStyleId}
                  color={destinationWallet?.iconColor}
                  className="w-10 h-10"
                />
              </div>
              <div className="text-[16px] font-medium">{destinationWallet?.name || 'Wallet'}</div>
              <div className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                {truncateAddress(destinationWallet?.address)}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[14px] p-3 flex items-center justify-between" style={{ backgroundColor: 'var(--color-surface-900)' }}>
          <span className="text-[16px] font-medium">Network fee</span>
          <span className="text-[16px] font-medium">{v0MigrationDraft.feeNock} NOCK</span>
        </div>
      </div>

      <div className="p-3 mt-auto">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate('v0-migration-setup')}
            className="flex-1 h-12 rounded-[14px] text-[16px] font-medium"
            style={{ backgroundColor: 'var(--color-surface-900)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => navigate('v0-migration-submitted')}
            className="flex-1 h-12 rounded-[14px] text-[16px] font-medium"
            style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

