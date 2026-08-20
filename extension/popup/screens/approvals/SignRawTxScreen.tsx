import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { INTERNAL_METHODS, APPROVAL_CONSTANTS } from '../../../shared/constants';
import { send } from '../../utils/messaging';
import { SignRawTxRequest } from '../../../shared/types';
import { useAutoRejectOnClose } from '../../hooks/useAutoRejectOnClose';
import { closeAfterApproval } from '../../utils/displayContext';
import { AccountIcon } from '../../components/AccountIcon';
import { SiteIcon } from '../../components/SiteIcon';
import { truncateAddress } from '../../utils/format';
import { formatNicksAsNock } from '../../../shared/currency';

interface NoteItemProps {
  note: any;
  type: 'to' | 'from';
  textPrimary: string;
  textMuted: string;
  surface: string;
}

function NoteItem({ note, type, textPrimary, textMuted, surface }: NoteItemProps) {
  const [copied, setCopied] = useState(false);

  // Extract data from the complex JSON structure
  // Structure: [{"note_version":{"V1":{...}}}] or similar
  // We need to handle potential variations if the structure isn't exactly as expected, but assuming the provided JSON is representative.

  // The note object passed here is likely one item from the array, e.g. {"note_version":{"V1":{...}}}

  let versionData: any = null;

  if (note.note_version?.V1) {
    versionData = note.note_version.V1;
  }

  if (!versionData) {
    return (
      <div className="rounded-lg p-3 mb-2" style={{ backgroundColor: surface }}>
        <p className="text-sm text-red-500">Unknown note format</p>
        <pre className="text-xs break-all">{JSON.stringify(note)}</pre>
      </div>
    );
  }

  const assetsValue = versionData.assets?.value || '0';
  const formattedNocks = formatNicksAsNock(String(assetsValue));

  const firstName = versionData.name?.first || '';
  const lastName = versionData.name?.last || '';
  const fullName = `[ ${firstName} ${lastName} ]`;

  // Truncate name: first 4 chars of first name ... last 4 chars of last name
  const truncatedName = `[ ${firstName.slice(0, 4)}...${lastName.slice(-4)} ]`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullName);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy note name:', error);
    }
  };

  return (
    <div className="rounded-lg p-3 mb-2" style={{ backgroundColor: surface }}>
      <div className="flex flex-row items-center gap-1 text-sm font-medium">
        <span style={{ color: textPrimary }}>{formattedNocks} NOCK</span>
        <span style={{ color: textMuted }}>{type}</span>
        <button
          type="button"
          className="font-mono cursor-pointer hover:opacity-80 transition-opacity relative group"
          style={{ color: textMuted }}
          onClick={() => void handleCopy()}
          title={fullName}
          aria-label={`Copy note name ${fullName}`}
        >
          {truncatedName}
          {copied && (
            <span className="absolute right-0 top-0 z-50 whitespace-nowrap bg-green-500 text-white text-[10px] px-1 rounded transform -translate-y-full">
              Copied!
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

export function SignRawTxScreen() {
  const { pendingSignRawTxRequest, setPendingSignRawTxRequest, navigate, wallet } = useStore();
  const [isSigning, setIsSigning] = useState(false);
  const [signError, setSignError] = useState('');

  useAutoRejectOnClose(pendingSignRawTxRequest?.id ?? null, INTERNAL_METHODS.REJECT_SIGN_RAW_TX);

  useEffect(() => {
    if (!pendingSignRawTxRequest) {
      navigate('home');
    }
  }, [navigate, pendingSignRawTxRequest]);

  if (!pendingSignRawTxRequest) {
    return null;
  }

  const {
    id,
    origin,
    inputs,
    inputsVerified,
    inputCount,
    outputs,
    signingIntentId,
    totalFee,
    accountAddress,
  } = pendingSignRawTxRequest;
  const signingAccount = wallet.accounts.find(account => account.address === accountAddress);

  async function handleDecline() {
    await send(INTERNAL_METHODS.REJECT_SIGN_RAW_TX, [id]);
    setPendingSignRawTxRequest(null);
    closeAfterApproval(navigate);
  }

  async function handleSign() {
    setIsSigning(true);
    setSignError('');
    try {
      const result = await send<{ success?: boolean; error?: string }>(
        INTERNAL_METHODS.APPROVE_SIGN_RAW_TX,
        [id]
      );
      if (result?.error || !result?.success) {
        setSignError(result?.error || 'Transaction could not be signed');
        return;
      }
      setPendingSignRawTxRequest(null);
      closeAfterApproval(navigate);
    } catch (error) {
      setSignError(error instanceof Error ? error.message : 'Transaction could not be signed');
    } finally {
      setIsSigning(false);
    }
  }

  const formattedFee = formatNicksAsNock(totalFee);

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
            Review Transaction
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

            <div
              className="mb-3 rounded-lg p-3 text-xs leading-5"
              style={{
                backgroundColor: inputsVerified
                  ? 'var(--color-green-light, rgba(34, 197, 94, 0.12))'
                  : 'var(--color-yellow-light, rgba(250, 204, 21, 0.12))',
                color: textPrimary,
              }}
            >
              {inputsVerified
                ? 'Iris derived this review from the exact transaction and matched every input to an available note in the selected account.'
                : `Iris could not match all ${inputCount} inputs to the local wallet cache. The transaction intent, outputs, and fee below come from the exact transaction, but the input values are not verified. Only continue if you trust the requesting site.`}
            </div>

            <div className="mb-3">
              <label className="text-xs block mb-1.5 font-medium" style={{ color: textMuted }}>
                Transaction intent ID
              </label>
              <div className="rounded-lg p-3" style={{ backgroundColor: surface }}>
                <p
                  className="text-xs font-mono break-all"
                  style={{ color: textPrimary }}
                  title={signingIntentId}
                >
                  {signingIntentId}
                </p>
              </div>
            </div>

            {/* Verified transaction inputs */}
            {inputsVerified && (
              <div className="mb-3">
                <label className="text-xs block mb-1.5 font-medium" style={{ color: textMuted }}>
                  Verified Inputs ({inputs.length})
                </label>
                <div className="max-h-48 overflow-y-auto">
                  {inputs.map((note: any, index: number) => (
                    <NoteItem
                      key={`input-${index}`}
                      note={note}
                      type="from"
                      textPrimary={textPrimary}
                      textMuted={textMuted}
                      surface={surface}
                    />
                  ))}
                </div>
              </div>
            )}

            {signError && (
              <div
                className="mb-3 rounded-lg p-3 text-xs"
                style={{
                  backgroundColor: 'var(--color-red-light)',
                  color: 'var(--color-red)',
                }}
                role="alert"
              >
                {signError}
              </div>
            )}

            {/* Raw Transaction Outputs */}
            {outputs && outputs.length > 0 && (
              <div className="mb-3">
                <label className="text-xs block mb-1.5 font-medium" style={{ color: textMuted }}>
                  Outputs ({outputs.length})
                </label>
                <div className="max-h-48 overflow-y-auto">
                  {outputs.map((output: any, index: number) => (
                    <NoteItem
                      key={`output-${index}`}
                      note={output}
                      type="to"
                      textPrimary={textPrimary}
                      textMuted={textMuted}
                      surface={surface}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Network Fee */}
            <div className="mb-3">
              <label className="text-xs block mb-1.5 font-medium" style={{ color: textMuted }}>
                Network Fee
              </label>
              <div className="rounded-lg p-3" style={{ backgroundColor: surface }}>
                <p className="text-sm font-semibold" style={{ color: textPrimary }}>
                  {formattedFee} NOCK
                </p>
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
            {isSigning ? 'Verifying...' : inputsVerified ? 'Sign' : 'Sign anyway'}
          </button>
        </div>
      </div>
    </div>
  );
}
