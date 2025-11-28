import { useStore } from '../../store';
import { AccountIcon } from '../../components/AccountIcon';
import { SiteIcon } from '../../components/SiteIcon';
import { truncateAddress } from '../../utils/format';
import { send } from '../../utils/messaging';
import { INTERNAL_METHODS } from '../../../shared/constants';
import { useAutoRejectOnClose } from '../../hooks/useAutoRejectOnClose';

export function ConnectApprovalScreen() {
  const { navigate, pendingConnectRequest, setPendingConnectRequest, wallet } = useStore();

  if (!pendingConnectRequest) {
    navigate('home');
    return null;
  }

  const { id, origin } = pendingConnectRequest;
  const domain = origin.includes('://') ? new URL(origin).hostname : origin;

  useAutoRejectOnClose(id, INTERNAL_METHODS.REJECT_CONNECTION);

  async function handleReject() {
    await send(INTERNAL_METHODS.REJECT_CONNECTION, [id]);
    setPendingConnectRequest(null);
    window.close();
  }

  async function handleConnect() {
    await send(INTERNAL_METHODS.APPROVE_CONNECTION, [id]);
    setPendingConnectRequest(null);
    window.close();
  }

  const bg = 'var(--color-bg)';
  const surface = 'var(--color-surface-800)';
  const textPrimary = 'var(--color-text-primary)';
  const textMuted = 'var(--color-text-muted)';
  const divider = 'var(--color-divider)';
  const green = 'var(--color-green)';

  return (
    <div className="h-screen flex items-center justify-center" style={{ backgroundColor: bg }}>
      <div
        className="w-full h-full flex flex-col"
        style={{ backgroundColor: bg, maxWidth: '357px', maxHeight: '600px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-center px-4 py-4 shrink-0">
          <h2 className="text-xl font-semibold" style={{ color: textPrimary }}>
            Connect Request
          </h2>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-4 pb-2">
            {/* Site Icon & Info */}
            <div className="text-center mb-4">
              <div className="mb-3">
                <SiteIcon origin={origin} domain={domain} size="lg" />
              </div>
              <h3 className="text-lg font-semibold mb-1" style={{ color: textPrimary }}>
                {domain}
              </h3>
              <p className="text-xs break-all px-4" style={{ color: textMuted }}>
                {origin}
              </p>
            </div>

            {/* Permissions */}
            <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: surface }}>
              <p className="text-sm mb-2 font-medium" style={{ color: textPrimary }}>
                Requesting permission to:
              </p>
              <div className="space-y-1.5">
                <div className="flex items-start gap-2 text-sm" style={{ color: textPrimary }}>
                  <span style={{ color: green }}>✓</span>
                  <span>View your wallet address</span>
                </div>
                <div className="flex items-start gap-2 text-sm" style={{ color: textPrimary }}>
                  <span style={{ color: green }}>✓</span>
                  <span>Request transaction approvals</span>
                </div>
              </div>
            </div>

            {/* Account */}
            <div>
              <label className="text-xs block mb-1.5 font-medium" style={{ color: textMuted }}>
                Connecting Account
              </label>
              <div
                className="rounded-lg p-3 flex items-center gap-2.5"
                style={{ backgroundColor: surface }}
              >
                <AccountIcon
                  styleId={wallet.currentAccount?.iconStyleId}
                  color={wallet.currentAccount?.iconColor}
                  className="w-8 h-8 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: textPrimary }}>
                    {wallet.currentAccount?.name || 'Unknown'}
                  </p>
                  <p className="text-xs font-mono mt-0.5" style={{ color: textMuted }}>
                    {truncateAddress(wallet.currentAccount?.address)}
                  </p>
                </div>
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
            Cancel
          </button>
          <button onClick={handleConnect} className="btn-primary flex-1">
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
