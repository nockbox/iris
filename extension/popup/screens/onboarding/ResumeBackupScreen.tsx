/**
 * Resume Backup Screen
 * Shown when user closed popup during onboarding and needs to complete backup
 */

import { useState } from 'react';
import { useStore } from '../../store';
import { send } from '../../utils/messaging';
import { INTERNAL_METHODS, ERROR_CODES } from '../../../shared/constants';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Alert } from '../../components/Alert';

export function ResumeBackupScreen() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { navigate, setOnboardingMnemonic } = useStore();

  async function handleContinue() {
    setError('');

    if (!password) {
      setError('Please enter your password');
      return;
    }

    // Retrieve mnemonic using password
    const result = await send<{
      ok?: boolean;
      mnemonic?: string;
      error?: string;
    }>(INTERNAL_METHODS.GET_MNEMONIC, [password]);

    if (result?.error) {
      if (result.error === ERROR_CODES.BAD_PASSWORD) {
        setError('Incorrect password');
      } else {
        setError(`Error: ${result.error}`);
      }
      setPassword(''); // Clear password on error
    } else {
      // Store mnemonic in Zustand for backup flow
      setOnboardingMnemonic(result.mnemonic || '');
      setPassword('');
      // Navigate to backup screen
      navigate('onboarding-backup');
    }
  }

  return (
    <ScreenContainer>
      <h2 className="text-xl font-semibold mb-4">Complete Your Backup</h2>

      <p className="text-sm text-gray-400 mb-6">
        You need to backup your recovery phrase to secure your wallet. Enter your password to continue.
      </p>

      <Alert type="warning" className="mb-4">
        <strong>Important:</strong> Without backing up your recovery phrase, you risk losing access to your wallet if you forget your password.
      </Alert>

      <input
        type="password"
        placeholder="Password"
        className="input-field my-2"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setError('');
        }}
        onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
        autoFocus
      />

      {error && (
        <Alert type="error" className="my-2">
          {error}
        </Alert>
      )}

      <button onClick={handleContinue} className="btn-primary my-2">
        Continue Backup
      </button>
    </ScreenContainer>
  );
}
