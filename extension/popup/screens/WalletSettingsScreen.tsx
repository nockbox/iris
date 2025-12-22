import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS } from '../../shared/constants';
import { formatWalletError } from '../utils/formatWalletError';
import { AccountIcon } from '../components/AccountIcon';
import { ConfirmModal } from '../components/ConfirmModal';
import { CloseIcon } from '../components/icons/CloseIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import UserAccountIcon from '../assets/user-account-icon.svg';
import ThemeIcon from '../assets/theme-icon.svg';
import CopyIcon from '../assets/copy-icon.svg';
import CheckmarkIcon from '../assets/checkmark-pencil-icon.svg';
import PencilEditIcon from '../assets/pencil-edit-icon.svg';
import SettingsGearIcon from '../assets/settings-gear-icon.svg';

export function WalletSettingsScreen() {
  const { navigate, wallet, syncWallet } = useStore();

  // Get current account from vault
  const currentAccount = wallet.currentAccount || wallet.accounts[0];
  const walletName = currentAccount?.name || 'Wallet';
  const walletAddress = currentAccount?.address || '';

  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(walletName);
  const [copySuccess, setCopySuccess] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showLastAccountError, setShowLastAccountError] = useState(false);

  // Format creation date
  const walletCreatedDate = currentAccount?.createdAt
    ? new Date(currentAccount.createdAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Unknown';

  // Keep editedName in sync with current account name
  useEffect(() => {
    setEditedName(walletName);
  }, [walletName]);

  function handleClose() {
    navigate('home');
  }
  function handleStyling() {
    navigate('wallet-styling');
  }
  function handleEditName() {
    setIsEditingName(true);
    setEditedName(walletName);
  }

  async function handleSaveName() {
    if (!editedName.trim() || !currentAccount) {
      setIsEditingName(false);
      return;
    }

    // Call the vault to rename the account
    const result = await send<{ ok?: boolean; error?: string }>(INTERNAL_METHODS.RENAME_ACCOUNT, [
      currentAccount.index,
      editedName.trim(),
    ]);

    if (result?.ok) {
      // Update wallet state with new name
      const updatedAccounts = wallet.accounts.map(acc =>
        acc.index === currentAccount.index ? { ...acc, name: editedName.trim() } : acc
      );
      const updatedCurrentAccount = { ...currentAccount, name: editedName.trim() };

      syncWallet({
        ...wallet,
        accounts: updatedAccounts,
        currentAccount: updatedCurrentAccount,
      });

      setIsEditingName(false);
    } else if (result?.error) {
      alert(`Failed to rename account: ${formatWalletError(result.error)}`);
      setIsEditingName(false);
    }
  }
  function handleNameInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setEditedName(e.target.value);
  }
  function handleNameInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSaveName();
    if (e.key === 'Escape') {
      setIsEditingName(false);
      setEditedName(walletName);
    }
  }
  async function handleCopyAddress() {
    if (!walletAddress) return;

    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  }
  function handleRemoveWallet() {
    setShowRemoveConfirm(true);
  }

  async function confirmRemoveWallet() {
    if (!currentAccount) return;

    const result = await send<{ ok?: boolean; switchedTo?: number; error?: string }>(
      INTERNAL_METHODS.HIDE_ACCOUNT,
      [currentAccount.index]
    );

    if (result?.ok) {
      // Update wallet state - filter out hidden account
      const updatedAccounts = wallet.accounts.map(acc =>
        acc.index === currentAccount.index ? { ...acc, hidden: true } : acc
      );

      // If we switched accounts, update the current account
      let updatedCurrentAccount = currentAccount;
      if (result.switchedTo !== undefined) {
        updatedCurrentAccount =
          updatedAccounts.find(acc => acc.index === result.switchedTo) || currentAccount;
      }

      syncWallet({
        ...wallet,
        accounts: updatedAccounts,
        currentAccount: updatedCurrentAccount,
      });

      // Close settings and go back to home
      setShowRemoveConfirm(false);
      navigate('home');
    } else if (result?.error) {
      setShowRemoveConfirm(false);
      if (result.error === 'CANNOT_HIDE_LAST_ACCOUNT') {
        setShowLastAccountError(true);
      } else {
        alert(`Failed to hide account: ${formatWalletError(result.error)}`);
      }
    }
  }

  function cancelRemoveWallet() {
    setShowRemoveConfirm(false);
  }

  const addressStart = walletAddress.slice(0, 6);
  const addressMiddle = walletAddress.slice(6, -5);
  const addressEnd = walletAddress.slice(-5);

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 min-h-[64px]"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <div className="w-8 h-8 flex items-center justify-center">
          <AccountIcon
            styleId={currentAccount?.iconStyleId}
            color={currentAccount?.iconColor}
            className="w-6 h-6"
          />
        </div>

        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">{walletName}</h1>

        <button
          type="button"
          onClick={handleClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2"
          style={{ color: 'var(--color-text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </header>

      {/* Content */}
      <div
        className="flex flex-col justify-between h-[536px]"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <div className="flex flex-col gap-4 px-4 py-2">
          {/* Settings Options */}
          <div className="flex flex-col gap-2">
            {/* Account Name */}
            <div
              className="flex items-center justify-between p-2 rounded-lg transition-colors"
              onMouseEnter={e =>
                (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')
              }
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <div className="flex items-center gap-2.5 flex-1">
                <div
                  className="w-8 h-8 flex items-center justify-center rounded-lg"
                  style={{ backgroundColor: 'var(--color-surface-800)' }}
                >
                  <img src={UserAccountIcon} alt="Account" className="w-5 h-5" />
                </div>
                <div className="text-sm font-medium leading-[18px] tracking-[0.14px]">
                  Wallet name
                </div>
              </div>

              {isEditingName ? (
                <div
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                  style={{ border: '1px solid var(--color-divider)' }}
                >
                  <input
                    type="text"
                    value={editedName}
                    onChange={handleNameInputChange}
                    onKeyDown={handleNameInputKeyDown}
                    autoFocus
                    maxLength={30}
                    className="w-[100px] bg-transparent outline-none text-sm font-medium leading-[18px] tracking-[0.14px]"
                    style={{ color: 'var(--color-text-primary)' }}
                    placeholder="Wallet name"
                  />
                  <button
                    type="button"
                    onClick={handleSaveName}
                    className="p-1 rounded transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2"
                    aria-label="Save name"
                  >
                    <img src={CheckmarkIcon} alt="" className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleEditName}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors focus:outline-none focus-visible:ring-2"
                  style={{ backgroundColor: 'var(--color-surface-800)' }}
                  onMouseEnter={e =>
                    (e.currentTarget.style.backgroundColor = 'var(--color-surface-700)')
                  }
                  onMouseLeave={e =>
                    (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')
                  }
                >
                  <span
                    className="text-sm font-medium leading-[18px] tracking-[0.14px] whitespace-nowrap"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {walletName}
                  </span>
                  <img src={PencilEditIcon} alt="" className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Styling */}
            <button
              type="button"
              onClick={handleStyling}
              className="flex items-center justify-between p-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2"
              onMouseEnter={e =>
                (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')
              }
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <div className="flex items-center gap-2.5 flex-1">
                <div
                  className="w-8 h-8 flex items-center justify-center rounded-lg"
                  style={{ backgroundColor: 'var(--color-surface-800)' }}
                >
                  <AccountIcon styleId={1} color="var(--color-text-muted)" className="w-5 h-5" />
                </div>
                <div className="text-sm font-medium leading-[18px] tracking-[0.14px]">Styling</div>
              </div>
              <div className="p-1">
                <ChevronRightIcon className="w-4 h-4" />
              </div>
            </button>
          </div>

          {/* Address Box */}
          <div
            className="flex flex-col items-center gap-5 px-3 pt-5 pb-3 rounded-lg"
            style={{ backgroundColor: 'var(--color-surface-800)' }}
          >
            <div
              className="text-sm font-medium leading-[18px] tracking-[0.14px] text-center break-words w-full"
              style={{ wordBreak: 'break-all' }}
            >
              <span style={{ color: 'var(--color-text-primary)' }}>{addressStart}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>{addressMiddle}</span>
              <span style={{ color: 'var(--color-text-primary)' }}>{addressEnd}</span>
            </div>
            <button
              type="button"
              onClick={handleCopyAddress}
              className="inline-flex items-center justify-center gap-[6px] py-[7px] pl-3 pr-4 bg-transparent rounded-full text-sm font-medium leading-[18px] tracking-[0.14px] transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2"
              style={{
                border: '1px solid var(--color-text-primary)',
                color: 'var(--color-text-primary)',
              }}
            >
              <img src={CopyIcon} alt="" className="w-4 h-4 shrink-0" />
              {copySuccess ? 'Copied!' : 'Copy address'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-4 py-3">
          <div
            className="flex items-center justify-between gap-2 px-2 rounded-lg"
            style={{ backgroundColor: 'var(--color-bg)' }}
          >
            <div
              className="text-[10px] leading-4 tracking-[0.24px] flex-1"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Wallet created on {walletCreatedDate}
            </div>
            <div className="flex items-center justify-center rounded-lg py-2 px-3">
              <AccountIcon styleId={1} color="var(--color-text-muted)" className="w-4 h-4" />
            </div>
          </div>

          <button
            type="button"
            onClick={handleRemoveWallet}
            className="flex items-center justify-center px-5 py-[15px] rounded-lg transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2"
            style={{ backgroundColor: 'var(--color-red-light)' }}
          >
            <div
              className="text-sm font-medium leading-[18px] tracking-[0.14px] text-center"
              style={{ color: 'var(--color-red)' }}
            >
              Remove wallet
            </div>
          </button>
        </div>
      </div>

      {/* Remove Confirmation Modal */}
      <ConfirmModal
        isOpen={showRemoveConfirm}
        title="Are you sure?"
        message={`This will remove "${walletName}" from your wallet. The account and its funds will remain on the blockchain, but no longer be visible in this wallet.`}
        confirmText="Confirm"
        cancelText="Cancel"
        onConfirm={confirmRemoveWallet}
        onCancel={cancelRemoveWallet}
        variant="danger"
      />

      {/* Last Account Error Modal */}
      <ConfirmModal
        isOpen={showLastAccountError}
        title="Cannot Remove Wallet"
        message="You cannot remove your last visible account. You must have at least one account in your wallet."
        confirmText="OK"
        onConfirm={() => setShowLastAccountError(false)}
        onCancel={() => setShowLastAccountError(false)}
      />
    </div>
  );
}
