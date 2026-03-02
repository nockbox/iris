import { useState } from 'react';
import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { AccountIcon } from '../components/AccountIcon';
import { Alert } from '../components/Alert';
import WalletIconYellow from '../assets/wallet-icon-yellow.svg';
import { truncateAddress } from '../utils/format';
import { signAndBroadcastV0MigrationTransaction } from '../../shared/v0-migration';

export function V0MigrationReviewScreen() {
  const { navigate, wallet, v0MigrationDraft, priceUsd, setV0MigrationDraft, fetchBalance } = useStore();
  const destinationWallet =
    wallet.accounts.find(
      account =>
        account.address === v0MigrationDraft.destinationWalletAddress ||
        account.index === v0MigrationDraft.destinationWalletIndex
    ) || null;
  const amount = v0MigrationDraft.migratedAmountNock ?? v0MigrationDraft.v0BalanceNock;
  const usdAmount = amount * priceUsd;
  const canSend = Boolean(v0MigrationDraft.signRawTxPayload);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');

  async function handleSend() {
    if (!v0MigrationDraft.signRawTxPayload || isSending) return;

    setSendError('');
    setIsSending(true);
    try {
      const result = await signAndBroadcastV0MigrationTransaction(v0MigrationDraft.signRawTxPayload);
      setV0MigrationDraft({ txId: result.txId });
      await fetchBalance();
      navigate('v0-migration-submitted');
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Failed to send migration transaction');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      <header className="flex items-center justify-between h-16 px-4">
        <button type="button" onClick={() => navigate('v0-migration-funds')} className="p-2">
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-[16px] font-medium tracking-[0.01em]">Review Transfer</h1>
        <div className="w-7" />
      </header>

      <div className="flex-1 px-4 py-3 flex flex-col gap-3">
        <div className="flex flex-col items-center text-center gap-2">
          <img src={WalletIconYellow} alt="" className="w-10 h-10" />
          <div className="font-display text-[32px] leading-[40px] tracking-[-0.03em]">
            {amount.toLocaleString('en-US')} <span style={{ color: 'var(--color-text-muted)' }}>NOCK</span>
          </div>
          <div className="text-[16px] font-medium">
            ${usdAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="rounded-[14px] p-3" style={{ backgroundColor: 'var(--color-surface-900)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 rounded-[14px] p-3" style={{ backgroundColor: 'var(--color-surface-900)' }}>
              <div className="w-10 h-10 rounded-full grid place-items-center mb-2 text-[16px] font-medium" style={{ backgroundColor: 'var(--color-surface-900)' }}>
                vØ
              </div>
              <div className="text-[16px] font-medium">v0 Wallet</div>
              <div className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                Imported seed
              </div>
            </div>

            <div className="w-10 h-10 rounded-full grid place-items-center text-[22px]" style={{ backgroundColor: 'var(--color-surface-900)' }}>
              ›
            </div>

            <div className="flex-1 rounded-[14px] p-3 text-right" style={{ backgroundColor: 'var(--color-surface-900)' }}>
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
          <span className="text-[14px] font-medium">Network fee</span>
          <span className="text-[14px] font-medium">{v0MigrationDraft.feeNock} NOCK</span>
        </div>
        {sendError && <Alert type="error">{sendError}</Alert>}
      </div>

      <div className="p-3 mt-auto">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate('v0-migration-funds')}
            className="flex-1 h-12 rounded-[14px] text-[16px] font-medium"
            style={{ backgroundColor: 'var(--color-surface-900)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend || isSending}
            className="flex-1 h-12 rounded-[14px] text-[16px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
          >
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

