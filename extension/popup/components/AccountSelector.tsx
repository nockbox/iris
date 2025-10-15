/**
 * AccountSelector - Dropdown for switching accounts and creating new ones
 */

import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS } from '../../shared/constants';
import { Account } from '../../shared/types';

export function AccountSelector() {
  const { wallet, syncWallet } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

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

  function handleCreateAccount() {
    // TODO: Implement create account flow (requires mnemonic in memory)
    alert('Create account feature coming soon!');
    setIsOpen(false);
  }

  function handleImportWallet() {
    // TODO: Navigate to import wallet screen
    alert('Import wallet feature coming soon!');
    setIsOpen(false);
  }

  const currentAccount = wallet.currentAccount;
  const truncatedAddress = currentAccount?.address
    ? `${currentAccount.address.slice(0, 6)}...${currentAccount.address.slice(-6)}`
    : '';

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
        <svg
          className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 rounded-lg shadow-xl border border-gray-700 overflow-hidden z-50">
          {/* Account list */}
          <div className="max-h-64 overflow-y-auto">
            {wallet.accounts.map((account) => (
              <button
                key={account.index}
                onClick={() => handleSwitchAccount(account.index)}
                className={`w-full flex items-center gap-2 p-3 hover:bg-gray-700 transition-colors ${
                  currentAccount?.index === account.index ? 'bg-gray-700' : ''
                }`}
              >
                <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex-shrink-0" />
                <div className="text-left flex-1 min-w-0">
                  <div className="font-semibold text-sm">{account.name}</div>
                  <div className="text-xs text-gray-400 truncate">
                    {`${account.address.slice(0, 6)}...${account.address.slice(-6)}`}
                  </div>
                </div>
                {currentAccount?.index === account.index && (
                  <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
                )}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-gray-700" />

          {/* Actions */}
          <button
            onClick={handleCreateAccount}
            className="w-full flex items-center gap-2 p-3 hover:bg-gray-700 transition-colors text-left"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm">Create New Wallet</span>
          </button>

          <button
            onClick={handleImportWallet}
            className="w-full flex items-center gap-2 p-3 hover:bg-gray-700 transition-colors text-left"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            <span className="text-sm">Import Wallet</span>
          </button>
        </div>
      )}
    </div>
  );
}
