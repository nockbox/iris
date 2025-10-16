/**
 * Onboarding Success Screen - Wallet created successfully
 */

import { useEffect } from 'react';
import { useStore } from '../../store';
import { markOnboardingComplete } from '../../../shared/onboarding';
import { ScreenContainer } from '../../components/ScreenContainer';
import { CheckIcon } from '../../components/icons/CheckIcon';
import { CopyIcon } from '../../components/icons/CopyIcon';
import { ChevronLeftIcon } from '../../components/icons/ChevronLeftIcon';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

export function SuccessScreen() {
  const { navigate, wallet, goBack } = useStore();
  const { copied, copyToClipboard } = useCopyToClipboard();

  // Mark onboarding as complete when user reaches this screen
  useEffect(() => {
    markOnboardingComplete();
  }, []);

  return (
    <ScreenContainer className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={goBack}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeftIcon />
        </button>
        <h2 className="text-xl font-semibold">Wallet Created!</h2>
      </div>

      {/* Success icon */}
      <div className="flex justify-center mb-6">
        <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center">
          <CheckIcon className="w-12 h-12 text-green-500" />
        </div>
      </div>

      {/* Success message */}
      <h3 className="text-2xl font-semibold text-center mb-2">
        Your wallet is ready!
      </h3>
      <p className="text-gray-400 text-center mb-8">
        Welcome to Nockchain
      </p>

      {/* Wallet address section */}
      <div className="bg-gray-800 rounded-lg p-4 mb-6">
        <p className="text-sm text-gray-400 mb-2">Your wallet address</p>
        <div className="flex items-start gap-3">
          <p className="flex-1 text-sm font-mono break-all leading-relaxed">
            {wallet.address || 'Loading...'}
          </p>
          <button
            onClick={() => copyToClipboard(wallet.address || '')}
            className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
            title="Copy address"
          >
            <CopyIcon />
          </button>
        </div>
        {copied && (
          <p className="text-xs text-green-500 mt-2">Copied to clipboard!</p>
        )}
      </div>

      {/* Action button */}
      <button onClick={() => navigate('home')} className="btn-primary">
        Start Using Wallet
      </button>
    </ScreenContainer>
  );
}
