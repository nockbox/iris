import { useStore } from '../../store';
import { ChevronRightIcon } from '../../components/icons/ChevronRightIcon';
import { AccountIcon } from '../../components/AccountIcon';
import { SiteIcon } from '../../components/SiteIcon';
import { truncateAddress } from '../../utils/format';
import { send } from '../../utils/messaging';
import {
  INTERNAL_METHODS,
  NOCK_TO_NICKS,
  DEFAULT_TRANSACTION_FEE,
} from '../../../shared/constants';
import { formatNock, formatNick } from '../../../shared/currency';
import { useAutoRejectOnClose } from '../../hooks/useAutoRejectOnClose';

export function TransactionApprovalScreen() {
  const { navigate, pendingTransactionRequest, setPendingTransactionRequest, wallet } = useStore();

  if (!pendingTransactionRequest) {
    navigate('home');
    return null;
  }

  const { id, origin, to, amount } = pendingTransactionRequest;
  const fee = DEFAULT_TRANSACTION_FEE;
  const total = amount + fee;
  const displayOrigin = origin.includes('://') ? new URL(origin).hostname : origin;

  useAutoRejectOnClose(id, INTERNAL_METHODS.REJECT_TRANSACTION);

  async function handleReject() {
    await send(INTERNAL_METHODS.REJECT_TRANSACTION, [id]);
    setPendingTransactionRequest(null);
    window.close();
  }

  async function handleApprove() {
    await send(INTERNAL_METHODS.APPROVE_TRANSACTION, [id]);
    setPendingTransactionRequest(null);
    window.close();
  }

  const bg = 'var(--color-bg)';
  const surface = 'var(--color-surface-800)';
  const textPrimary = 'var(--color-text-primary)';
  const textMuted = 'var(--color-text-muted)';
  const divider = 'var(--color-divider)';

  return (
    <div className="h-screen flex items-center justify-center" style={{ backgroundColor: bg }}>
      <div
        className="w-full h-full flex flex-col"
        style={{ backgroundColor: bg, maxWidth: '357px', maxHeight: '600px' }}
      >
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
              <div className="font-[Lora] text-[32px] font-semibold leading-none">
                {formatNock(amount / NOCK_TO_NICKS)} <span style={{ color: textMuted }}>NOCK</span>
              </div>
              <div className="text-[10px] mt-1" style={{ color: textMuted }}>
                {formatNick(amount)} nicks
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
                      styleId={wallet.currentAccount?.iconStyleId}
                      color={wallet.currentAccount?.iconColor}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">
                      {truncateAddress(wallet.currentAccount?.address)}
                    </span>
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
                  <span>Network fee</span>
                  <div className="text-right">
                    <div>{formatNock(fee / NOCK_TO_NICKS)} NOCK</div>
                    <div className="text-[10px]" style={{ color: textMuted }}>
                      {formatNick(fee)} nicks
                    </div>
                  </div>
                </div>
                <div className="h-px" style={{ backgroundColor: 'var(--color-surface-700)' }} />
                <div className="flex justify-between text-sm font-semibold">
                  <span>Total</span>
                  <div className="text-right">
                    <div>{formatNock(total / NOCK_TO_NICKS)} NOCK</div>
                    <div className="text-[10px] font-normal" style={{ color: textMuted }}>
                      {formatNick(total)} nicks
                    </div>
                  </div>
                </div>
              </div>

              {/* Balance After */}
              <div className="text-center text-xs py-2" style={{ color: textMuted }}>
                Balance after: {formatNock(wallet.balance - total / NOCK_TO_NICKS)} NOCK
              </div>
            </div>
          </div>
        </div>

        {/* Footer Buttons */}
        <div
          className="px-4 py-2.5 shrink-0 flex gap-3"
          style={{ borderTop: `1px solid ${divider}` }}
        >
          <button onClick={handleReject} className="btn-secondary flex-1">
            Reject
          </button>
          <button onClick={handleApprove} className="btn-primary flex-1">
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
