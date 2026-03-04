import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { AccountIcon } from '../components/AccountIcon';
import WalletIconYellow from '../assets/wallet-icon-yellow.svg';
import ArrowDownIcon from '../assets/arrow-down-icon.svg';
import ChevronDownIconAsset from '../assets/wallet-dropdown-arrow.svg';
import InfoIconAsset from '../assets/info-icon.svg';
import PencilEditIcon from '../assets/pencil-edit-icon.svg';
import CheckmarkIcon from '../assets/checkmark-pencil-icon.svg';
import { truncateAddress } from '../utils/format';
import { NOCK_TO_NICKS } from '../../shared/constants';
import {
  buildV0MigrationTransactionFromNotes,
  clearV0MigrationSigningMnemonic,
} from '../../shared/v0-migration';

export function V0MigrationFundsScreen() {
  const { navigate, wallet, v0MigrationDraft, setV0MigrationDraft } = useStore();
  const visibleAccounts = wallet.accounts.filter(account => !account.hidden);
  const groupedBySeed = (wallet.seedSources || [])
    .map(seed => ({
      seed,
      accounts: visibleAccounts.filter(acc => acc.seedAccountId === seed.id),
    }))
    .filter(group => group.accounts.length > 0);
  const destinationSeedGroups =
    groupedBySeed.length > 0
      ? groupedBySeed
      : visibleAccounts.length > 0
        ? [
            {
              seed: {
                id: wallet.activeSeedSourceId || 'legacy',
                name: 'Legacy',
                type: 'mnemonic' as const,
                createdAt: 0,
                accounts: [],
              },
              accounts: visibleAccounts,
            },
          ]
        : [];
  const flattenedDestinationAccounts = useMemo(
    () => destinationSeedGroups.flatMap(group => group.accounts),
    [destinationSeedGroups]
  );
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const [buildError, setBuildError] = useState('');
  const [isEstimatingFee, setIsEstimatingFee] = useState(false);
  const [fee, setFee] = useState('');
  const [isEditingFee, setIsEditingFee] = useState(false);
  const [editedFee, setEditedFee] = useState('');
  const [showFeeTooltip, setShowFeeTooltip] = useState(false);
  const [isFeeManuallyEdited, setIsFeeManuallyEdited] = useState(false);
  const [minimumFee, setMinimumFee] = useState<number | null>(null);
  const [feeOverrideNicks, setFeeOverrideNicks] = useState<string | null>(null);
  const [feeError, setFeeError] = useState('');
  const [feeErrorType, setFeeErrorType] = useState<'fee_too_low' | 'general' | null>(null);

  useEffect(() => {
    if (
      !v0MigrationDraft.destinationWalletAddress &&
      v0MigrationDraft.destinationWalletIndex === null &&
      visibleAccounts.length > 0
    ) {
      const defaultDestination =
        wallet.currentAccount && !wallet.currentAccount.hidden
          ? wallet.currentAccount
          : visibleAccounts[0];
      setV0MigrationDraft({
        destinationWalletIndex: defaultDestination.index,
        destinationWalletAddress: defaultDestination.address,
      });
    }
  }, [
    v0MigrationDraft.destinationWalletAddress,
    v0MigrationDraft.destinationWalletIndex,
    visibleAccounts,
    wallet.currentAccount,
    setV0MigrationDraft,
  ]);

  const destinationWallet =
    flattenedDestinationAccounts.find(
      account =>
        account.address === v0MigrationDraft.destinationWalletAddress ||
        account.index === v0MigrationDraft.destinationWalletIndex
    ) ||
    flattenedDestinationAccounts[0] ||
    null;

  // Reset fee state when destination changes (like SendScreen on account switch)
  useEffect(() => {
    if (!destinationWallet) return;
    setIsFeeManuallyEdited(false);
    setFeeOverrideNicks(null);
  }, [destinationWallet?.address]);

  // Auto-calculate fee when we have notes, source, and destination (fee based on input note)
  // Skip auto-update when user manually edited fee - they control it
  useEffect(() => {
    if (
      !v0MigrationDraft.v0NotesProtobuf?.length ||
      !v0MigrationDraft.sourcePkh ||
      !destinationWallet
    ) {
      return;
    }

    let cancelled = false;
    setIsEstimatingFee(true);
    setBuildError('');

    const minFeeOverride =
      isFeeManuallyEdited && feeOverrideNicks ? feeOverrideNicks : undefined;

    buildV0MigrationTransactionFromNotes(
      v0MigrationDraft.v0NotesProtobuf,
      v0MigrationDraft.sourcePkh,
      destinationWallet.address,
      undefined,
      minFeeOverride
    )
      .then(built => {
        if (cancelled) return;
        const feeNock = built.feeNock;
        setV0MigrationDraft({
          feeNock,
          migratedAmountNock: built.migratedNock,
          signRawTxPayload: built.signRawTxPayload,
          txId: built.txId,
          destinationWalletAddress: destinationWallet.address,
        });
        if (!isFeeManuallyEdited) {
          setFee(feeNock.toString());
          setEditedFee(feeNock.toString());
          setMinimumFee(feeNock);
        }
      })
      .catch(err => {
        if (cancelled) return;
        setBuildError(err instanceof Error ? err.message : 'Failed to calculate fee');
      })
      .finally(() => {
        if (!cancelled) setIsEstimatingFee(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    v0MigrationDraft.v0NotesProtobuf,
    v0MigrationDraft.sourcePkh,
    destinationWallet?.address,
    setV0MigrationDraft,
    isFeeManuallyEdited,
    feeOverrideNicks,
  ]);

  const hasInsufficientFunds =
    v0MigrationDraft.feeNock > 0 && v0MigrationDraft.v0BalanceNock <= v0MigrationDraft.feeNock;

  function handleEditFee() {
    setIsEditingFee(true);
    setEditedFee(fee);
  }

  function handleSaveFee() {
    const feeNum = parseFloat(editedFee);
    if (!isNaN(feeNum) && feeNum >= 0) {
      if (minimumFee !== null && feeNum < minimumFee) {
        setFeeError('Fee too low.');
        setFeeErrorType('fee_too_low');
      } else {
        setFeeError('');
        setFeeErrorType(null);
      }
      setFee(editedFee);
      const nicks = Math.round(feeNum * NOCK_TO_NICKS).toString();
      setFeeOverrideNicks(nicks);
      setIsFeeManuallyEdited(true);
    }
    setIsEditingFee(false);
  }

  function handleFeeInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setEditedFee(value);
    }
  }

  function handleFeeInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSaveFee();
    if (e.key === 'Escape') {
      setIsEditingFee(false);
      setEditedFee(fee);
    }
  }

  function handleFeeInputBlur() {
    handleSaveFee();
  }

  function handleContinue() {
    if (!destinationWallet || !v0MigrationDraft.signRawTxPayload) return;

    if (!v0MigrationDraft.v0NotesProtobuf?.length) {
      setBuildError('No v0 notes loaded. Go back and import your recovery phrase again.');
      return;
    }
    if (!v0MigrationDraft.sourcePkh) {
      setBuildError('Missing v0 source key data. Go back and import your recovery phrase again.');
      return;
    }

    // Transaction already built by useEffect; just navigate to review
    navigate('v0-migration-review');
  }

  return (
    <div
      className="relative w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      <div className="flex items-center justify-between h-16 px-4 py-3 border-b border-[var(--color-divider)]">
        <button
          type="button"
          onClick={() => navigate('v0-migration-setup')}
          className="p-2 -ml-2 hover:opacity-70 transition-opacity text-[var(--color-text-primary)]"
          aria-label="Go back"
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h2
          className="font-sans font-medium text-[var(--color-text-primary)]"
          style={{
            fontSize: 'var(--font-size-lg)',
            lineHeight: 'var(--line-height-normal)',
            letterSpacing: '0.01em',
          }}
        >
          Transfer v0 funds
        </h2>
        <div className="w-8" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src={WalletIconYellow} alt="" className="w-10 h-10" />
          <p
            className="font-sans font-medium text-center text-[var(--color-text-primary)]"
            style={{
              fontSize: 'var(--font-size-base)',
              lineHeight: 'var(--line-height-snug)',
            }}
          >
            Pick a wallet to receive your v0 funds.
          </p>
        </div>

        <div className="rounded-[14px] p-4" style={{ backgroundColor: 'var(--color-surface-900)' }}>
          <div className="text-[12px] leading-[18px] font-medium">v0 Wallet Balance</div>
          <div className="mt-2 text-[56px] leading-[56px] font-display tracking-[-0.03em]">
            {v0MigrationDraft.v0BalanceNock.toLocaleString('en-US')}
          </div>
        </div>

        <div className="flex justify-center py-0.5">
          <div
            className="w-10 h-10 rounded-full grid place-items-center shrink-0"
            style={{ border: '1px solid var(--color-surface-700)' }}
          >
            <img src={ArrowDownIcon} alt="" className="w-4 h-4" />
          </div>
        </div>

        <div>
          <div className="font-sans font-medium mb-2 text-[var(--color-text-primary)]" style={{ fontSize: 'var(--font-size-base)' }}>
            Receiving wallet
          </div>
          <button
            type="button"
            onClick={() => setShowWalletPicker(true)}
            className="w-full rounded-lg border px-4 py-3 flex items-center justify-between"
            style={{ borderColor: 'var(--color-surface-700)' }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {destinationWallet ? (
                <AccountIcon
                  styleId={destinationWallet.iconStyleId}
                  color={destinationWallet.iconColor}
                  className="w-9 h-9"
                />
              ) : (
                <div className="w-9 h-9 rounded-full" style={{ backgroundColor: 'var(--color-surface-900)' }} />
              )}
              <div className="text-left min-w-0">
                <div className="font-sans font-medium truncate text-[var(--color-text-primary)]" style={{ fontSize: 'var(--font-size-base)' }}>
                  {destinationWallet?.name || 'Select wallet'}
                </div>
                <div className="text-[12px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {truncateAddress(destinationWallet?.address)}
                </div>
              </div>
            </div>
            <img src={ChevronDownIconAsset} alt="" className="w-4 h-4" />
          </button>
        </div>

        {hasInsufficientFunds && (
          <div
            className="rounded-lg px-3 py-2 font-sans font-medium text-[14px]"
            style={{ backgroundColor: 'var(--color-red-light)', color: 'var(--color-red)' }}
          >
            Insufficient funds to cover transaction fee.
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-sans font-medium text-[var(--color-text-primary)]" style={{ fontSize: 'var(--font-size-base)' }}>
              Fee
              <div
                className="relative inline-block"
                onMouseEnter={() => setShowFeeTooltip(true)}
                onMouseLeave={() => setShowFeeTooltip(false)}
              >
                <img src={InfoIconAsset} alt="Fee information" className="w-4 h-4 cursor-help" />
                {showFeeTooltip && (
                  <div className="absolute left-0 bottom-full mb-2 w-64 z-50">
                    <div
                      className="rounded-lg px-3 py-2.5 text-[12px] leading-4 font-medium tracking-[0.02em] shadow-lg"
                      style={{
                        backgroundColor: 'var(--color-surface-800)',
                        color: 'var(--color-text-muted)',
                        border: '1px solid var(--color-surface-700)',
                      }}
                    >
                      Network fee based on input note. Adjustable for priority.
                      <div
                        className="absolute left-4 top-full w-0 h-0"
                        style={{
                          borderLeft: '6px solid transparent',
                          borderRight: '6px solid transparent',
                          borderTop: '6px solid var(--color-surface-800)',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            {isEditingFee ? (
              <div
                className="rounded-lg pl-1 pr-1 py-1 inline-flex items-center gap-2"
                style={{ border: '1px solid var(--color-surface-700)' }}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={editedFee}
                  onChange={handleFeeInputChange}
                  onKeyDown={handleFeeInputKeyDown}
                  onBlur={handleFeeInputBlur}
                  autoFocus
                  className="w-8 h-3 bg-transparent outline-none text-[14px] leading-[18px] font-medium text-right"
                  style={{ color: 'var(--color-text-primary)' }}
                  placeholder="0"
                />
                <span className="text-[14px] leading-[18px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  NOCK
                </span>
                <button
                  type="button"
                  onClick={handleSaveFee}
                  className="p-0.5 rounded transition-opacity hover:opacity-80 focus:outline-none"
                  aria-label="Save fee"
                >
                  <img src={CheckmarkIcon} alt="" className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleEditFee}
                className="rounded-lg pl-2.5 pr-2 py-1.5 flex items-center justify-between transition-colors focus:outline-none"
                style={{
                  backgroundColor: 'var(--color-surface-800)',
                  minWidth: '120px',
                  minHeight: '34px',
                }}
                onMouseEnter={e =>
                  (e.currentTarget.style.backgroundColor = 'var(--color-surface-700)')
                }
                onMouseLeave={e =>
                  (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')
                }
              >
                <div
                  className="text-[14px] leading-[18px] font-medium flex items-center gap-1.5"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {isEstimatingFee ? (
                    <div
                      className="w-3.5 h-3.5 border-2 rounded-full animate-spin"
                      style={{
                        borderColor: 'var(--color-text-muted)',
                        borderTopColor: 'transparent',
                      }}
                    />
                  ) : fee || v0MigrationDraft.feeNock ? (
                    `${fee || v0MigrationDraft.feeNock} NOCK`
                  ) : (
                    '-'
                  )}
                </div>
                <img src={PencilEditIcon} alt="Edit" className="w-4 h-4 flex-shrink-0" />
              </button>
            )}
          </div>
          {(feeError || buildError) && (
            <div
              className="px-3 py-2 text-[13px] leading-[18px] font-medium rounded-lg flex items-center justify-between"
              style={{
                backgroundColor: 'var(--color-red-light)',
                color: 'var(--color-red)',
              }}
            >
              <span>{feeError || buildError}</span>
              {feeErrorType === 'fee_too_low' && minimumFee !== null ? (
                <button
                  type="button"
                  onClick={() => {
                    const feeStr = minimumFee.toString();
                    setFee(feeStr);
                    setEditedFee(feeStr);
                    setFeeError('');
                    setFeeErrorType(null);
                    setIsFeeManuallyEdited(false);
                    setFeeOverrideNicks(null);
                  }}
                  className="underline hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--color-red)' }}
                >
                  Reset
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--color-surface-800)] px-4 py-3">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              clearV0MigrationSigningMnemonic();
              setV0MigrationDraft({
                signRawTxPayload: undefined,
                txId: undefined,
                sourceAddress: undefined,
                sourcePkh: undefined,
                v0NotesProtobuf: undefined,
                destinationWalletAddress: undefined,
                destinationWalletIndex: null,
              });
              navigate('settings');
            }}
            className="flex-1 h-12 px-5 py-[15px] bg-[var(--color-surface-800)] text-[var(--color-text-primary)] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 font-sans font-medium"
            style={{
              fontSize: 'var(--font-size-base)',
              lineHeight: 'var(--line-height-snug)',
              letterSpacing: '0.01em',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              hasInsufficientFunds ||
              !destinationWallet ||
              isEstimatingFee ||
              !v0MigrationDraft.signRawTxPayload
            }
            onClick={handleContinue}
            className="flex-1 h-12 px-5 py-[15px] bg-[var(--color-primary)] text-[#000000] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed font-sans font-medium"
            style={{
              fontSize: 'var(--font-size-base)',
              lineHeight: 'var(--line-height-snug)',
              letterSpacing: '0.01em',
            }}
          >
            {isEstimatingFee ? 'Calculating...' : 'Continue'}
          </button>
        </div>
      </div>

      {showWalletPicker && (
        <>
          <div className="absolute inset-0 z-40" onClick={() => setShowWalletPicker(false)} />
          <div
            className="absolute top-[218px] left-4 right-4 rounded-xl z-50 flex flex-col max-h-[320px] overflow-hidden"
            style={{
              backgroundColor: 'var(--color-bg)',
              border: '1px solid var(--color-surface-700)',
              boxShadow: '0 4px 12px 0 rgba(5, 5, 5, 0.12)',
            }}
          >
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              {destinationSeedGroups.map(group => (
                <div
                  key={group.seed.id}
                  className="mb-2 rounded-xl flex flex-col gap-1"
                  style={{ backgroundColor: 'var(--color-bg)' }}
                >
                  <div className="flex flex-col gap-1">
                    {group.accounts.map(account => {
                      const isSelected =
                        account.address === v0MigrationDraft.destinationWalletAddress ||
                        account.index === v0MigrationDraft.destinationWalletIndex;
                      const isTopLevelWallet = account.index === 0;
                      const balance = wallet.accountBalances[account.address] ?? 0;
                      return (
                        <button
                          key={account.address}
                          type="button"
                          onClick={() => {
                            setV0MigrationDraft({
                              destinationWalletIndex: account.index,
                              destinationWalletAddress: account.address,
                            });
                            setShowWalletPicker(false);
                          }}
                          className="self-stretch pl-2 pr-3 py-2 rounded-lg inline-flex justify-between items-center gap-2.5 transition"
                          style={{
                            backgroundColor: isSelected ? 'var(--color-surface-900)' : 'transparent',
                            paddingLeft: isTopLevelWallet ? undefined : 24,
                          }}
                          onMouseEnter={e => {
                            if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-surface-800)';
                          }}
                          onMouseLeave={e => {
                            if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                        >
                          <div className="flex-1 flex justify-start items-center gap-2.5 min-w-0">
                            <div
                              className="w-10 h-10 shrink-0 relative grid place-items-center rounded-[9.6px]"
                              style={{ backgroundColor: 'var(--color-bg)' }}
                            >
                              <AccountIcon
                                styleId={account.iconStyleId}
                                color={account.iconColor}
                                className="w-6 h-6"
                              />
                            </div>
                            <div className="flex-1 inline-flex flex-col justify-center items-start gap-0.5 min-w-0">
                              <div
                                className="text-sm font-medium leading-4 tracking-tight truncate w-full text-left"
                                style={{ color: 'var(--color-text-primary)' }}
                              >
                                {account.name}
                              </div>
                              <div
                                className="text-xs font-normal leading-4 tracking-tight"
                                style={{ color: 'var(--color-text-muted)' }}
                              >
                                {truncateAddress(account.address)}
                              </div>
                            </div>
                          </div>
                          <div
                            className="text-sm font-medium leading-4 tracking-tight text-right shrink-0 whitespace-nowrap"
                            style={{ color: 'var(--color-text-primary)' }}
                          >
                            {balance.toLocaleString('en-US', { maximumFractionDigits: 0 })} NOCK
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
