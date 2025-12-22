import { useState } from 'react';
import { useStore } from '../store';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS } from '../../shared/constants';
import IrisLogo96 from '../assets/iris-logo-96.svg';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { EyeIcon } from '../components/icons/EyeIcon';
import { EyeOffIcon } from '../components/icons/EyeOffIcon';
import { formatWalletError } from '../utils/formatWalletError';

export function KeySettingsPasswordScreen() {
  const { navigate, setOnboardingMnemonic } = useStore();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  function handleBack() {
    navigate('settings');
  }

  async function handleConfirm() {
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await send<{ ok?: boolean; mnemonic?: string; error?: string }>(
        INTERNAL_METHODS.GET_MNEMONIC,
        [password]
      );

      if (result?.error) {
        setError(formatWalletError(result.error));
        setPassword('');
      } else if (result?.mnemonic) {
        // Store mnemonic temporarily for viewing
        setOnboardingMnemonic(result.mnemonic);
        navigate('view-secret-phrase');
      }
    } catch (err) {
      setError('Failed to retrieve secret phrase');
      console.error('Failed to get mnemonic:', err);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col overflow-y-auto"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 min-h-[64px]"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Back"
          className="w-8 h-8 p-2 flex items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2"
          style={{ backgroundColor: 'transparent', color: 'var(--color-text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">Key settings</h1>
        <div className="w-8 h-8" />
      </header>

      <div className="flex flex-1 flex-col justify-between px-4 py-8">
        {/* Content */}
        <div className="flex flex-col items-center gap-3 w-full">
          <img src={IrisLogo96} alt="Iris" className="w-24 h-24" />

          <p
            className="m-0 text-[13px] leading-[18px] tracking-[0.26px] text-center"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Please re-enter your password to see your keys
          </p>
        </div>

        {/* Form */}
        <div className="flex flex-col gap-4 w-full mt-8">
          <div className="flex flex-col gap-[6px] w-full">
            <label className="text-[13px] leading-[18px] tracking-[0.26px] font-medium">
              Password
            </label>

            <div className="relative w-full">
              <input
                type={showPassword ? 'text' : 'password'}
                className="w-full h-[52px] bg-transparent rounded-lg pl-3 pr-10 py-4 outline-none transition-colors text-sm leading-[18px] tracking-[0.14px] font-medium"
                style={{
                  border: '1px solid var(--color-surface-700)',
                  color: 'var(--color-text-primary)',
                }}
                placeholder="Enter your password"
                value={password}
                onChange={e => {
                  setPassword(e.target.value);
                  setError('');
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleConfirm();
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-surface-700)')}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 flex items-center justify-center transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeIcon className="w-4 h-4" />
                ) : (
                  <EyeOffIcon className="w-4 h-4" />
                )}
              </button>
            </div>

            {error && (
              <p className="text-xs" style={{ color: 'var(--color-red)' }}>
                {error}
              </p>
            )}
          </div>

          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className="w-full h-12 rounded-lg text-sm font-medium leading-[18px] tracking-[0.14px] transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
          >
            {isLoading ? 'Verifying...' : 'Confirm'}
          </button>
        </div>

        {/* Warning */}
        <p
          className="m-0 text-[13px] leading-[18px] tracking-[0.26px] text-center"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Warning: Never disclose this key. Anyone with your private keys can steal any assets held
          in your account.
        </p>
      </div>
    </div>
  );
}
