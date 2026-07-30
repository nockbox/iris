import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { AccountIcon } from '../../components/AccountIcon';
import { SiteIcon } from '../../components/SiteIcon';
import { truncateAddress } from '../../utils/format';
import { send } from '../../utils/messaging';
import { INTERNAL_METHODS } from '../../../shared/constants';
import { useAutoRejectOnClose } from '../../hooks/useAutoRejectOnClose';
import { closeAfterApproval } from '../../utils/displayContext';

export function ConnectApprovalScreen() {
  const { navigate, pendingConnectRequest, setPendingConnectRequest, wallet } = useStore();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');

  useAutoRejectOnClose(pendingConnectRequest?.id ?? null, INTERNAL_METHODS.REJECT_CONNECTION);

  useEffect(() => {
    if (!pendingConnectRequest) {
      navigate('home');
    }
  }, [navigate, pendingConnectRequest]);

  if (!pendingConnectRequest) {
    return null;
  }

  const { id, origin, accountAddress } = pendingConnectRequest;
  const domain = origin.includes('://') ? new URL(origin).hostname : origin;
  const connectingAccount = accountAddress
    ? wallet.accounts.find(account => account.address === accountAddress)
    : wallet.currentAccount;
  const connectingAddress = accountAddress ?? connectingAccount?.address;

  async function handleConnect() {
    setIsConnecting(true);
    setConnectionError('');
    try {
      const result = await send<{ success?: boolean; error?: string }>(
        INTERNAL_METHODS.APPROVE_CONNECTION,
        [id]
      );
      if (result?.error || !result?.success) {
        setConnectionError(result?.error || 'Connection could not be approved');
        return;
      }
      setPendingConnectRequest(null);
      closeAfterApproval(navigate);
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Connection could not be approved'
      );
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleReject() {
    await send(INTERNAL_METHODS.REJECT_CONNECTION, [id]);
    setPendingConnectRequest(null);
    closeAfterApproval(navigate);
  }

  const bg = 'var(--color-bg)';
  const surface = 'var(--color-surface-800)';
  const textPrimary = 'var(--color-text-primary)';
  const textMuted = 'var(--color-text-muted)';
  const divider = 'var(--color-divider)';
  const green = 'var(--color-green)';

  return (
    <div className="h-screen flex items-center justify-center" style={{ backgroundColor: bg }}>
      <div className="w-full h-full flex flex-col" style={{ backgroundColor: bg }}>
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
                  styleId={connectingAccount?.iconStyleId}
                  color={connectingAccount?.iconColor}
                  className="w-8 h-8 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: textPrimary }}>
                    {connectingAccount?.name || 'Unknown'}
                  </p>
                  <p className="text-xs font-mono mt-0.5" style={{ color: textMuted }}>
                    {truncateAddress(connectingAddress)}
                  </p>
                </div>
              </div>
            </div>

            {connectionError && (
              <div
                className="mt-3 rounded-lg p-3 text-xs"
                style={{
                  backgroundColor: 'var(--color-red-light)',
                  color: 'var(--color-red)',
                }}
                role="alert"
              >
                {connectionError}
              </div>
            )}
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
            disabled={isConnecting}
            className="btn-secondary flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConnect}
            disabled={isConnecting}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {isConnecting ? 'Verifying...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
