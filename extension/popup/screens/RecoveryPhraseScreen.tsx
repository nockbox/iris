/**
 * Recovery Phrase Screen - View wallet's secret phrase
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
      <div
        className="w-[357px] h-[600px] flex flex-col p-4"
        style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate('settings')}
            className="transition-colors"
            style={{ color: 'var(--color-text-primary)' }}
          >
            <ChevronLeftIcon />
          </button>
          <h2 className="text-xl font-semibold">View Secret Phrase</h2>
        </div>

        <div
          className="mb-6 p-3 rounded-lg"
          style={{ backgroundColor: 'var(--color-red-light)', color: 'var(--color-red)' }}
        >
          <strong>Warning:</strong> Never share your secret phrase with anyone. Anyone with access
          to this phrase can access your funds.
        </div>

        <p className="text-sm mb-4" style={{ color: 'var(--color-text-muted)' }}>
          Enter your password to reveal your 24-word secret phrase.
        </p>

        <input
          type="password"
          value={password}
          onChange={e => {
            setPassword(e.target.value);
            setError('');
          }}
          placeholder="Password"
          className="my-2 w-full rounded-lg px-4 py-3 outline-none"
          style={{
            border: '1px solid var(--color-surface-700)',
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text-primary)',
          }}
          onKeyDown={e => e.key === 'Enter' && handleReveal()}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-surface-700)')}
          autoFocus
        />

        {error && (
          <div
            className="my-2 p-3 rounded-lg"
            style={{ backgroundColor: 'var(--color-red-light)', color: 'var(--color-red)' }}
          >
            {error}
          </div>
        )}

        <button
          onClick={handleReveal}
          className="my-2 w-full rounded-lg px-5 py-3.5 text-sm font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
        >
          <EyeIcon className="w-4 h-4 inline mr-2" />
          Reveal Secret Phrase
        </button>

        <button
          onClick={() => navigate('settings')}
          className="my-2 w-full rounded-lg px-5 py-3.5 text-sm font-medium transition-colors"
          style={{ backgroundColor: 'var(--color-surface-800)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-700)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
        >
          Cancel
        </button>
      </div>
    );
  }

  // Secret phrase display view
  return (
    <div
      className="w-[357px] h-[600px] flex flex-col p-4"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('settings')}
          className="transition-colors"
          style={{ color: 'var(--color-text-primary)' }}
        >
          <ChevronLeftIcon />
        </button>
        <h2 className="text-xl font-semibold">Secret Phrase</h2>
      </div>

      <div
        className="mb-4 p-3 rounded-lg"
        style={{ backgroundColor: 'var(--color-red-light)', color: 'var(--color-red)' }}
      >
        <strong>Warning:</strong> Write down these 24 words in order and store them safely. Never
        share them with anyone.
      </div>

      {/* Words grid */}
      <div className="flex-1 overflow-y-auto mb-4">
        <div className="grid grid-cols-2 gap-2">
          {words.map((word, index) => (
            <div
              key={index}
              className="rounded p-2 flex items-center gap-2"
              style={{ backgroundColor: 'var(--color-surface-800)' }}
            >
              <span className="text-xs w-6" style={{ color: 'var(--color-text-muted)' }}>
                {index + 1}.
              </span>
              <span className="text-sm font-mono">{word}</span>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => navigate('settings')}
        className="w-full rounded-lg px-5 py-3.5 text-sm font-medium transition-opacity hover:opacity-90"
        style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
      >
        Done
      </button>
    </div>
  );
}
