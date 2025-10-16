/**
 * Recovery Phrase Screen - View wallet's secret recovery phrase
 * Requires password confirmation for security
 */

import { useState } from 'react';
import { useStore } from '../store';
import { ScreenContainer } from '../components/ScreenContainer';
import { Alert } from '../components/Alert';
import { PasswordInput } from '../components/PasswordInput';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS, ERROR_CODES } from '../../shared/constants';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { EyeIcon } from '../components/icons/EyeIcon';

export function RecoveryPhraseScreen() {
  const { navigate } = useStore();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);

  async function handleReveal() {
    setError('');

    if (!password) {
      setError('Please enter your password');
      return;
    }

    const result = await send<{ ok?: boolean; mnemonic?: string; error?: string }>(
      INTERNAL_METHODS.GET_MNEMONIC,
      [password]
    );

    if (result?.error) {
      if (result.error === ERROR_CODES.BAD_PASSWORD) {
        setError('Incorrect password');
      } else {
        setError(`Error: ${result.error}`);
      }
      setPassword('');
    } else {
      setMnemonic(result.mnemonic || '');
      setIsRevealed(true);
    }
  }

  const words = mnemonic ? mnemonic.split(' ') : [];

  // Password confirmation view
  if (!isRevealed) {
    return (
      <ScreenContainer className="flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate('settings')}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <ChevronLeftIcon />
          </button>
          <h2 className="text-xl font-semibold">View Recovery Phrase</h2>
        </div>

        <Alert type="warning" className="mb-6">
          <strong>Warning:</strong> Never share your recovery phrase with anyone. Anyone with
          access to this phrase can access your funds.
        </Alert>

        <p className="text-sm text-gray-400 mb-4">
          Enter your password to reveal your 24-word secret recovery phrase.
        </p>

        <PasswordInput
          value={password}
          onChange={(value) => {
            setPassword(value);
            setError('');
          }}
          placeholder="Password"
          className="my-2"
          onKeyDown={(e) => e.key === 'Enter' && handleReveal()}
          autoFocus
        />

        {error && (
          <Alert type="error" className="my-2">
            {error}
          </Alert>
        )}

        <button onClick={handleReveal} className="btn-primary my-2">
          <EyeIcon className="w-4 h-4 inline mr-2" />
          Reveal Recovery Phrase
        </button>

        <button onClick={() => navigate('settings')} className="btn-secondary my-2">
          Cancel
        </button>
      </ScreenContainer>
    );
  }

  // Recovery phrase display view
  return (
    <ScreenContainer className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('settings')}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeftIcon />
        </button>
        <h2 className="text-xl font-semibold">Secret Recovery Phrase</h2>
      </div>

      <Alert type="warning" className="mb-4">
        <strong>Warning:</strong> Write down these 24 words in order and store them safely.
        Never share them with anyone.
      </Alert>

      {/* Words grid */}
      <div className="flex-1 overflow-y-auto no-scrollbar mb-4">
        <div className="grid grid-cols-2 gap-2">
          {words.map((word, index) => (
            <div
              key={index}
              className="bg-gray-800 rounded p-2 flex items-center gap-2"
            >
              <span className="text-xs text-gray-500 w-6">{index + 1}.</span>
              <span className="text-sm font-mono">{word}</span>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => navigate('settings')}
        className="btn-primary"
      >
        Done
      </button>
    </ScreenContainer>
  );
}
