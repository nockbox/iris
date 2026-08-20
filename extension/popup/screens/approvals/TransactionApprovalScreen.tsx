import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { ChevronRightIcon } from '../../components/icons/ChevronRightIcon';
import { AccountIcon } from '../../components/AccountIcon';
import { SiteIcon } from '../../components/SiteIcon';
import { truncateAddress } from '../../utils/format';
import { send } from '../../utils/messaging';
import { INTERNAL_METHODS, NOCK_TO_NICKS } from '../../../shared/constants';
import {
  formatNicks,
  formatNicksAsNock,
  formatNock,
  nicksToBigInt,
} from '../../../shared/currency';
import { useAutoRejectOnClose } from '../../hooks/useAutoRejectOnClose';
import { closeAfterApproval } from '../../utils/displayContext';

export function TransactionApprovalScreen() {
  const { navigate, pendingTransactionRequest, setPendingTransactionRequest, wallet } = useStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [approvalError, setApprovalError] = useState('');

  useAutoRejectOnClose(pendingTransactionRequest?.id ?? null, INTERNAL_METHODS.REJECT_TRANSACTION);

  useEffect(() => {
    if (!pendingTransactionRequest) {
      navigate('home');
    }
  }, [navigate, pendingTransactionRequest]);

  if (!pendingTransactionRequest) {
    return null;
  }

  const { id, origin, to, amount, accountAddress } = pendingTransactionRequest;
  const fee = pendingTransactionRequest.fee;
  const isFeeEstimated = Boolean(pendingTransactionRequest.feeEstimated);
  const totalNicks = nicksToBigInt(amount) + nicksToBigInt(fee);
  const totalNicksString = totalNicks.toString();
  const displayOrigin = origin.includes('://') ? new URL(origin).hostname : origin;
  const signingAccount = wallet.accounts.find(account => account.address === accountAddress);
  const signingAccountBalance = wallet.accountSpendableBalances[accountAddress] ?? 0;

  async function handleReject() {
    await send(INTERNAL_METHODS.REJECT_TRANSACTION, [id]);
    setPendingTransactionRequest(null);
    closeAfterApproval(navigate);
  }

  async function handleApprove() {
    setIsSubmitting(true);
    setApprovalError('');
    try {
      const result = await send<{ success?: boolean; error?: string }>(
        INTERNAL_METHODS.APPROVE_TRANSACTION,
        [id]
      );
      if (result?.error || !result?.success) {
        setApprovalError(result?.error || 'Transaction could not be approved');
        return;
      }
      setPendingTransactionRequest(null);
      closeAfterApproval(navigate);
    } catch (error) {
      setApprovalError(
        error instanceof Error ? error.message : 'Transaction could not be approved'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const bg = 'var(--color-bg)';
  const surface = 'var(--color-surface-800)';
  const textPrimary = 'var(--color-text-primary)';
  const textMuted = 'var(--color-text-muted)';
  const divider = 'var(--color-divider)';

  return (
    <div className="h-screen flex items-center justify-center" style={{ backgroundColor: bg }}>
      <div className="w-full h-full flex flex-col" style={{ backgroundColor: bg }}>
        {/* Header */}
        <div className="flex items-center justify-center px-4 py-4 shrink-0">
          <h2 className="text-xl font-semibold" style={{ color: textPrimary }}>
            Approve Transaction
          </h2>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-4 pb-2">
            {/* Site Badge */}
            <div
              className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg mb-3"
              style={{ backgroundColor: surface }}
            >
              <span className="text-xs" style={{ color: textMuted }}>
                From
              </span>
              <SiteIcon origin={origin} domain={displayOrigin} size="sm" />
              <span
                className="text-sm font-semibold truncate max-w-[160px]"
                style={{ color: textPrimary }}
              >
                {displayOrigin}
              </span>
            </div>

            {/* Amount */}
            <div className="text-center mb-4">
              <div className="font-display text-[32px] font-semibold leading-none">
                {formatNicksAsNock(amount)} <span style={{ color: textMuted }}>NOCK</span>
              </div>
              <div className="text-[10px] mt-1" style={{ color: textMuted }}>
                {formatNicks(amount)} nicks
              </div>
            </div>

            <div className="space-y-2">
              {/* From/To */}
              <div
                className="rounded-lg p-3 flex items-center gap-2"
                style={{ backgroundColor: surface }}
              >
                <div className="flex-1">
                  <div className="text-xs mb-1" style={{ color: textMuted }}>
                    From
                  </div>
                  <div className="flex items-center gap-1.5">
                    <AccountIcon
                      styleId={signingAccount?.iconStyleId}
                      color={signingAccount?.iconColor}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">{truncateAddress(accountAddress)}</span>
                  </div>
                </div>
                <ChevronRightIcon className="w-4 h-4 shrink-0" />
                <div className="flex-1">
                  <div className="text-xs mb-1" style={{ color: textMuted }}>
                    To
                  </div>
                  <span className="text-sm">{truncateAddress(to)}</span>
                </div>
              </div>

              {/* Fee & Total */}
              <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: surface }}>
                <div className="flex justify-between text-sm">
                  <span>Network fee{isFeeEstimated ? ' (estimated)' : ''}</span>
                  <div className="text-right">
                    <div>
                      {isFeeEstimated ? '~' : ''}
                      {formatNicksAsNock(fee)} NOCK
                    </div>
                    <div className="text-[10px]" style={{ color: textMuted }}>
                      {isFeeEstimated ? '~' : ''}
                      {formatNicks(fee)} nicks
                    </div>
                  </div>
                </div>
                <div className="h-px" style={{ backgroundColor: 'var(--color-surface-700)' }} />
                <div className="flex justify-between text-sm font-semibold">
                  <span>Total{isFeeEstimated ? ' (estimated)' : ''}</span>
                  <div className="text-right">
                    <div>
                      {isFeeEstimated ? '~' : ''}
                      {formatNicksAsNock(totalNicksString)} NOCK
                    </div>
                    <div className="text-[10px] font-normal" style={{ color: textMuted }}>
                      {isFeeEstimated ? '~' : ''}
                      {formatNicks(totalNicksString)} nicks
                    </div>
                  </div>
                </div>
              </div>

              {isFeeEstimated && (
                <div className="text-center text-xs px-2" style={{ color: textMuted }}>
                  The final network fee is calculated when the transaction is built and may differ
                  from this estimate.
                </div>
              )}

              {/* Balance After */}
              <div className="text-center text-xs py-2" style={{ color: textMuted }}>
                {isFeeEstimated ? 'Estimated balance after' : 'Balance after'}:{' '}
                {formatNock(signingAccountBalance - Number(totalNicks) / NOCK_TO_NICKS)} NOCK
              </div>

              {approvalError && (
                <div
                  className="rounded-lg p-3 text-xs"
                  style={{
                    backgroundColor: 'var(--color-red-light)',
                    color: 'var(--color-red)',
                  }}
                  role="alert"
                >
                  {approvalError}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Buttons */}
        <div
          className="px-4 py-2.5 shrink-0 flex gap-3"
          style={{ borderTop: `1px solid ${divider}` }}
        >
          <button
            type="button"
            onClick={handleReject}
            disabled={isSubmitting}
            className="btn-secondary flex-1"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={handleApprove}
            disabled={isSubmitting}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {isSubmitting ? 'Verifying...' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}
