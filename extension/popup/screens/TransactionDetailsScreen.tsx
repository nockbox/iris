import React, { useState } from 'react';
import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import { CheckIcon } from '../components/icons/CheckIcon';
import { AccountIcon } from '../components/AccountIcon';
import IrisLogo40 from '../assets/iris-logo-40.svg';
import IrisLogoBlue from '../assets/iris-logo-blue.svg';
import { truncateAddress } from '../utils/format';
import { NOCK_TO_NICKS } from '../../shared/constants';
import { resolveCounterpartyAccount } from '../../shared/account-lock-roots';
import { isMigrationWalletTx } from '../../shared/v0-migration';
import { isBridgeWalletTx } from '../../shared/bridge-config';
import { useLockRootAccountMap } from '../hooks/useLockRootAccountMap';
import TransferV0Icon from '../assets/transferv0_icon.svg';
import BaseIconAsset from '../assets/base_icon.svg';

export function TransactionDetailsScreen() {
  const {
    navigate,
    selectedTransaction,
    wallet,
    priceUsd,
    fetchWalletTransactions,
    walletTransactions,
    setSelectedTransaction,
    blockExplorerUrl,
  } = useStore();

  const lockRootToAccount = useLockRootAccountMap(wallet.accounts);
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
  const isMigration = isMigrationWalletTx(selectedTransaction);
  const isBridge = isBridgeWalletTx(selectedTransaction);
  const transactionType =
    selectedTransaction.direction === 'outgoing'
      ? 'sent'
      : selectedTransaction.direction === 'self'
        ? 'internal'
        : 'received';

  // Convert amount from nicks to NOCK
  const amountNock = (selectedTransaction.amount || 0) / NOCK_TO_NICKS;
  const feeNock = (selectedTransaction.fee || 0) / NOCK_TO_NICKS;

  const amount = amountNock.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const historicalPrice = selectedTransaction.priceUsdAtTime ?? priceUsd;
  const usdValue =
    historicalPrice && historicalPrice > 0
      ? `$${(amountNock * historicalPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
    case 'mempool_seen':
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

  const currentAccount = wallet.currentAccount;
  const currentAddress = currentAccount?.address || '';
  const counterpartyAddress =
    selectedTransaction.direction === 'outgoing'
      ? selectedTransaction.recipient
      : selectedTransaction.sender;

  const accountsList = wallet.accounts ?? [];
  const counterpartyAccount = resolveCounterpartyAccount(
    counterpartyAddress,
    accountsList,
    lockRootToAccount
  );

  // Resolve sender and receiver for wallet cards (like review screen)
  const senderAccount =
    selectedTransaction.direction === 'outgoing' || selectedTransaction.direction === 'self'
      ? currentAccount
      : counterpartyAccount;
  const receiverAccount =
    selectedTransaction.direction === 'outgoing'
      ? counterpartyAccount
      : selectedTransaction.direction === 'self'
        ? currentAccount
        : currentAccount;

  const senderLabel =
    selectedTransaction.direction === 'self'
      ? (currentAccount?.name ?? 'Current wallet')
      : isMigration && selectedTransaction.direction === 'incoming'
        ? 'Legacy (v0)'
        : (senderAccount?.name ??
          (selectedTransaction.origin === 'history_sync' &&
          selectedTransaction.direction === 'incoming'
            ? 'Sending lockroot'
            : 'Unknown wallet'));
  const receiverLabel =
    selectedTransaction.direction === 'self'
      ? (receiverAccount?.name ?? 'Current wallet')
      : isMigration && selectedTransaction.direction === 'incoming'
        ? (currentAccount?.name ?? 'This wallet')
        : isBridge && selectedTransaction.direction === 'outgoing'
          ? 'Base'
          : (receiverAccount?.name ??
            (selectedTransaction.origin === 'history_sync' &&
            selectedTransaction.direction === 'outgoing'
              ? 'Receiving lock root'
              : 'Receiving address'));

  const senderAddress =
    selectedTransaction.direction === 'outgoing' || selectedTransaction.direction === 'self'
      ? truncateAddress(currentAddress)
      : counterpartyAccount?.address
        ? truncateAddress(counterpartyAccount.address)
        : counterpartyAddress
          ? truncateAddress(counterpartyAddress)
          : 'Unknown';
  const receiverAddress =
    selectedTransaction.direction === 'outgoing'
      ? receiverAccount?.address
        ? truncateAddress(receiverAccount.address)
        : counterpartyAddress
          ? truncateAddress(counterpartyAddress)
          : 'Unknown'
      : selectedTransaction.direction === 'self'
        ? truncateAddress(currentAddress)
        : truncateAddress(currentAddress);

  const paysNetworkFee =
    selectedTransaction.direction === 'outgoing' || selectedTransaction.direction === 'self';

  // For incoming transactions, we don't have fee info
  const networkFee = paysNetworkFee
    ? `${feeNock.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} NOCK`
    : '-';
  const totalNock = paysNetworkFee ? amountNock + feeNock : amountNock;
  const total = `${totalNock.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} NOCK`;

  const totalUsd =
    historicalPrice && historicalPrice > 0
      ? `$${(totalNock * historicalPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null;
  const transactionId =
    selectedTransaction.txHash || selectedTransaction.trackingTxId || selectedTransaction.id;
  function handleBack() {
    navigate('home');
  }
  function handleViewExplorer() {
    const txHash = selectedTransaction?.txHash;
    if (txHash) {
      const base = blockExplorerUrl.replace(/\/$/, '');
      window.open(`${base}/tx/${txHash}`, '_blank');
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
          {isBridge
            ? 'Bridge'
            : isMigration
              ? 'Migration'
              : transactionType === 'sent'
                ? 'Sent'
                : transactionType === 'internal'
                  ? 'Internal'
                  : 'Received'}
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
            {isBridge ? (
              <img src={BaseIconAsset} alt="" className="w-10 h-10" />
            ) : isMigration ? (
              <img src={TransferV0Icon} alt="" className="w-10 h-10" />
            ) : (
              <img src={IrisLogo40} alt="Iris" className="w-10 h-10" />
            )}
            <div className="flex flex-col items-center gap-0.5 text-center">
              <h2
                className="m-0 font-display text-[36px] font-semibold leading-10 tracking-[-0.72px]"
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
              style={{ backgroundColor: 'var(--color-surface-900)' }}
            >
              <div className="flex items-center justify-between text-sm font-medium leading-[18px] tracking-[0.14px]">
                <div style={{ color: 'var(--color-text-primary)' }}>Status</div>
                <div style={{ color: statusColor }}>
                  <span className="whitespace-nowrap">{statusText}</span>
                </div>
              </div>
            </div>

            {(selectedTransaction.confirmedAtBlock || selectedTransaction.confirmedAtTimestamp) && (
              <div
                className="rounded-lg px-3 py-3"
                style={{ backgroundColor: 'var(--color-surface-900)' }}
              >
                {selectedTransaction.confirmedAtBlock && (
                  <div className="flex items-center justify-between text-sm font-medium leading-[18px] tracking-[0.14px]">
                    <div style={{ color: 'var(--color-text-primary)' }}>Block</div>
                    <div style={{ color: 'var(--color-text-muted)' }}>
                      {selectedTransaction.confirmedAtBlock.toLocaleString('en-US')}
                    </div>
                  </div>
                )}
                {selectedTransaction.confirmedAtTimestamp && (
                  <div
                    className={`flex items-center justify-between text-sm font-medium leading-[16px] tracking-[0.14px] ${
                      selectedTransaction.confirmedAtBlock ? 'mt-1.5' : ''
                    }`}
                  >
                    <div style={{ color: 'var(--color-text-primary)' }}>Confirmed at</div>
                    <div style={{ color: 'var(--color-text-muted)' }}>
                      {new Date(selectedTransaction.confirmedAtTimestamp * 1000).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Wallet cards with circular middle - same as Review screen */}
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
                    {senderAccount ? (
                      <AccountIcon
                        styleId={senderAccount.iconStyleId}
                        color={senderAccount.iconColor}
                        className="w-6 h-6"
                      />
                    ) : isMigration ? (
                      <img src={TransferV0Icon} alt="" className="w-6 h-6" />
                    ) : (
                      <img src={IrisLogoBlue} alt="" className="w-6 h-6" />
                    )}
                  </div>
                  <div className="self-stretch flex flex-col justify-center items-start gap-0.5 min-w-0">
                    <div
                      className="text-sm font-medium leading-4 tracking-tight truncate"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {senderLabel}
                    </div>
                    <div
                      className="text-xs font-normal leading-4 tracking-tight truncate"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {senderAddress}
                    </div>
                  </div>
                </div>

                {/* Circular middle element */}
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
                    {receiverAccount ? (
                      <AccountIcon
                        styleId={receiverAccount.iconStyleId}
                        color={receiverAccount.iconColor}
                        className="w-6 h-6"
                      />
                    ) : isBridge && selectedTransaction.direction === 'outgoing' ? (
                      <img src={BaseIconAsset} alt="" className="w-6 h-6" />
                    ) : (
                      <img src={IrisLogoBlue} alt="" className="w-6 h-6" />
                    )}
                  </div>
                  <div className="self-stretch flex flex-col justify-center items-end gap-0.5 min-w-0">
                    <div
                      className="text-sm font-medium leading-4 tracking-tight truncate"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {receiverLabel}
                    </div>
                    <div
                      className="text-xs font-normal leading-4 tracking-tight truncate"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {receiverAddress}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Fee and Total - Figma 1357-4155 */}
            <div
              className="self-stretch py-3 rounded-lg flex flex-col justify-center items-start gap-3"
              style={{ backgroundColor: 'var(--color-surface-900)' }}
            >
              {paysNetworkFee && (
                <>
                  <div className="self-stretch px-3 flex justify-between items-center">
                    <div
                      className="flex-1 text-sm font-medium leading-4 tracking-tight"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      Network fee
                    </div>
                    <div
                      className="text-sm font-medium leading-4 tracking-tight"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {networkFee}
                    </div>
                  </div>
                  <div
                    className="self-stretch h-0 outline outline-1 outline-offset-[-0.5px]"
                    style={{ outlineColor: 'var(--color-divider)' }}
                  />
                </>
              )}
              <div className="self-stretch px-3 flex justify-between items-start">
                <div
                  className="flex-1 text-sm font-medium leading-4 tracking-tight"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  Total
                </div>
                <div className="flex flex-col items-end gap-1 text-right shrink-0">
                  <div
                    className="text-sm font-medium leading-4 tracking-tight"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {total}
                  </div>
                  {totalUsd && (
                    <div
                      className="text-xs font-normal leading-4 tracking-tight"
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
                    e.currentTarget.style.backgroundColor = 'var(--color-surface-900)';
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
                    e.currentTarget.style.backgroundColor = 'var(--color-surface-900)';
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
