import React, { useState } from 'react';
import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import { CheckIcon } from '../components/icons/CheckIcon';
import IrisLogo40 from '../assets/iris-logo-40.svg';
import { truncateAddress, formatUTCTimestamp } from '../utils/format';
import { NOCK_TO_NICKS } from '../../shared/constants';

export function TransactionDetailsScreen() {
  const {
    navigate,
    selectedTransaction,
    wallet,
    fetchWalletTransactions,
    walletTransactions,
    setSelectedTransaction,
  } = useStore();

  const [copiedTxId, setCopiedTxId] = useState(false);

  // Fetch fresh transaction data on mount
  React.useEffect(() => {
    fetchWalletTransactions();
  }, []);

  // Sync selectedTransaction with updates from walletTransactions
  React.useEffect(() => {
    if (!selectedTransaction) return;

    // Find the updated transaction by id
    const updatedTx = walletTransactions.find(tx => tx.id === selectedTransaction.id);
    if (updatedTx) {
      // Update selectedTransaction with the latest data
      setSelectedTransaction(updatedTx);
    }
  }, [walletTransactions, selectedTransaction?.id]);

  // If no transaction selected, show error state
  if (!selectedTransaction) {
    return (
      <div
        className="w-[357px] h-[600px] flex items-center justify-center"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <div className="text-center" style={{ color: 'var(--color-text-muted)' }}>
          <p>No transaction selected</p>
          <button
            onClick={() => navigate('home')}
            className="mt-4 px-4 py-2 rounded-lg"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  // Extract data from selected transaction
  const transactionType = selectedTransaction.direction === 'outgoing' ? 'sent' : 'received';

  // Convert amount from nicks to NOCK
  const amountNock = (selectedTransaction.amount || 0) / NOCK_TO_NICKS;
  const feeNock = (selectedTransaction.fee || 0) / NOCK_TO_NICKS;

  const amount = amountNock.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Only show USD value if we have historical price stored
  const usdValue = selectedTransaction.priceUsdAtTime
    ? `$${(amountNock * selectedTransaction.priceUsdAtTime).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;

  // Determine status display
  let statusText: string;
  let statusColor: string;

  switch (selectedTransaction.status) {
    case 'confirmed':
      statusText = 'Confirmed';
      statusColor = 'var(--color-green)';
      break;
    case 'failed':
      statusText = 'Failed';
      statusColor = 'var(--color-red)';
      break;
    case 'expired':
      statusText = 'Expired';
      statusColor = 'var(--color-red)';
      break;
    case 'broadcasted_unconfirmed':
    case 'broadcast_pending':
    case 'created':
      statusText = 'Pending';
      statusColor = '#C88414';
      break;
    default:
      statusText = 'Unknown';
      statusColor = 'var(--color-text-muted)';
  }

  const currentAddress = wallet.currentAccount?.address || '';
  const counterpartyAddress =
    selectedTransaction.direction === 'outgoing'
      ? selectedTransaction.recipient
      : selectedTransaction.sender;

  const fromAddress =
    selectedTransaction.direction === 'outgoing'
      ? truncateAddress(currentAddress)
      : counterpartyAddress
        ? truncateAddress(counterpartyAddress)
        : 'Unknown';
  const toAddress =
    selectedTransaction.direction === 'outgoing'
      ? truncateAddress(counterpartyAddress || '')
      : truncateAddress(currentAddress);

  // For incoming transactions, we don't have fee info
  const networkFee =
    selectedTransaction.direction === 'outgoing'
      ? `${feeNock.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} NOCK`
      : '-';
  const totalNock =
    selectedTransaction.direction === 'outgoing' ? amountNock + feeNock : amountNock;
  const total = `${totalNock.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} NOCK`;

  // Only show total USD if we have historical price stored
  const totalUsd = selectedTransaction.priceUsdAtTime
    ? `$${(totalNock * selectedTransaction.priceUsdAtTime).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;
  const transactionId = selectedTransaction.txHash || selectedTransaction.id;
  const transactionTimeUTC = formatUTCTimestamp(selectedTransaction.createdAt);

  function handleBack() {
    navigate('home');
  }
  function handleViewExplorer() {
    // Open transaction on nockscan.net (only if we have a txHash)
    const txHash = selectedTransaction?.txHash;
    if (txHash) {
      window.open(`https://nockscan.net/tx/${txHash}`, '_blank');
    }
  }
  async function handleCopyTransactionId() {
    try {
      await navigator.clipboard.writeText(transactionId);
      setCopiedTxId(true);
      setTimeout(() => setCopiedTxId(false), 2000);
    } catch (err) {
      console.error('Failed to copy transaction ID:', err);
    }
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
          className="w-8 h-8 flex items-center justify-center p-2 rounded-lg transition-opacity focus:outline-none focus-visible:ring-2"
          style={{ color: 'var(--color-text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          aria-label="Back"
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">
          {transactionType === 'sent' ? 'Sent' : 'Received'}
        </h1>
        <div className="w-8 h-8" />
      </header>

      {/* Content */}
      <div
        className="flex flex-col gap-2 h-[536px] overflow-y-auto"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <div className="flex flex-col gap-8 px-4 py-2">
          {/* Amount Section */}
          <div className="flex flex-col items-center gap-3">
            <img src={IrisLogo40} alt="Iris" className="w-10 h-10" />
            <div className="flex flex-col items-center gap-0.5 text-center">
              <h2
                className="m-0 font-[Lora] text-[36px] font-semibold leading-10 tracking-[-0.72px]"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {transactionType === 'sent' && '-'}
                {amount} <span style={{ color: 'var(--color-text-muted)' }}>NOCK</span>
              </h2>
              {usdValue && (
                <p
                  className="m-0 text-[13px] font-medium leading-[18px] tracking-[0.26px]"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {usdValue}
                </p>
              )}
            </div>
          </div>

          {/* Transaction Details */}
          <div className="flex flex-col gap-2">
            {/* Status */}
            <div
              className="rounded-lg px-3 py-5"
              style={{ backgroundColor: 'var(--color-surface-800)' }}
            >
              <div className="flex items-center justify-between text-sm font-medium leading-[18px] tracking-[0.14px]">
                <div style={{ color: 'var(--color-text-primary)' }}>Status</div>
                <div style={{ color: statusColor }}>
                  <span className="whitespace-nowrap">{statusText}</span>
                </div>
              </div>
            </div>

            {/* Transaction Time */}
            <div
              className="rounded-lg px-3 py-5"
              style={{ backgroundColor: 'var(--color-surface-800)' }}
            >
              <div className="flex items-center justify-between text-sm font-medium leading-[18px] tracking-[0.14px]">
                <div style={{ color: 'var(--color-text-primary)' }}>Time</div>
                <div
                  className="text-right text-[13px] leading-[18px] tracking-[0.26px]"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {transactionTimeUTC}
                </div>
              </div>
            </div>

            {/* From / To */}
            <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-surface-800)' }}>
              <div className="flex items-center gap-2.5">
                <div className="flex-1 flex flex-col gap-1 min-w-0">
                  <div className="text-sm font-medium leading-[18px] tracking-[0.14px]">From</div>
                  <div
                    className="text-[13px] leading-[18px] tracking-[0.26px] truncate"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {fromAddress}
                  </div>
                </div>
                <div className="p-1 shrink-0">
                  <ChevronRightIcon className="w-4 h-4" />
                </div>
                <div className="flex-1 flex flex-col gap-1 min-w-0">
                  <div className="text-sm font-medium leading-[18px] tracking-[0.14px]">To</div>
                  <div
                    className="text-[13px] leading-[18px] tracking-[0.26px] truncate"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {toAddress}
                  </div>
                </div>
              </div>
            </div>

            {/* Fee and Total */}
            <div
              className="rounded-lg px-3 py-3 flex flex-col gap-3"
              style={{ backgroundColor: 'var(--color-surface-800)' }}
            >
              <div className="flex items-center justify-between text-sm font-medium leading-[18px] tracking-[0.14px]">
                <div style={{ color: 'var(--color-text-primary)', opacity: 0.7 }}>Network fee</div>
                <div className="whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>
                  {networkFee}
                </div>
              </div>
              <div className="h-px w-full" style={{ backgroundColor: 'var(--color-divider)' }} />
              <div className="flex items-center justify-between text-sm font-medium leading-[18px] tracking-[0.14px]">
                <div style={{ color: 'var(--color-text-primary)' }}>Total</div>
                <div className="flex flex-col items-end gap-1 w-[75px]">
                  <div className="whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                    {total}
                  </div>
                  {totalUsd && (
                    <div
                      className="text-[13px] leading-[18px] tracking-[0.26px] whitespace-nowrap"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {totalUsd}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleViewExplorer}
                disabled={!selectedTransaction.txHash}
                className="flex-1 py-[7px] px-3 bg-transparent rounded-full text-sm font-medium leading-[18px] tracking-[0.14px] transition-colors focus:outline-none focus-visible:ring-2 whitespace-nowrap disabled:opacity-50"
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
                onClick={handleCopyTransactionId}
                disabled={copiedTxId}
                className="flex-1 py-[7px] px-3 bg-transparent rounded-full text-sm font-medium leading-[18px] tracking-[0.14px] transition-colors focus:outline-none focus-visible:ring-2 whitespace-nowrap disabled:opacity-100 flex items-center justify-center gap-1.5"
                style={{
                  border: '1px solid var(--color-surface-700)',
                  color: 'var(--color-text-primary)',
                }}
                onMouseEnter={e => {
                  if (!copiedTxId) {
                    e.currentTarget.style.backgroundColor = 'var(--color-surface-800)';
                  }
                }}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {copiedTxId && <CheckIcon className="w-3.5 h-3.5" />}
                {copiedTxId ? 'Copied!' : 'Copy transaction ID'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
