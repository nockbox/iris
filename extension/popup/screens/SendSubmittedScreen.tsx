import { useEffect } from 'react';
import { useStore } from '../store';
import { truncateAddress } from '../utils/format';
import { formatNock } from '../../shared/currency';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import { PlusIcon } from '../components/icons/PlusIcon';
import { CheckIcon } from '../components/icons/CheckIcon';
import { AccountIcon } from '../components/AccountIcon';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import IrisLogo40 from '../assets/iris-logo-40.svg';
import IrisLogoBlue from '../assets/iris-logo-blue.svg';

export function SendSubmittedScreen() {
  const {
    navigate,
    wallet,
    lastTransaction,
    priceUsd,
    walletTransactions,
    fetchBalance,
    fetchWalletTransactions,
  } = useStore();
  const { copied, copyToClipboard } = useCopyToClipboard();

  // Poll for status updates: fetchBalance triggers SYNC_UTXOS (updates vault with
  // confirmation status), then fetchWalletTransactions reads the updated data
  useEffect(() => {
    const refresh = async () => {
      await fetchBalance();
      await fetchWalletTransactions();
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [fetchBalance, fetchWalletTransactions]);

  if (!lastTransaction) {
    navigate('home');
    return null;
  }

  const tx = lastTransaction;

  // Find matching wallet transaction to get live status
  const walletTx = walletTransactions.find(
    wt => wt.txHash && tx.txid && wt.txHash.toLowerCase() === tx.txid.toLowerCase()
  );
  const status = walletTx?.status;
  const statusDisplay =
    status === 'confirmed'
      ? 'Confirmed'
      : status === 'failed' || status === 'expired'
        ? status === 'failed'
          ? 'Failed'
          : 'Expired'
        : 'Pending';
  const statusColor =
    status === 'confirmed'
      ? 'var(--color-green)'
      : status === 'failed' || status === 'expired'
        ? 'var(--color-red)'
        : '#C88414';
  const currentAccount = wallet.currentAccount;
  const amount = formatNock(tx.amount);
  const feeInNocks = formatNock(tx.fee);
  const total = formatNock(tx.amount + tx.fee);
  const fromAddress = truncateAddress(tx.from);
  const toAddress = truncateAddress(tx.to);

  const recipientAccount = wallet.accounts?.find(
    acc => acc.address.toLowerCase() === (tx.to || '').toLowerCase()
  );
  const recipientLabel = recipientAccount?.name ?? 'Unknown wallet';

  const amountUsd = tx.amount * (priceUsd || 0);
  const totalUsd = (tx.amount + tx.fee) * (priceUsd || 0);

  function handleBack() {
    navigate('home');
  }

  function handleViewExplorer() {
    if (tx.txid) {
      window.open(`https://nockscan.net/tx/${tx.txid}`, '_blank');
    }
  }

  function handleCopyTxId() {
    if (tx.txid) {
      copyToClipboard(tx.txid);
    }
  }

  function handleActivityLog() {
    navigate('home');
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
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">Sent</h1>
        <div className="w-8 h-8" />
      </header>

      {/* Content */}
      <div
        className="flex flex-col justify-between h-[536px] overflow-y-auto"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <div className="flex flex-col gap-8 px-4 py-2">
          {/* Amount Section - Figma: logo, -amount, USD */}
          <div className="flex flex-col items-center gap-3 w-full">
            <img src={IrisLogo40} alt="" className="w-10 h-10 shrink-0" />
            <div className="flex flex-col items-center gap-0.5 w-full text-center">
              <h2 className="m-0 font-display text-[36px] font-semibold leading-10 tracking-[-0.72px]">
                -{amount} <span style={{ color: 'var(--color-text-muted)' }}>NOCK</span>
              </h2>
              <p
                className="m-0 text-[13px] leading-[18px] tracking-[0.26px]"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {amountUsd > 0
                  ? `$${amountUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '—'}
              </p>
            </div>
          </div>

          {/* Status card */}
          <div
            className="rounded-lg px-3 py-5 flex items-center justify-between w-full"
            style={{ backgroundColor: 'var(--color-surface-900)' }}
          >
            <div className="text-sm font-medium leading-[18px] tracking-[0.14px]">Status</div>
            <div
              className="text-sm font-medium leading-[18px] tracking-[0.14px]"
              style={{ color: statusColor }}
            >
              {statusDisplay}
            </div>
          </div>

          {/* Wallet cards with circular middle - same as Review screen */}
          <div className="flex flex-col gap-2 w-full">
            <div className="relative flex gap-2 items-stretch w-full">
              {/* Sender card */}
              <div
                className="flex-1 min-w-0 flex flex-col gap-2.5 p-3 rounded-xl"
                style={{ backgroundColor: 'var(--color-surface-900)' }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'var(--color-bg)' }}
                >
                  <AccountIcon
                    styleId={currentAccount?.iconStyleId}
                    color={currentAccount?.iconColor}
                    className="w-6 h-6"
                  />
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="text-sm font-medium leading-[18px] tracking-[0.14px] truncate">
                    {currentAccount?.name ?? 'Wallet'}
                  </div>
                  <div
                    className="text-[13px] leading-[18px] tracking-[0.26px] truncate"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {fromAddress}
                  </div>
                </div>
              </div>

              {/* Circular middle element */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 p-2"
                style={{
                  backgroundColor: 'var(--color-bg)',
                  border: '8px solid var(--color-surface-900)',
                  color: 'var(--color-text-primary)',
                }}
              >
                <ChevronRightIcon className="w-4 h-4 shrink-0" />
              </div>

              {/* Receiver card */}
              <div
                className="flex-1 min-w-0 flex flex-col gap-2.5 p-3 rounded-xl items-end"
                style={{ backgroundColor: 'var(--color-surface-900)' }}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden">
                  {recipientAccount ? (
                    <div
                      className="w-full h-full rounded-full flex items-center justify-center"
                      style={{ backgroundColor: 'var(--color-bg)' }}
                    >
                      <AccountIcon
                        styleId={recipientAccount.iconStyleId}
                        color={recipientAccount.iconColor}
                        className="w-6 h-6"
                      />
                    </div>
                  ) : (
                    <img src={IrisLogoBlue} alt="" className="w-10 h-10" />
                  )}
                </div>
                <div className="flex flex-col gap-0.5 items-end min-w-0">
                  <div className="text-sm font-medium leading-[18px] tracking-[0.14px] truncate">
                    {recipientLabel}
                  </div>
                  <div
                    className="text-[13px] leading-[18px] tracking-[0.26px] truncate"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {toAddress}
                  </div>
                </div>
              </div>
            </div>

            {/* Network fee & Total card */}
            <div
              className="rounded-lg py-3 flex flex-col gap-3 w-full"
              style={{ backgroundColor: 'var(--color-surface-900)' }}
            >
              <div className="flex items-center justify-between px-3">
                <div
                  className="text-sm font-medium leading-[18px] tracking-[0.14px]"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Network fee
                </div>
                <div
                  className="text-sm font-medium leading-[18px] tracking-[0.14px]"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {feeInNocks} NOCK
                </div>
              </div>
              <div
                className="w-full h-px"
                style={{ backgroundColor: 'var(--color-surface-700)' }}
              />
              <div className="flex items-center justify-between px-3">
                <div className="text-sm font-medium leading-[18px] tracking-[0.14px]">Total</div>
                <div className="flex flex-col items-end gap-1">
                  <div className="text-sm font-medium leading-[18px] tracking-[0.14px]">
                    {total} NOCK
                  </div>
                  <div
                    className="text-[13px] leading-[18px] tracking-[0.26px]"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {totalUsd > 0
                      ? `$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Action buttons - View on explorer, Copy transaction ID */}
            <div className="flex gap-2 w-full">
              <button
                type="button"
                onClick={handleViewExplorer}
                disabled={!tx.txid}
                className="flex-1 py-[7px] px-3 rounded-[32px] text-sm font-medium leading-[18px] tracking-[0.14px] transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-50"
                style={{
                  border: '1px solid var(--color-surface-700)',
                  color: 'var(--color-text-primary)',
                }}
                onMouseEnter={e => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.backgroundColor = 'var(--color-surface-800)';
                  }
                }}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                View on explorer
              </button>
              <button
                type="button"
                onClick={handleCopyTxId}
                disabled={!tx.txid}
                className="flex-1 py-[7px] px-3 rounded-[32px] text-sm font-medium leading-[18px] tracking-[0.14px] transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-50 flex items-center justify-center gap-1.5"
                style={{
                  border: '1px solid var(--color-surface-700)',
                  color: 'var(--color-text-primary)',
                }}
                onMouseEnter={e => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.backgroundColor = 'var(--color-surface-800)';
                  }
                }}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {copied && <CheckIcon className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy transaction ID'}
              </button>
            </div>
          </div>

          {/* Activity log button */}
          <button
            type="button"
            onClick={handleActivityLog}
            className="w-full rounded-lg p-3 flex items-center justify-between transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-surface-800)' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            <span className="text-sm font-medium leading-[18px] tracking-[0.14px]">
              Activity log
            </span>
            <PlusIcon className="w-4 h-4 shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
}
