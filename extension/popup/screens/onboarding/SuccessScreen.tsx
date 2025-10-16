/**
 * Onboarding Success Screen - Wallet created successfully
 */

import { useEffect } from 'react';
import { useStore } from '../../store';
import { markOnboardingComplete } from '../../../shared/onboarding';
import { ScreenContainer } from '../../components/ScreenContainer';

export function SuccessScreen() {
  const { navigate } = useStore();

  // Mark onboarding as complete when user reaches this screen
  useEffect(() => {
    markOnboardingComplete();
  }, []);

  return (
    <ScreenContainer>
      <h2 className="text-xl font-semibold mb-4">Wallet Created!</h2>
      <p className="text-sm text-gray-400 mb-6">
        Your wallet has been created successfully
      </p>
      <button onClick={() => navigate('home')} className="btn-primary">
        Get Started
      </button>
    </ScreenContainer>
  );
}
