import { useEffect, useState, useRef } from 'react';
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
import { PlusIcon } from '../components/icons/PlusIcon';
import { pkhAddressToDigest } from '../../shared/address-encoding';
import { buildV0MigrationTx } from '../../shared/v0-migration';

export function V0MigrationFundsScreen() {
  const { navigate, wallet, v0MigrationDraft, setV0MigrationDraft } = useStore();
  const visibleAccounts = wallet.accounts.filter(account => !account.hidden);
  const debugSpendAmount = v0MigrationDraft.migratedAmountNock;
  const isDebugSingleNoteSpend =
    debugSpendAmount != null && debugSpendAmount !== v0MigrationDraft.v0BalanceNock;
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const [buildError, setBuildError] = useState('');
  const [errorType, setErrorType] = useState<'fee_too_low' | 'general' | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isEstimatingFee, setIsEstimatingFee] = useState(false);
  const [fee, setFee] = useState('');
  const [isEditingFee, setIsEditingFee] = useState(false);
  const [editedFee, setEditedFee] = useState('');
  const [showFeeTooltip, setShowFeeTooltip] = useState(false);
  const [isFeeManuallyEdited, setIsFeeManuallyEdited] = useState(false);
  const [minimumFee, setMinimumFee] = useState<number | null>(null);
  const estimateAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (v0MigrationDraft.destinationWalletIndex === null && visibleAccounts.length > 0) {
      setV0MigrationDraft({ destinationWalletIndex: visibleAccounts[0].index });
    }
  }, [v0MigrationDraft.destinationWalletIndex, visibleAccounts, setV0MigrationDraft]);

  const destinationWallet =
    visibleAccounts.find(account => account.index === v0MigrationDraft.destinationWalletIndex) ||
    visibleAccounts[0] ||
    null;

  // Dynamic fee estimation - debounced (same pattern as SendScreen)
  // Uses selected destination wallet address (one of our own), not a dummy
  useEffect(() => {
    if (!v0MigrationDraft.v0Mnemonic || !destinationWallet?.address) return;
    if (isFeeManuallyEdited) return;

    setBuildError('');
    setErrorType(null);
    setIsEstimatingFee(true);

    const ac = new AbortController();
    estimateAbortRef.current = ac;

    const timeoutId = setTimeout(async () => {
      try {
        const result = await buildV0MigrationTx(
          v0MigrationDraft.v0Mnemonic!,
          pkhAddressToDigest(destinationWallet!.address),
          true
        );
        if (ac.signal.aborted) return;
        const feeNock = result.feeNock;
        setV0MigrationDraft({ feeNock, migratedAmountNock: result.migratedNock });
        if (feeNock != null) {
          setFee(feeNock.toString());
          setEditedFee(feeNock.toString());
          setMinimumFee(feeNock);
        } else {
          setFee('');
          setEditedFee('');
          setMinimumFee(null);
        }
        setBuildError('');
      } catch (err) {
        if (ac.signal.aborted) return;
        setBuildError(err instanceof Error ? err.message : 'Failed to estimate fee');
        setErrorType('general');
        setV0MigrationDraft({ feeNock: undefined, migratedAmountNock: undefined });
        setFee('');
        setEditedFee('');
        setMinimumFee(null);
      } finally {
        if (!ac.signal.aborted) setIsEstimatingFee(false);
        estimateAbortRef.current = null;
      }
    }, 500);

    return () => {
      clearTimeout(timeoutId);
      ac.abort();
      setIsEstimatingFee(false);
    };
  }, [v0MigrationDraft.v0Mnemonic, destinationWallet?.address, destinationWallet?.index, v0MigrationDraft.destinationWalletIndex, isFeeManuallyEdited, setV0MigrationDraft]);

  const hasInsufficientFunds =
    v0MigrationDraft.feeNock != null && v0MigrationDraft.v0BalanceNock <= v0MigrationDraft.feeNock;

  function handleEditFee() {
    setIsEditingFee(true);
    setEditedFee(fee);
  }

  function handleSaveFee() {
    const feeNum = parseFloat(editedFee);
    if (!isNaN(feeNum) && feeNum >= 0) {
      if (minimumFee !== null && feeNum < minimumFee) {
        setBuildError('Fee too low.');
        setErrorType('fee_too_low');
      } else {
        setBuildError('');
        setErrorType(null);
      }
      setFee(editedFee);
      setV0MigrationDraft({ feeNock: feeNum });
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

  async function handleContinue() {
    if (!destinationWallet || isBuilding) return;

    if (!v0MigrationDraft.v0Mnemonic) {
      setBuildError('No recovery phrase loaded. Go back and import your recovery phrase again.');
      return;
    }

    setBuildError('');
    setIsBuilding(true);
    try {
      const result = await buildV0MigrationTx(
        v0MigrationDraft.v0Mnemonic,
        pkhAddressToDigest(destinationWallet.address),
        true
      );
      if (!result.txId || !result.v0MigrationTxSignPayload) {
        throw new Error('Failed to build migration transaction');
      }

      setV0MigrationDraft({
        migratedAmountNock: result.migratedNock,
        feeNock: result.feeNock,
        v0MigrationTxSignPayload: result.v0MigrationTxSignPayload,
        txId: result.txId,
      });
      navigate('v0-migration-review');
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : 'Failed to build migration transaction');
    } finally {
      setIsBuilding(false);
    }
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

        {isDebugSingleNoteSpend && (
          <div
            className="rounded-[14px] p-3 flex items-center justify-between"
            style={{ backgroundColor: 'var(--color-surface-900)' }}
          >
            <span className="text-[14px] font-medium">Debug note spend</span>
            <span className="text-[14px] font-medium">
              {debugSpendAmount.toLocaleString('en-US')} NOCK
            </span>
          </div>
        )}

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

        {/* Fee */}
        <div className="flex flex-col gap-1.5 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[14px] leading-[18px] font-medium">
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
                      Network transaction fee. Adjustable if needed.
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
                  placeholder="1"
                />
                <span
                  className="text-[14px] leading-[18px] font-medium"
                  style={{ color: 'var(--color-text-muted)' }}
                >
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
                  ) : fee ? (
                    `${fee} NOCK`
                  ) : (
                    '-'
                  )}
                </div>
                <img src={PencilEditIcon} alt="Edit" className="w-4 h-4 flex-shrink-0" />
              </button>
            )}
          </div>
          {buildError && (
            <div
              className="px-3 py-2 text-[13px] leading-[18px] font-medium rounded-lg flex items-center justify-between mt-2"
              style={{
                backgroundColor: 'var(--color-red-light)',
                color: 'var(--color-red)',
              }}
            >
              <span>{buildError}</span>
              {errorType === 'fee_too_low' && minimumFee !== null && (
                <button
                  type="button"
                  onClick={() => {
                    const feeStr = minimumFee.toString();
                    setFee(feeStr);
                    setEditedFee(feeStr);
                    setV0MigrationDraft({ feeNock: minimumFee });
                    setBuildError('');
                    setErrorType(null);
                    setIsFeeManuallyEdited(false);
                  }}
                  className="underline hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--color-red)' }}
                >
                  Reset
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--color-surface-800)] px-4 py-3">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate('settings')}
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
            disabled={hasInsufficientFunds || !destinationWallet || isBuilding}
            onClick={handleContinue}
            className="flex-1 h-12 px-5 py-[15px] bg-[var(--color-primary)] text-[#000000] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed font-sans font-medium"
            style={{
              fontSize: 'var(--font-size-base)',
              lineHeight: 'var(--line-height-snug)',
              letterSpacing: '0.01em',
            }}
          >
            {isBuilding ? 'Building...' : 'Continue'}
          </button>
        </div>
      </div>

      {showWalletPicker && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center p-3"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
        >
          <div
            className="w-full max-h-[520px] rounded-[20px] border p-3 overflow-y-auto"
            style={{ backgroundColor: 'var(--color-bg)', borderColor: 'var(--color-surface-700)' }}
          >
            <div className="flex items-center justify-between h-10 mb-2">
              <div className="w-7" />
              <h2 className="text-[16px] font-medium">Select wallet</h2>
              <button type="button" onClick={() => setShowWalletPicker(false)} className="p-1.5">
                <ChevronLeftIcon className="w-5 h-5 rotate-180" />
              </button>
            </div>

            {visibleAccounts.map((account, index) => {
              const isSelected = account.index === v0MigrationDraft.destinationWalletIndex;
              const balance = wallet.accountBalances[account.address] ?? 0;
              return (
                <button
                  key={account.index} 
                  type="button"
                  onClick={() => {
                    setV0MigrationDraft({
                      destinationWalletIndex: account.index,
                      v0MigrationTxSignPayload: undefined,
                      txId: undefined,
                      migratedAmountNock: undefined,
                      feeNock: undefined,
                    });
                    setFee('');
                    setEditedFee('');
                    setMinimumFee(null);
                    setIsFeeManuallyEdited(false);
                    setBuildError('');
                    setErrorType(null);
                    setShowWalletPicker(false);
                  }}
                  className="w-full rounded-[14px] px-3 py-3 mb-2 flex items-center justify-between"
                  style={{
                    backgroundColor: 'var(--color-surface-900)',
                    border: isSelected ? '1px solid var(--color-text-primary)' : '1px solid transparent',
                  }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AccountIcon styleId={account.iconStyleId} color={account.iconColor} className="w-10 h-10" />
                    <div className="text-left min-w-0">
                      <div className="text-[16px] font-medium">{account.name}</div>
                      <div className="text-[12px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {truncateAddress(account.address)}
                      </div>
                    </div>
                  </div>
                  {index === 0 && (
                    <div className="text-[16px] font-medium whitespace-nowrap">
                      {balance.toLocaleString('en-US', { maximumFractionDigits: 0 })} NOCK
                    </div>
                  )}
                </button>
              );
            })}

            <button
              type="button"
              className="w-full rounded-[14px] px-3 py-3 mb-2 flex items-center gap-2.5"
              style={{ backgroundColor: 'transparent' }}
            >
              <div className="w-10 h-10 rounded-full grid place-items-center bg-[var(--color-surface-900)]">
                <PlusIcon className="w-5 h-5" />
              </div>
              <div className="text-[16px] font-medium">Add sub-wallet</div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
