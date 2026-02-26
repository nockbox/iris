import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { AccountIcon } from '../components/AccountIcon';
import LockIconYellow from '../assets/lock-icon-yellow.svg';
import WalletIconYellow from '../assets/wallet-icon-yellow.svg';
import ArrowUpIcon from '../assets/arrow-up-icon.svg';
import ArrowDownIcon from '../assets/arrow-down-icon.svg';
import ChevronDownIconAsset from '../assets/wallet-dropdown-arrow.svg';
import InfoIconAsset from '../assets/info-icon.svg';
import { truncateAddress } from '../utils/format';
import { PlusIcon } from '../components/icons/PlusIcon';

const WORD_COUNT = 24;

export function V0MigrationSetupScreen() {
  const { navigate, wallet, v0MigrationDraft, setV0MigrationDraft } = useStore();
  const visibleAccounts = wallet.accounts.filter(account => !account.hidden);
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (v0MigrationDraft.destinationWalletIndex === null && visibleAccounts.length > 0) {
      setV0MigrationDraft({ destinationWalletIndex: visibleAccounts[0].index });
    }
  }, [v0MigrationDraft.destinationWalletIndex, visibleAccounts, setV0MigrationDraft]);

  const destinationWallet =
    visibleAccounts.find(account => account.index === v0MigrationDraft.destinationWalletIndex) ||
    visibleAccounts[0] ||
    null;
  const hasInsufficientFunds = v0MigrationDraft.v0BalanceNock <= v0MigrationDraft.feeNock;

  async function handlePasteAll() {
    try {
      const raw = await navigator.clipboard.readText();
      const pasted = raw.trim().toLowerCase().split(/\s+/).slice(0, WORD_COUNT);
      const next = Array(WORD_COUNT).fill('');
      pasted.forEach((word, index) => {
        next[index] = word;
      });
      setV0MigrationDraft({ seedWords: next });
    } catch (error) {
      console.warn('Paste failed:', error);
    }
  }

  function handleWordChange(index: number, value: string) {
    const next = [...v0MigrationDraft.seedWords];
    next[index] = value.trim().toLowerCase();
    setV0MigrationDraft({ seedWords: next });
  }

  function handleFilePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setV0MigrationDraft({ keyfileName: file.name });
  }

  return (
    <div
      className="relative w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      <header className="flex items-center justify-between h-16 px-4">
        <button type="button" onClick={() => navigate('v0-migration-intro')} className="p-2">
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-[16px] font-medium tracking-[0.01em]">Transfer v0 funds</h1>
        <div className="w-7" />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <img src={LockIconYellow} alt="" className="w-10 h-10" />
          <p className="text-[10px] leading-8 font-medium">
            Enter your 24-word recovery phrase.
            <br />
            Paste into first field to auto-fill all words.
          </p>
        </div>

        <div
          className="rounded-[14px] h-[52px] px-4 flex items-center justify-center gap-2"
          style={{ backgroundColor: '#EDE4C8' }}
        >
          <img src={ArrowUpIcon} alt="" className="w-4 h-4" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-[16px] leading-[22px] font-medium"
          >
            Upload a keyfile
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFilePick}
          />
        </div>

        {v0MigrationDraft.keyfileName && (
          <div className="text-[12px] text-center" style={{ color: 'var(--color-text-muted)' }}>
            Keyfile: {v0MigrationDraft.keyfileName}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: WORD_COUNT }).map((_, i) => (
            <div
              key={i}
              className="h-11 rounded-lg border px-2 flex items-center gap-2"
              style={{ borderColor: 'var(--color-surface-700)' }}
            >
              <div
                className="w-8 h-8 rounded-[8px] grid place-items-center text-[12px] font-medium"
                style={{ backgroundColor: 'var(--color-surface-900)' }}
              >
                {i + 1}
              </div>
              <input
                type="text"
                value={v0MigrationDraft.seedWords[i] || ''}
                onChange={e => handleWordChange(i, e.target.value)}
                placeholder="word"
                className="flex-1 bg-transparent outline-none text-[16px]"
              />
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handlePasteAll}
            className="flex-1 h-12 rounded-[14px] text-[16px] leading-[22px] font-medium tracking-[0.01em]"
            style={{ backgroundColor: 'var(--color-surface-900)' }}
          >
            Paste all
          </button>
          <button
            type="button"
            className="flex-1 h-12 rounded-[14px] text-[16px] leading-[22px] font-medium tracking-[0.01em]"
            style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
          >
            Import wallet
          </button>
        </div>

        <div className="pt-1 flex flex-col items-center gap-3 text-center">
          <img src={WalletIconYellow} alt="" className="w-10 h-10" />
          <p className="text-[10px] leading-8 font-medium">Pick a wallet to receive your v0 funds.</p>
        </div>

        <div className="rounded-[14px] p-4" style={{ backgroundColor: 'var(--color-surface-900)' }}>
          <div className="text-[12px] leading-[18px] font-medium">v0 Wallet Balance</div>
          <div className="mt-2 text-[56px] leading-[56px] font-[Lora] tracking-[-0.03em]">
            {v0MigrationDraft.v0BalanceNock.toLocaleString('en-US')}
          </div>
        </div>

        <div className="flex justify-center">
          <div
            className="w-10 h-10 rounded-full grid place-items-center"
            style={{ border: '1px solid var(--color-surface-700)' }}
          >
            <img src={ArrowDownIcon} alt="" className="w-4 h-4" />
          </div>
        </div>

        <div>
          <div className="text-[16px] font-medium mb-2">Receiving wallet</div>
          <button
            type="button"
            onClick={() => setShowWalletPicker(true)}
            className="w-full rounded-[14px] border px-4 py-3 flex items-center justify-between"
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
                <div className="text-[16px] font-medium truncate">
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
            className="rounded-[14px] px-3 py-2 text-[14px] font-medium"
            style={{ backgroundColor: 'var(--color-red-light)', color: 'var(--color-red)' }}
          >
            Insufficient funds to cover transaction fee.
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[16px] font-medium">
            Fee
            <img src={InfoIconAsset} alt="" className="w-4 h-4" />
          </div>
          <div
            className="h-12 rounded-[14px] px-3 py-2 flex items-center gap-2 border"
            style={{ borderColor: 'var(--color-surface-700)' }}
          >
            <span className="text-[16px] font-medium">{v0MigrationDraft.feeNock} NOCK</span>
          </div>
        </div>
      </div>

      <div className="p-3 mt-auto" style={{ borderTop: '1px solid var(--color-divider)' }}>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate('settings')}
            className="flex-1 h-12 rounded-[14px] text-[16px] font-medium"
            style={{ backgroundColor: 'var(--color-surface-900)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={hasInsufficientFunds || !destinationWallet}
            onClick={() => navigate('v0-migration-review')}
            className="flex-1 h-12 rounded-[14px] text-[16px] font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
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
                    setV0MigrationDraft({ destinationWalletIndex: account.index });
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

