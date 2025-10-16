/**
 * Settings Screen - Wallet settings and information
 */

import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { ScreenContainer } from '../components/ScreenContainer';
import { send } from '../utils/messaging';
import { truncateAddress } from '../utils/format';
import { INTERNAL_METHODS } from '../../shared/constants';
import manifest from '../../manifest.json';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { WalletIcon } from '../components/icons/WalletIcon';
import { ShieldIcon } from '../components/icons/ShieldIcon';
import { EyeIcon } from '../components/icons/EyeIcon';
import { LockIcon } from '../components/icons/LockIcon';
import { InfoIcon } from '../components/icons/InfoIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';

const AUTO_LOCK_OPTIONS = [
  { value: 0.1, label: '6 seconds (testing)' },
  { value: 1, label: '1 minute' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '60 minutes' },
];

export function SettingsScreen() {
  const { wallet, navigate, syncWallet } = useStore();
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);
  const [extensionId, setExtensionId] = useState<string>('');

  const address = wallet.currentAccount?.address || '';
  const truncatedAddress = truncateAddress(address);

  // Get extension ID and current auto-lock setting on mount
  useEffect(() => {
    if (chrome?.runtime?.id) {
      setExtensionId(chrome.runtime.id);
    }

    // Load current auto-lock setting
    (async () => {
      const result = await send<{ minutes?: number }>(INTERNAL_METHODS.GET_AUTO_LOCK);
      if (result?.minutes) {
        setAutoLockMinutes(result.minutes);
      }
    })();
  }, []);

  async function handleAutoLockChange(minutes: number) {
    setAutoLockMinutes(minutes);
    await send(INTERNAL_METHODS.SET_AUTO_LOCK, [minutes]);
  }

  async function handleLockNow() {
    await send(INTERNAL_METHODS.LOCK, []);
    syncWallet({ ...wallet, locked: true });
    navigate('locked');
  }

  function handleViewRecoveryPhrase() {
    navigate('recovery-phrase');
  }

  return (
    <ScreenContainer className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('home')}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeftIcon />
        </button>
        <h2 className="text-xl font-semibold">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-6">
        {/* Wallet Information Section */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <WalletIcon className="w-5 h-5 text-gray-400" />
            <h3 className="text-lg font-medium">Wallet Information</h3>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Address</span>
              <span className="text-sm font-mono">{truncatedAddress}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Balance</span>
              <span className="text-sm">0.00 NOCK</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Network</span>
              <span className="text-sm">Nockchain Mainnet</span>
            </div>
          </div>
        </section>

        {/* Security Section */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <ShieldIcon className="w-5 h-5 text-gray-400" />
            <h3 className="text-lg font-medium">Security</h3>
          </div>

          {/* View Recovery Phrase */}
          <button
            onClick={handleViewRecoveryPhrase}
            className="w-full bg-gray-800 rounded-lg p-4 mb-3 flex items-center gap-3 hover:bg-gray-700 transition-colors"
          >
            <EyeIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <div className="flex-1 text-left">
              <div className="font-medium">View Recovery Phrase</div>
              <div className="text-sm text-gray-400">Show your 24-word backup</div>
            </div>
            <ChevronRightIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
          </button>

          {/* Auto-lock Timer */}
          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <LockIcon className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium mb-1">Auto-lock Timer</div>
                <div className="text-sm text-gray-400 mb-3">Lock wallet after inactivity</div>

                {/* Dropdown */}
                <select
                  value={autoLockMinutes}
                  onChange={(e) => handleAutoLockChange(Number(e.target.value))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 mb-3"
                >
                  {AUTO_LOCK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                {/* Lock Now Button */}
                <button
                  onClick={handleLockNow}
                  className="w-full bg-transparent border border-gray-600 hover:border-gray-500 text-white rounded-lg py-2 px-4 flex items-center justify-center gap-2 transition-colors"
                >
                  <LockIcon className="w-4 h-4" />
                  Lock Now
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* About Section */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <InfoIcon className="w-5 h-5 text-gray-400" />
            <h3 className="text-lg font-medium">About</h3>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Version</span>
              <span className="text-sm">{manifest.version}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-gray-400 text-sm">Extension ID</span>
              <span className="text-xs font-mono text-gray-300 break-all">{extensionId || 'Loading...'}</span>
            </div>
          </div>
        </section>

        {/* Links Section */}
        <section className="pb-4">
          <button className="w-full text-left py-3 text-gray-300 hover:text-white transition-colors">
            Terms of Service
          </button>
          <button className="w-full text-left py-3 text-gray-300 hover:text-white transition-colors">
            Privacy Policy
          </button>
          <button className="w-full text-left py-3 text-gray-300 hover:text-white transition-colors">
            Support
          </button>
        </section>
      </div>
    </ScreenContainer>
  );
}
