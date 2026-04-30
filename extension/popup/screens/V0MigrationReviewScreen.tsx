import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getV0MigrationMnemonic, useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { AccountIcon } from '../components/AccountIcon';
import WalletIconYellow from '../assets/wallet-icon-yellow.svg';
import { truncateAddress } from '../utils/format';
import {
  logV0MigrationUnsignedTxPayload,
  signAndBroadcastV0Migration,
} from '../../shared/v0-migration';
import { formatNock } from '../../shared/currency';
import { Alert } from '../components/Alert';

export function V0MigrationReviewScreen() {
  const {
    navigate,
    wallet,
    v0MigrationDraft,
    setLastTransaction,
    resetV0MigrationDraft,
    fetchBalance,
    fetchWalletTransactions,
    priceUsd,
  } = useStore();
  const [sendError, setSendError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const destinationWallet =
    wallet.accounts.find(account => account.address === v0MigrationDraft.destinationAddress) ||
    null;
  const amount = v0MigrationDraft.migratedAmountNock ?? v0MigrationDraft.v0BalanceNock ?? 0;
  const usdAmount = amount * priceUsd;

  const amountDisplay = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Shrink the hero amount to fit when the value is wide.
  const amountContainerRef = useRef<HTMLDivElement | null>(null);
  const amountTextRef = useRef<HTMLSpanElement | null>(null);
  const [amountFontSize, setAmountFontSize] = useState(32);

  useLayoutEffect(() => {
    const container = amountContainerRef.current;
    const text = amountTextRef.current;
    if (!container || !text) return;

    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const maxWidth = container.clientWidth;
        if (!maxWidth) return;
        let size = 32;
        text.style.fontSize = `${size}px`;
        while (text.scrollWidth > maxWidth && size > 20) {
          size -= 1;
          text.style.fontSize = `${size}px`;
        }
        setAmountFontSize(size);
      });
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [amountDisplay]);

  useEffect(() => {
    const payload = v0MigrationDraft.v0MigrationTxSignPayload;
    if (!payload) return;
    logV0MigrationUnsignedTxPayload(payload);
  }, [v0MigrationDraft.v0MigrationTxSignPayload]);

  const v0Mnemonic = getV0MigrationMnemonic();
  const canSend =
    Boolean(v0MigrationDraft.v0MigrationTxSignPayload) && Boolean(v0Mnemonic) && !isSending;

  async function handleSend() {
    if (!canSend || !v0Mnemonic || !v0MigrationDraft.v0MigrationTxSignPayload) return;

    setSendError('');
    setIsSending(true);
    try {
      const { txId } = await signAndBroadcastV0Migration(
        v0Mnemonic,
        v0MigrationDraft.v0MigrationTxSignPayload
      );
      const sentAmount = v0MigrationDraft.migratedAmountNock ?? v0MigrationDraft.v0BalanceNock ?? 0;
      const feeNock = v0MigrationDraft.feeNock ?? 0;
      setLastTransaction({
        txid: txId,
        amount: sentAmount,
        fee: feeNock,
        from: v0MigrationDraft.sourceAddress,
        to: destinationWallet?.address,
      });
      resetV0MigrationDraft();
      void fetchBalance();
      void fetchWalletTransactions();
      navigate('send-submitted');
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : err && typeof err === 'object' && 'message' in err
              ? String((err as { message: unknown }).message)
              : err != null
                ? String(err)
                : 'Failed to sign and broadcast';
      setSendError(msg);
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
          <div
            ref={amountContainerRef}
            className="font-display tracking-[-0.03em]"
            style={{ width: '100%', textAlign: 'center' }}
          >
            <span
              ref={amountTextRef}
              style={{
                display: 'inline-block',
                whiteSpace: 'nowrap',
                fontSize: `${amountFontSize}px`,
                lineHeight: '40px',
              }}
            >
              {amountDisplay} <span style={{ color: 'var(--color-text-muted)' }}>NOCK</span>
            </span>
          </div>
          <div className="text-[16px] font-medium">
            $
            {usdAmount.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        </div>

        <div className="rounded-[14px] p-3" style={{ backgroundColor: 'var(--color-surface-900)' }}>
          <div className="flex items-center justify-between gap-3">
            <div
              className="flex-1 rounded-[14px] p-3"
              style={{ backgroundColor: 'var(--color-surface-900)' }}
            >
              <div
                className="w-10 h-10 rounded-full grid place-items-center mb-2 text-[16px] font-medium"
                style={{ backgroundColor: 'var(--color-surface-900)' }}
              >
                vØ
              </div>
              <div className="text-[16px] font-medium">v0 Wallet</div>
              <div
                className="text-[12px] truncate"
                style={{ color: 'var(--color-text-muted)' }}
                title={v0MigrationDraft.sourceAddress}
              >
                {v0MigrationDraft.sourceAddress
                  ? truncateAddress(v0MigrationDraft.sourceAddress)
                  : 'Imported seed'}
              </div>
            </div>

            <div
              className="w-10 h-10 rounded-full grid place-items-center text-[22px]"
              style={{ backgroundColor: 'var(--color-surface-900)' }}
            >
              ›
            </div>

            <div
              className="flex-1 rounded-[14px] p-3 text-right"
              style={{ backgroundColor: 'var(--color-surface-900)' }}
            >
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

        <div
          className="rounded-[14px] p-3 flex items-center justify-between"
          style={{ backgroundColor: 'var(--color-surface-900)' }}
        >
          <span className="text-[14px] font-medium">Network fee</span>
          <span className="text-[14px] font-medium">
            {v0MigrationDraft.feeNock != null ? `${formatNock(v0MigrationDraft.feeNock)} NOCK` : ''}
          </span>
        </div>

        {sendError && <Alert type="error">{sendError}</Alert>}
      </div>

      <div className="p-3 mt-auto">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate('v0-migration-funds')}
            disabled={isSending}
            className="flex-1 h-12 rounded-[14px] text-[16px] font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-surface-900)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!canSend}
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
