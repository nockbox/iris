import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { AccountIcon } from '../components/AccountIcon';
import { Alert } from '../components/Alert';
import WalletIconYellow from '../assets/wallet-icon-yellow.svg';
import ArrowDownIcon from '../assets/arrow-down-icon.svg';
import ChevronDownIconAsset from '../assets/wallet-dropdown-arrow.svg';
import InfoIconAsset from '../assets/info-icon.svg';
import { truncateAddress } from '../utils/format';
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
  const [isBuilding, setIsBuilding] = useState(false);

  useEffect(() => {
    if (
      !v0MigrationDraft.destinationWalletAddress &&
      v0MigrationDraft.destinationWalletIndex === null &&
      visibleAccounts.length > 0
    ) {
      setV0MigrationDraft({
        destinationWalletIndex: visibleAccounts[0].index,
        destinationWalletAddress: visibleAccounts[0].address,
      });
    }
  }, [
    v0MigrationDraft.destinationWalletAddress,
    v0MigrationDraft.destinationWalletIndex,
    visibleAccounts,
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
  const hasInsufficientFunds = v0MigrationDraft.v0BalanceNock <= v0MigrationDraft.feeNock;

  async function handleContinue() {
    if (!destinationWallet || isBuilding) return;

    if (!v0MigrationDraft.v0NotesProtobuf?.length) {
      setBuildError('No v0 notes loaded. Go back and import your recovery phrase again.');
      return;
    }
    if (!v0MigrationDraft.sourcePkh) {
      setBuildError('Missing v0 source key data. Go back and import your recovery phrase again.');
      return;
    }

    setBuildError('');
    setIsBuilding(true);
    try {
      const built = await buildV0MigrationTransactionFromNotes(
        v0MigrationDraft.v0NotesProtobuf,
        v0MigrationDraft.sourcePkh,
        destinationWallet.address
      );
      console.log('[V0 Migration] transaction build', {
        sourceAddress: v0MigrationDraft.sourceAddress,
        sourcePkh: v0MigrationDraft.sourcePkh,
        destinationPkh: destinationWallet.address,
        discoveredV0BalanceNock: v0MigrationDraft.v0BalanceNock,
        migratedAmountNock: built.migratedNock,
        feeNock: built.feeNock,
        selectedNoteNock: built.selectedNoteNock,
        selectedNoteNicks: built.selectedNoteNicks,
        txInputs: {
          notesCount: built.signRawTxPayload.notes?.length ?? 0,
          spendConditionsCount: built.signRawTxPayload.spendConditions?.length ?? 0,
          notes: built.signRawTxPayload.notes,
          spendConditions: built.signRawTxPayload.spendConditions,
        },
        finalTransaction: {
          txId: built.txId,
          rawTx: built.signRawTxPayload.rawTx,
        },
      });

      setV0MigrationDraft({
        migratedAmountNock: built.migratedNock,
        feeNock: built.feeNock,
        signRawTxPayload: built.signRawTxPayload,
        txId: built.txId,
        destinationWalletAddress: destinationWallet.address,
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

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-sans font-medium text-[var(--color-text-primary)]" style={{ fontSize: 'var(--font-size-base)' }}>
            Fee
            <img src={InfoIconAsset} alt="" className="w-4 h-4" />
          </div>
          <div
            className="h-12 rounded-lg px-3 py-2 flex items-center gap-2 border"
            style={{ borderColor: 'var(--color-surface-700)' }}
          >
            <span className="font-sans font-medium text-[var(--color-text-primary)]" style={{ fontSize: 'var(--font-size-base)' }}>{v0MigrationDraft.feeNock} NOCK</span>
          </div>
        </div>

        {buildError && <Alert type="error">{buildError}</Alert>}
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
