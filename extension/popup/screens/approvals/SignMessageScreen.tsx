import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { AccountIcon } from '../../components/AccountIcon';
import { SiteIcon } from '../../components/SiteIcon';
import { truncateAddress } from '../../utils/format';
import { send } from '../../utils/messaging';
import { INTERNAL_METHODS } from '../../../shared/constants';
import { useAutoRejectOnClose } from '../../hooks/useAutoRejectOnClose';
import { closeAfterApproval } from '../../utils/displayContext';

export function SignMessageScreen() {
  const { navigate, pendingSignRequest, setPendingSignRequest, wallet } = useStore();
  const [isSigning, setIsSigning] = useState(false);
  const [signError, setSignError] = useState('');

  useAutoRejectOnClose(pendingSignRequest?.id ?? null, INTERNAL_METHODS.REJECT_SIGN_MESSAGE);

  useEffect(() => {
    if (!pendingSignRequest) {
      navigate('home');
    }
  }, [navigate, pendingSignRequest]);

  if (!pendingSignRequest) {
    return null;
  }

  const { id, origin, message, accountAddress } = pendingSignRequest;
  const signingAccount = wallet.accounts.find(account => account.address === accountAddress);

  async function handleDecline() {
    await send(INTERNAL_METHODS.REJECT_SIGN_MESSAGE, [id]);
    setPendingSignRequest(null);
    closeAfterApproval(navigate);
  }

  async function handleSign() {
    setIsSigning(true);
    setSignError('');
    try {
      const result = await send<{ success?: boolean; error?: string }>(
        INTERNAL_METHODS.APPROVE_SIGN_MESSAGE,
        [id]
      );
      if (result?.error || !result?.success) {
        setSignError(result?.error || 'Message could not be signed');
        return;
      }
      setPendingSignRequest(null);
      closeAfterApproval(navigate);
    } catch (error) {
      setSignError(error instanceof Error ? error.message : 'Message could not be signed');
    } finally {
      setIsSigning(false);
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
            Sign Message
          </h2>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-4 pb-2">
            {/* Site Info */}
            <div className="mb-3">
              <label className="text-xs block mb-1.5 font-medium" style={{ color: textMuted }}>
                Requesting Site
              </label>
              <div
                className="rounded-lg p-3 flex items-center gap-3"
                style={{ backgroundColor: surface }}
              >
                <SiteIcon
                  origin={origin}
                  domain={origin.includes('://') ? new URL(origin).hostname : origin}
                  size="md"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-0.5" style={{ color: textPrimary }}>
                    {origin.includes('://') ? new URL(origin).hostname : origin}
                  </p>
                  <p className="text-xs break-all" style={{ color: textMuted }}>
                    {origin}
                  </p>
                </div>
              </div>
            </div>

            {/* Message Content */}
            <div className="mb-3">
              <label className="text-xs block mb-1.5 font-medium" style={{ color: textMuted }}>
                Message
              </label>
              <div
                className="rounded-lg p-3 max-h-48 overflow-y-auto"
                style={{ backgroundColor: surface }}
              >
                <pre
                  className="text-sm whitespace-pre-wrap break-words font-mono"
                  style={{ color: textPrimary }}
                >
                  {message}
                </pre>
              </div>
            </div>

            {/* Account */}
            <div>
              <label className="text-xs block mb-1.5 font-medium" style={{ color: textMuted }}>
                Signing Account
              </label>
              <div
                className="rounded-lg p-3 flex items-center gap-2.5"
                style={{ backgroundColor: surface }}
              >
                <AccountIcon
                  styleId={signingAccount?.iconStyleId}
                  color={signingAccount?.iconColor}
                  className="w-8 h-8 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: textPrimary }}>
                    {signingAccount?.name || 'Unknown'}
                  </p>
                  <p className="text-xs font-mono mt-0.5" style={{ color: textMuted }}>
                    {truncateAddress(accountAddress)}
                  </p>
                </div>
              </div>
            </div>

            {signError && (
              <div
                className="mt-3 rounded-lg p-3 text-xs"
                style={{
                  backgroundColor: 'var(--color-red-light)',
                  color: 'var(--color-red)',
                }}
                role="alert"
              >
                {signError}
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
            onClick={handleDecline}
            disabled={isSigning}
            className="btn-secondary flex-1"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={handleSign}
            disabled={isSigning}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {isSigning ? 'Verifying...' : 'Sign'}
          </button>
        </div>
      </div>
    </div>
  );
}
