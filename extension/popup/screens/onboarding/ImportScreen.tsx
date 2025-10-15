/**
 * Onboarding Import Screen - Import wallet from mnemonic
 */

import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Alert } from '../../components/Alert';
import { INTERNAL_METHODS, UI_CONSTANTS, ERROR_CODES } from '../../../shared/constants';
import { send } from '../../utils/messaging';

export function ImportScreen() {
  const { navigate, syncWallet, setOnboardingMnemonic } = useStore();
  const [words, setWords] = useState<string[]>(Array(UI_CONSTANTS.MNEMONIC_WORD_COUNT).fill(''));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<'mnemonic' | 'password'>('mnemonic');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Focus first input on mount
    inputRefs.current[0]?.focus();
  }, []);

  function handleWordChange(index: number, value: string) {
    const trimmedValue = value.trim().toLowerCase();
    const newWords = [...words];
    newWords[index] = trimmedValue;
    setWords(newWords);
    setError('');

    // Auto-advance to next field on space or completed word
    if (value.endsWith(' ') || (trimmedValue && value.length > 2)) {
      const nextIndex = index + 1;
      if (nextIndex < UI_CONSTANTS.MNEMONIC_WORD_COUNT) {
        inputRefs.current[nextIndex]?.focus();
      }
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    // Backspace on empty field goes to previous
    if (e.key === 'Backspace' && !words[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    // Enter advances to next field
    if (e.key === 'Enter') {
      e.preventDefault();
      const nextIndex = index + 1;
      if (nextIndex < UI_CONSTANTS.MNEMONIC_WORD_COUNT) {
        inputRefs.current[nextIndex]?.focus();
      } else {
        handleContinue();
      }
    }
  }

  function handleContinue() {
    const mnemonic = words.join(' ').trim();

    if (words.some(w => !w)) {
      setError('Please enter all 24 words');
      return;
    }

    // Store mnemonic and move to password setup
    setOnboardingMnemonic(mnemonic);
    setStep('password');
  }

  async function handleImport() {
    const mnemonic = words.join(' ').trim();

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

    // Import wallet (setup with existing mnemonic)
    const result = await send<{ ok?: boolean; address?: string; mnemonic?: string; error?: string }>(
      INTERNAL_METHODS.SETUP,
      [password, mnemonic]
    );

    if (result?.error) {
      if (result.error === ERROR_CODES.INVALID_MNEMONIC) {
        setError('Invalid recovery phrase. Please check your words and try again.');
      } else {
        setError(`Error: ${result.error}`);
      }
    } else {
      // Successfully imported
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
      });
      setOnboardingMnemonic(null);
      navigate('home');
    }
  }

  if (step === 'password') {
    return (
      <ScreenContainer>
        <h2 className="text-xl font-semibold mb-4">Encrypt Your Wallet</h2>
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
            setError('');
          }}
        />

        <input
          type="password"
          placeholder="Confirm Password"
          className="input-field my-2"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleImport()}
        />

        {error && (
          <Alert type="error" className="my-2">
            {error}
          </Alert>
        )}

        <button onClick={handleImport} className="btn-primary my-2">
          Import Wallet
        </button>

        <button onClick={() => setStep('mnemonic')} className="btn-secondary my-2">
          Back
        </button>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="flex flex-col">
      <h2 className="text-xl font-semibold mb-2">Import Wallet</h2>
      <p className="text-sm text-gray-400 mb-4">
        Enter your 24-word recovery phrase
      </p>

      {/* 24-word grid */}
      <div className="flex-1 overflow-y-auto no-scrollbar mb-4">
        <div className="grid grid-cols-2 gap-2">
          {words.map((word, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-6">{index + 1}.</span>
              <input
                ref={(el) => { inputRefs.current[index] = el; }}
                type="text"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                value={word}
                onChange={(e) => handleWordChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                placeholder={`Word ${index + 1}`}
                autoComplete="off"
                spellCheck="false"
              />
            </div>
          ))}
        </div>
      </div>

      {error && (
        <Alert type="error" className="mb-2">
          {error}
        </Alert>
      )}

      <button
        onClick={handleContinue}
        disabled={words.some(w => !w)}
        className="btn-primary my-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue
      </button>

      <button onClick={() => navigate('onboarding-start')} className="btn-secondary my-2">
        Back
      </button>
    </ScreenContainer>
  );
}
