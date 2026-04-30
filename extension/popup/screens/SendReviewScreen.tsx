import { useState } from 'react';
import { useStore } from '../store';
import { truncateAddress } from '../utils/format';
import { AccountIcon } from '../components/AccountIcon';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS } from '../../shared/constants';
import { formatNock, nockToNick } from '../../shared/currency';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import IrisLogo40 from '../assets/iris-logo-40.svg';
import IrisLogoBlue from '../assets/iris-logo-blue.svg';

export function SendReviewScreen() {
  const { navigate, wallet, lastTransaction, priceUsd } = useStore();

  // If no transaction data, go back to send screen
  if (!lastTransaction) {
    navigate('send');
    return null;
  }

  const currentAccount = wallet.currentAccount;

  // Format amounts for display
  const amount = formatNock(lastTransaction.amount);
  const feeInNocks = formatNock(lastTransaction.fee);
  const fromAddress = truncateAddress(lastTransaction.from);
  const toAddress = truncateAddress(lastTransaction.to);

  // Resolve recipient: internal account name or "Receiving address"
  const recipientAccount = wallet.accounts?.find(
    acc => acc.address.toLowerCase() === (lastTransaction.to || '').toLowerCase()
  );
  const recipientLabel = recipientAccount?.name ?? 'Receiving address';

  const usdValue = lastTransaction.amount * (priceUsd || 0);

  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  function handleBack() {
    navigate('send');
  }
  function handleCancel() {
    navigate('send');
  }

  async function handleSend() {
    if (!lastTransaction) return;

    setIsSending(true);
    setError('');

    try {
      const amountInNicks = nockToNick(lastTransaction.amount);
      const feeInNicks = nockToNick(lastTransaction.fee);

      // Send transaction using V2 (builds, locks notes, broadcasts atomically)
      // If sendMax is true, this is a sweep transaction (all UTXOs to recipient)
      const result = await send<{
        txid?: string;
        broadcasted?: boolean;
        walletTx?: any;
        error?: string;
      }>(INTERNAL_METHODS.SEND_TRANSACTION_V2, [
        lastTransaction.to,
        amountInNicks,
        feeInNicks,
        lastTransaction.sendMax, // Pass sendMax flag for sweep transactions
        priceUsd, // Store USD price at time of transaction for historical display
      ]);

      if (result?.error) {
        setError(result.error);
        setIsSending(false);
        return;
      }

      if (result?.txid) {
        // Update lastTransaction with txid
        useStore.getState().setLastTransaction({
          ...lastTransaction,
          txid: result.txid,
        });

        // Transaction is tracked in WalletTransaction store by sendTransactionV2
        // Refresh balance and transactions from UTXO store
        useStore.getState().fetchBalance();
        useStore.getState().fetchWalletTransactions();

        // Navigate to success screen
        navigate('send-submitted');
      }
    } catch (err) {
      console.error('[SendReview] Error sending transaction:', err);
      setError(err instanceof Error ? err.message : 'Failed to send transaction');
      setIsSending(false);
    }
  }

  return (
    <div
      className="relative w-[357px] h-[600px] flex flex-col"
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
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">
          Review Transfer
        </h1>
        <div className="w-8 h-8" />
      </header>

      {/* Content */}
      <div
        className="flex flex-col justify-between h-[536px]"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <div className="flex flex-col gap-8 px-4 py-2">
          {/* Amount Section - Figma: logo, amount, USD */}
          <div className="flex flex-col items-center gap-3 w-full">
            <img src={IrisLogo40} alt="" className="w-10 h-10 shrink-0" />
            <div className="flex flex-col items-center gap-0.5 w-full text-center">
              <h2 className="m-0 font-display text-[36px] font-semibold leading-10 tracking-[-0.72px]">
                {amount} <span style={{ color: 'var(--color-text-muted)' }}>NOCK</span>
              </h2>
              <p
                className="m-0 text-[13px] leading-[18px] tracking-[0.26px]"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {usdValue > 0
                  ? `$${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '—'}
              </p>
            </div>
          </div>

          {/* Wallet cards with circular middle - Figma layout */}
          <div className="flex flex-col gap-2 w-full">
            <div className="relative flex gap-2 items-stretch w-full">
              {/* Sender card */}
              <div
                className="flex-1 min-w-0 self-stretch p-3 rounded-xl flex flex-col justify-center items-start gap-2.5"
                style={{ backgroundColor: 'var(--color-surface-900)' }}
              >
                <div
                  className="w-10 h-10 relative rounded-[32px] flex items-center justify-center shrink-0 overflow-hidden"
                  style={{ backgroundColor: 'var(--color-bg)' }}
                >
                  <AccountIcon
                    styleId={currentAccount?.iconStyleId}
                    color={currentAccount?.iconColor}
                    className="w-6 h-6"
                  />
                </div>
                <div className="self-stretch flex flex-col justify-center items-start gap-0.5 min-w-0">
                  <div
                    className="text-sm font-medium leading-4 tracking-tight truncate"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {currentAccount?.name ?? 'Wallet'}
                  </div>
                  <div
                    className="text-xs font-normal leading-4 tracking-tight truncate"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {fromAddress}
                  </div>
                </div>
              </div>

              {/* Circular middle element - "weird circle" from Figma */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-14 h-14 rounded-full flex items-center justify-center shrink-0 p-2"
                style={{
                  backgroundColor: 'var(--color-bg)',
                  border: '8px solid var(--color-surface-900)',
                  color: 'var(--color-text-primary)',
                }}
              >
                <ChevronRightIcon className="w-6 h-6 shrink-0" />
              </div>

              {/* Receiver card */}
              <div
                className="flex-1 min-w-0 self-stretch p-3 rounded-xl flex flex-col justify-center items-end gap-2.5"
                style={{ backgroundColor: 'var(--color-surface-900)' }}
              >
                <div
                  className="w-10 h-10 relative rounded-[32px] flex items-center justify-center shrink-0 overflow-hidden"
                  style={{ backgroundColor: 'var(--color-bg)' }}
                >
                  {recipientAccount ? (
                    <AccountIcon
                      styleId={recipientAccount.iconStyleId}
                      color={recipientAccount.iconColor}
                      className="w-6 h-6"
                    />
                  ) : (
                    <img src={IrisLogoBlue} alt="" className="w-6 h-6" />
                  )}
                </div>
                <div className="self-stretch flex flex-col justify-center items-end gap-0.5 min-w-0">
                  <div
                    className="text-sm font-medium leading-4 tracking-tight truncate"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {recipientLabel}
                  </div>
                  <div
                    className="text-xs font-normal leading-4 tracking-tight truncate"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {toAddress}
                  </div>
                </div>
              </div>
            </div>

            {/* Network fee - single row per Figma */}
            <div
              className="rounded-lg px-3 py-5 flex items-center justify-between w-full"
              style={{ backgroundColor: 'var(--color-surface-900)' }}
            >
              <div className="text-sm font-medium leading-[18px] tracking-[0.14px]">
                Network fee
              </div>
              <div className="text-sm font-medium leading-[18px] tracking-[0.14px]">
                {feeInNocks} NOCK
              </div>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="px-4">
              <div
                className="rounded-lg p-3 text-sm"
                style={{ backgroundColor: 'var(--color-surface-800)', color: '#ff6b6b' }}
              >
                {error}
              </div>
            </div>
          )}
        </div>

        {/* DEV: Download signed transaction button */}
        {/* {builtTx?.protobufTx && (
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
                Download Signed Transaction (Dev)
              </span>
            </button>
          </div>
        )} */}

        {/* Actions - Figma: gap-12, rounded-8 */}
        <div
          className="flex gap-3 px-4 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--color-divider)' }}
        >
          <button
            type="button"
            onClick={handleCancel}
            className="flex-1 h-12 inline-flex items-center justify-center rounded-lg text-sm font-medium leading-[18px] tracking-[0.14px] transition-opacity focus:outline-none focus-visible:ring-2"
            style={{
              backgroundColor: 'var(--color-surface-800)',
              color: 'var(--color-text-primary)',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={isSending}
            className="flex-1 h-12 inline-flex items-center justify-center rounded-lg text-sm font-medium leading-[18px] tracking-[0.14px] transition-opacity focus:outline-none focus-visible:ring-2"
            style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
      {isSending && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center p-5"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
        >
          <div
            className="w-full rounded-[20px] border p-5 flex flex-col items-center gap-3 text-center"
            style={{
              backgroundColor: 'var(--color-bg)',
              borderColor: 'var(--color-surface-700)',
              color: 'var(--color-text-primary)',
            }}
          >
            <div
              className="w-8 h-8 border-2 rounded-full animate-spin"
              style={{
                borderColor: 'var(--color-text-muted)',
                borderTopColor: 'var(--color-primary)',
              }}
            />
            <div className="text-[16px] font-medium">Signing and submitting transaction</div>
            <div
              className="text-[13px] leading-[18px]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Signing and submitting your transaction. This could take a while.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
