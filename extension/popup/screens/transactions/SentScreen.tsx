/**
 * Sent Screen - Transaction confirmation after successful send
 */

import { useStore } from '../../store';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ChevronLeftIcon } from '../../components/icons/ChevronLeftIcon';
import { CheckIcon } from '../../components/icons/CheckIcon';
import { ArrowUpRightIcon } from '../../components/icons/ArrowUpRightIcon';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { formatNock } from '../../../shared/currency';

export function SentScreen() {
  const { navigate, lastTransaction } = useStore();
  const { copied, copyToClipboard } = useCopyToClipboard();

  if (!lastTransaction) {
    // If no transaction data, redirect to home
    navigate('home');
    return null;
  }

  const { txid, amount, fee } = lastTransaction;
  const total = amount + fee;

  function handleViewDetails() {
    // TODO: Navigate to transaction details screen
    // For now, just navigate home
    navigate('home');
  }

  return (
    <ScreenContainer className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('home')}
          className="transition-colors"
          style={{ color: 'var(--color-text-primary)' }}
        >
          <ChevronLeftIcon />
        </button>
        <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Send NOCK
        </h2>
      </div>

      {/* Success icon */}
      <div className="flex justify-center mb-6">
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'var(--color-green-light)' }}
        >
          <CheckIcon className="w-12 h-12" style={{ color: 'var(--color-green)' }} />
        </div>
      </div>

      {/* Success message */}
      <h3
        className="text-2xl font-semibold text-center mb-2"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Sent!
      </h3>
      <p className="text-center mb-8" style={{ color: 'var(--color-text-muted)' }}>
        Your transaction has been broadcast to the network
      </p>

      {/* Transaction details */}
      <div
        className="rounded-lg p-4 mb-4 space-y-3"
        style={{ backgroundColor: 'var(--color-surface-800)' }}
      >
        <div className="flex justify-between items-center">
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Amount
          </span>
          <span className="font-mono" style={{ color: 'var(--color-text-primary)' }}>
            {formatNock(amount)} NOCK
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Fee
          </span>
          <span className="font-mono" style={{ color: 'var(--color-text-primary)' }}>
            {formatNock(fee)} NOCK
          </span>
        </div>
        <div
          className="pt-3 flex justify-between items-center"
          style={{ borderTop: '1px solid var(--color-divider)' }}
        >
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Total
          </span>
          <span className="font-mono font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {formatNock(total)} NOCK
          </span>
        </div>
      </div>

      {/* Transaction ID */}
      <div className="rounded-lg p-4 mb-6" style={{ backgroundColor: 'var(--color-surface-800)' }}>
        <p className="text-sm mb-2" style={{ color: 'var(--color-text-muted)' }}>
          Transaction ID:
        </p>
        <button onClick={() => copyToClipboard(txid)} className="w-full text-left">
          <p
            className="text-sm font-mono break-all mb-2"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {txid}
          </p>
        </button>
        {copied && (
          <p className="text-xs" style={{ color: 'var(--color-green)' }}>
            Copied to clipboard!
          </p>
        )}
        <button
          onClick={handleViewDetails}
          className="flex items-center gap-2 text-sm transition-colors mt-2"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
        >
          <ArrowUpRightIcon className="w-4 h-4" />
          View Details
        </button>
      </div>

      {/* Action button */}
      <button onClick={() => navigate('home')} className="btn-primary">
        View Details
      </button>
    </ScreenContainer>
  );
}
