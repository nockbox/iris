import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { INTERNAL_METHODS, APPROVAL_CONSTANTS } from '../../../shared/constants';
import { send } from '../../utils/messaging';
import { SignRawTxRequest } from '../../../shared/types';
import { useAutoRejectOnClose } from '../../hooks/useAutoRejectOnClose';
import { AccountIcon } from '../../components/AccountIcon';
import { SiteIcon } from '../../components/SiteIcon';
import { truncateAddress } from '../../utils/format';
import { nickToNock, formatNock } from '../../../shared/currency';
import { extractMemo } from '../../utils/memo';

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
  const nicks = parseInt(assetsValue, 10);
  const nocks = nickToNock(nicks);
  const formattedNocks = formatNock(nocks);

  const firstName = versionData.name?.first || '';
  const lastName = versionData.name?.last || '';
  const fullName = `[ ${firstName} ${lastName} ]`;

  // Truncate name: first 4 chars of first name ... last 4 chars of last name
  const truncatedName = `[ ${firstName.slice(0, 4)}...${lastName.slice(-4)} ]`;

  const handleCopy = () => {
    navigator.clipboard.writeText(fullName);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg p-3 mb-2" style={{ backgroundColor: surface }}>
      <div className="flex flex-row items-center gap-1 text-sm font-medium">
        <span style={{ color: textPrimary }}>{formattedNocks} NOCK</span>
        <span style={{ color: textMuted }}>{type}</span>
        <span
          className="font-mono cursor-pointer hover:opacity-80 transition-opacity relative group"
          style={{ color: textMuted }}
          onClick={handleCopy}
          title={fullName}
        >
          {truncatedName}
          {copied && (
            <span className="absolute right-0 top-0 z-50 whitespace-nowrap bg-green-500 text-white text-[10px] px-1 rounded transform -translate-y-full">
              Copied!
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

export function SignRawTxScreen() {
  const { pendingSignRawTxRequest, setPendingSignRawTxRequest, navigate, wallet } = useStore();

  if (!pendingSignRawTxRequest) {
    navigate('home');
    return null;
  }

  const { id, origin, rawTx, notes, outputs } = pendingSignRawTxRequest;

  useAutoRejectOnClose(id, INTERNAL_METHODS.REJECT_SIGN_RAW_TX);

  async function handleDecline() {
    await send(INTERNAL_METHODS.REJECT_SIGN_RAW_TX, [id]);
    setPendingSignRawTxRequest(null);
    window.close();
  }

  async function handleSign() {
    await send(INTERNAL_METHODS.APPROVE_SIGN_RAW_TX, [id]);
    setPendingSignRawTxRequest(null);
    window.close();
  }

  // Calculate network fee
  let totalFeeNicks = 0;
  try {
    if (rawTx && rawTx.spends && Array.isArray(rawTx.spends)) {
      totalFeeNicks = rawTx.spends.reduce((sum: number, spend: any) => {
        const feeValue = spend?.spend?.spend_kind?.Witness?.fee?.value;
        const fee = feeValue ? parseInt(feeValue, 10) : 0;
        return sum + (isNaN(fee) ? 0 : fee);
      }, 0);
    }
  } catch (err) {
    console.error('Error calculating fee:', err);
    // Default to 0 if error
  }

  const totalFeeNocks = nickToNock(totalFeeNicks);
  const formattedFee = formatNock(totalFeeNocks);
  const memo = extractMemo({ rawTx, outputs });

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
            Sign Raw Transaction
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

            {/* Raw Transaction Content */}
            <div className="mb-3">
              <label className="text-xs block mb-1.5 font-medium" style={{ color: textMuted }}>
                Inputs ({notes.length})
              </label>
              <div className="max-h-48 overflow-y-auto">
                {notes.map((note: any, index: number) => (
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

            {/* Memo (optional) */}
            {memo && (
              <div className="mb-3">
                <label className="text-xs block mb-1.5 font-medium" style={{ color: textMuted }}>
                  Memo
                </label>
                <div className="rounded-lg p-3" style={{ backgroundColor: surface }}>
                  <p className="text-sm whitespace-pre-wrap break-words" style={{ color: textPrimary }}>
                    {memo}
                  </p>
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
          <button onClick={handleDecline} className="btn-secondary flex-1">
            Decline
          </button>
          <button onClick={handleSign} className="btn-primary flex-1">
            Sign
          </button>
        </div>
      </div>
    </div>
  );
}
