/**
 * Onboarding Create Screen - Set password and create wallet
 */

import { useState } from 'react';
import { INTERNAL_METHODS, UI_CONSTANTS } from '../../../shared/constants';
import { useStore } from '../../store';
import { send } from '../../utils/messaging';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Alert } from '../../components/Alert';

export function CreateScreen() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const { navigate, syncWallet, setOnboardingMnemonic } = useStore();

  async function handleCreate() {
    // Clear previous errors
    setError('');

    // Validate password
    if (!password) {
      setError('Please enter a password');
      return;
    }

    if (password.length < UI_CONSTANTS.MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${UI_CONSTANTS.MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Create wallet
    const result = await send<{ ok?: boolean; address?: string; mnemonic?: string; error?: string }>(
      INTERNAL_METHODS.SETUP,
      [password]
    );

    if (result?.error) {
      setError(`Error: ${result.error}`);
    } else {
      // Store mnemonic temporarily for backup/verification flow
      setOnboardingMnemonic(result.mnemonic || '');
      // After setup, we have the first account (Account 1)
      const firstAccount = {
        name: "Account 1",
        address: result.address || "",
        index: 0,
      };
      syncWallet({
        locked: false,
        address: result.address || null,
        accounts: [firstAccount],
        currentAccount: firstAccount,
        balance: 0, // New wallet starts with 0 balance
      });
      navigate('onboarding-backup');
    }
  }

  return (
    <ScreenContainer>
      <h2 className="text-xl font-semibold mb-4">Create Wallet</h2>

      <p className="text-sm text-gray-400 mb-6">
        Choose a strong password to encrypt your wallet
      </p>

      <input
        type="password"
        placeholder="Password"
        className="input-field my-2"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setError(''); // Clear error on input
        }}
      />

      <input
        type="password"
        placeholder="Confirm Password"
        className="input-field my-2"
        value={confirmPassword}
        onChange={(e) => {
          setConfirmPassword(e.target.value);
          setError(''); // Clear error on input
        }}
        onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
      />

      {error && (
        <Alert type="error" className="my-2">
          {error}
        </Alert>
      )}

      <button onClick={handleCreate} className="btn-primary my-2">
        Create Wallet
      </button>

      <button onClick={() => navigate('onboarding-start')} className="btn-secondary my-2">
        Back
      </button>
    </ScreenContainer>
  );
}
