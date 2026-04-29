import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { AccountIcon } from '../components/AccountIcon';
import WalletIconYellow from '../assets/wallet-icon-yellow.svg';
import ArrowDownIcon from '../assets/arrow-down-icon.svg';
import ChevronDownIconAsset from '../assets/wallet-dropdown-arrow.svg';
import { truncateAddress } from '../utils/format';
import { PlusIcon } from '../components/icons/PlusIcon';
import { pkhAddressToDigest } from '../../shared/address-encoding';
import { buildV0MigrationTx } from '../../shared/v0-migration';

function formatNockAmount(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function yieldToPaint(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function V0MigrationFundsScreen() {
  const { navigate, wallet, v0MigrationDraft, setV0MigrationDraft, resetV0MigrationDraft } =
    useStore();
  const visibleAccounts = wallet.accounts.filter(account => !account.hidden);
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const [buildError, setBuildError] = useState('');
  const [isBuilding, setIsBuilding] = useState(false);

  // Shrink the big v0 balance number to fit its card when the value is wide
  // (e.g. 236,807.58). Starts at 56px, floors at 28px.
  const balanceContainerRef = useRef<HTMLDivElement | null>(null);
  const balanceTextRef = useRef<HTMLSpanElement | null>(null);
  const [balanceFontSize, setBalanceFontSize] = useState(56);

  useEffect(() => {
    if (v0MigrationDraft.destinationAddress == null && visibleAccounts.length > 0) {
      setV0MigrationDraft({ destinationAddress: visibleAccounts[0].address });
    }
  }, [v0MigrationDraft.destinationAddress, visibleAccounts, setV0MigrationDraft]);

  const v0BalanceDisplay = formatNockAmount(v0MigrationDraft.v0BalanceNock ?? 0);

  useLayoutEffect(() => {
    const container = balanceContainerRef.current;
    const text = balanceTextRef.current;
    if (!container || !text) return;

    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const maxWidth = container.clientWidth;
        if (!maxWidth) return;
        let size = 56;
        text.style.fontSize = `${size}px`;
        while (text.scrollWidth > maxWidth && size > 28) {
          size -= 1;
          text.style.fontSize = `${size}px`;
        }
        setBalanceFontSize(size);
      });
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [v0BalanceDisplay]);

  const destinationWallet =
    visibleAccounts.find(account => account.address === v0MigrationDraft.destinationAddress) ||
    visibleAccounts[0] ||
    null;

  async function handleContinue() {
    if (!destinationWallet || isBuilding) return;

    if (!v0MigrationDraft.v0Mnemonic) {
      setBuildError('No recovery phrase loaded. Go back and import your recovery phrase again.');
      return;
    }

    setBuildError('');
    setIsBuilding(true);
    try {
      await yieldToPaint();
      const result = await buildV0MigrationTx(
        v0MigrationDraft.v0Mnemonic,
        pkhAddressToDigest(destinationWallet.address)
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
          <div
            ref={balanceContainerRef}
            className="mt-2 font-display tracking-[-0.03em]"
            style={{ width: '100%' }}
          >
            <span
              ref={balanceTextRef}
              style={{
                display: 'inline-block',
                whiteSpace: 'nowrap',
                fontSize: `${balanceFontSize}px`,
                lineHeight: '56px',
              }}
            >
              {v0BalanceDisplay}
            </span>
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
          <div
            className="font-sans font-medium mb-2 text-[var(--color-text-primary)]"
            style={{ fontSize: 'var(--font-size-base)' }}
          >
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
                <div
                  className="w-9 h-9 rounded-full"
                  style={{ backgroundColor: 'var(--color-surface-900)' }}
                />
              )}
              <div className="text-left min-w-0">
                <div
                  className="font-sans font-medium truncate text-[var(--color-text-primary)]"
                  style={{ fontSize: 'var(--font-size-base)' }}
                >
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

        {buildError && (
          <div
            className="rounded-lg px-3 py-2 font-sans font-medium text-[14px]"
            style={{ backgroundColor: 'var(--color-red-light)', color: 'var(--color-red)' }}
          >
            {buildError}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-surface-800)] px-4 py-3">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              resetV0MigrationDraft();
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
            disabled={!destinationWallet || isBuilding}
            onClick={handleContinue}
            className="flex-1 h-12 px-5 py-[15px] bg-[var(--color-primary)] text-[#000000] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed font-sans font-medium"
            style={{
              fontSize: 'var(--font-size-base)',
              lineHeight: 'var(--line-height-snug)',
              letterSpacing: '0.01em',
            }}
          >
            Continue
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
              <button type="button" onClick={() => setShowWalletPicker(false)} className="p-1.5">
                <ChevronLeftIcon className="w-5 h-5 rotate-180" />
              </button>
            </div>

            {visibleAccounts.map((account, index) => {
              const isSelected = account.address === v0MigrationDraft.destinationAddress;
              const balance = wallet.accountBalances[account.address] ?? 0;
              return (
                <button
                  key={account.address}
                  type="button"
                  onClick={() => {
                    setV0MigrationDraft({
                      destinationAddress: account.address,
                      v0MigrationTxSignPayload: undefined,
                      txId: undefined,
                      migratedAmountNock: undefined,
                      feeNock: undefined,
                    });
                    setBuildError('');
                    setShowWalletPicker(false);
                  }}
                  className="w-full rounded-[14px] px-3 py-3 mb-2 flex items-center justify-between"
                  style={{
                    backgroundColor: 'var(--color-surface-900)',
                    border: isSelected
                      ? '1px solid var(--color-text-primary)'
                      : '1px solid transparent',
                  }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AccountIcon
                      styleId={account.iconStyleId}
                      color={account.iconColor}
                      className="w-10 h-10"
                    />
                    <div className="text-left min-w-0">
                      <div className="text-[16px] font-medium">{account.name}</div>
                      <div
                        className="text-[12px] truncate"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
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

      {isBuilding && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center p-5"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
        >
          <div
            className="w-full rounded-[20px] border p-5 flex flex-col items-center gap-3 text-center"
            style={{
              backgroundColor: 'var(--color-bg)',
              borderColor: 'var(--color-surface-700)',
              color: 'var(--color-text-primary)',
            }}
          >
            <div
              className="w-8 h-8 border-2 rounded-full animate-spin"
              style={{
                borderColor: 'var(--color-text-muted)',
                borderTopColor: 'var(--color-primary)',
              }}
            />
            <div className="text-[16px] font-medium">Building migration transaction</div>
            <div
              className="text-[13px] leading-[18px]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Calculating the network fee and preparing your v0 notes. This might take a second.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
