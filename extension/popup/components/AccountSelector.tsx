/**
 * AccountSelector - Dropdown for switching accounts and creating new ones
 */

import { useState, useRef } from 'react';
import { useStore } from '../store';
import { send } from '../utils/messaging';
import { truncateAddress } from '../utils/format';
import { useAutoFocus } from '../hooks/useAutoFocus';
import { useClickOutside } from '../hooks/useClickOutside';
import { INTERNAL_METHODS } from '../../shared/constants';
import { Account } from '../../shared/types';
import { formatWalletError } from '../utils/formatWalletError';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { PlusIcon } from './icons/PlusIcon';
import { UploadIcon } from './icons/UploadIcon';
import { EditIcon } from './icons/EditIcon';

export function AccountSelector() {
  const { wallet, syncWallet, navigate } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const editInputRef = useAutoFocus<HTMLInputElement>({
    when: editingIndex !== null,
    select: true,
  });

  // Close dropdown when clicking outside
  useClickOutside(
    dropdownRef,
    () => {
      setIsOpen(false);
      setEditingIndex(null);
    },
    isOpen
  );

  async function handleSwitchAccount(index: number) {
    const result = await send<{ ok?: boolean; account?: Account; error?: string }>(
      INTERNAL_METHODS.SWITCH_ACCOUNT,
      [index]
    );

    if (result?.ok && result.account) {
      const updatedWallet = {
        ...wallet,
        currentAccount: result.account,
        address: result.account.address,
      };
      syncWallet(updatedWallet);
    }

    setIsOpen(false);
  }

  async function handleCreateAccount() {
    const result = await send<{ ok?: boolean; account?: Account; error?: string }>(
      INTERNAL_METHODS.CREATE_ACCOUNT,
      []
    );

    if (result?.ok && result.account) {
      // Add new account to wallet state and switch to it
      const updatedWallet = {
        ...wallet,
        accounts: [...wallet.accounts, result.account],
        currentAccount: result.account,
        address: result.account.address,
      };
      syncWallet(updatedWallet);
    } else if (result?.error) {
      alert(`Failed to create account: ${formatWalletError(result.error)}`);
    }

    setIsOpen(false);
  }

  function handleImportWallet() {
    // Show warning - importing will replace current wallet
    const confirmed = confirm(
      'WARNING: Importing a wallet will replace your current wallet. Make sure you have backed up your current secret phrase. Continue?'
    );
    if (confirmed) {
      navigate('onboarding-import');
    }
    setIsOpen(false);
  }

  function startEditing(account: Account, event: React.MouseEvent) {
    event.stopPropagation(); // Prevent switching accounts
    setEditingIndex(account.index);
    setEditingName(account.name);
  }

  function cancelEditing() {
    setEditingIndex(null);
    setEditingName('');
  }

  async function saveRename() {
    if (editingIndex === null || !editingName.trim()) {
      cancelEditing();
      return;
    }

    const result = await send<{ ok?: boolean; error?: string }>(INTERNAL_METHODS.RENAME_ACCOUNT, [
      editingIndex,
      editingName.trim(),
    ]);

    if (result?.ok) {
      // Update wallet state with new name
      const updatedAccounts = wallet.accounts.map(acc =>
        acc.index === editingIndex ? { ...acc, name: editingName.trim() } : acc
      );
      const updatedCurrentAccount =
        wallet.currentAccount?.index === editingIndex
          ? { ...wallet.currentAccount, name: editingName.trim() }
          : wallet.currentAccount;

      syncWallet({
        ...wallet,
        accounts: updatedAccounts,
        currentAccount: updatedCurrentAccount,
      });
    } else if (result?.error) {
      alert(`Failed to rename account: ${formatWalletError(result.error)}`);
    }

    cancelEditing();
  }

  function handleEditKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
    }
  }

  const currentAccount = wallet.currentAccount;
  const truncatedAddress = truncateAddress(currentAccount?.address);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full" />
          <div className="text-left">
            <div className="font-semibold text-sm">{currentAccount?.name || 'No Account'}</div>
            <div className="text-xs text-gray-400">{truncatedAddress}</div>
          </div>
        </div>
        <div className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          <ChevronDownIcon />
        </div>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 rounded-lg shadow-xl border border-gray-700 overflow-hidden z-50">
          {/* Account list */}
          <div className="max-h-64 overflow-y-auto no-scrollbar">
            {wallet.accounts
              .filter(acc => !acc.hidden)
              .map(account => (
                <div
                  key={account.index}
                  className={`w-full flex items-center gap-2 p-3 ${
                    editingIndex !== account.index ? 'hover:bg-gray-700 cursor-pointer' : ''
                  } transition-colors ${
                    currentAccount?.index === account.index ? 'bg-gray-700' : ''
                  }`}
                  onClick={() =>
                    editingIndex !== account.index && handleSwitchAccount(account.index)
                  }
                >
                  <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex-shrink-0" />
                  <div className="text-left flex-1 min-w-0">
                    {editingIndex === account.index ? (
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={handleEditKeyDown}
                        onBlur={saveRename}
                        className="bg-gray-900 border border-blue-500 rounded px-2 py-1 text-sm w-full focus:outline-none"
                        placeholder="Account name"
                      />
                    ) : (
                      <>
                        <div className="font-semibold text-sm flex items-center gap-2">
                          {account.name}
                          <button
                            onClick={e => startEditing(account, e)}
                            className="text-gray-400 hover:text-white transition-colors"
                          >
                            <EditIcon className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-xs text-gray-400 truncate">
                          {truncateAddress(account.address)}
                        </div>
                      </>
                    )}
                  </div>
                  {currentAccount?.index === account.index && editingIndex !== account.index && (
                    <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
                  )}
                </div>
              ))}
          </div>

          {/* Divider */}
          <div className="border-t border-gray-700" />

          {/* Actions */}
          <button
            onClick={handleCreateAccount}
            className="w-full flex items-center gap-2 p-3 hover:bg-gray-700 transition-colors text-left"
          >
            <PlusIcon />
            <span className="text-sm">Create New Account</span>
          </button>

          <button
            onClick={handleImportWallet}
            className="w-full flex items-center gap-2 p-3 hover:bg-gray-700 transition-colors text-left"
          >
            <UploadIcon />
            <span className="text-sm">Import Wallet</span>
          </button>
        </div>
      )}
    </div>
  );
}
