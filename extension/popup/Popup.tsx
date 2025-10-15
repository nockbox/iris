/**
 * Popup UI: Main router component
 */

import { useEffect } from 'react';
import { useStore } from './store';

// Screen components
import { LockedScreen } from './screens/system/LockedScreen';
import { StartScreen } from './screens/onboarding/StartScreen';
import { CreateScreen } from './screens/onboarding/CreateScreen';
import { BackupScreen } from './screens/onboarding/BackupScreen';
import { VerifyScreen } from './screens/onboarding/VerifyScreen';
import { SuccessScreen } from './screens/onboarding/SuccessScreen';
import { ImportScreen } from './screens/onboarding/ImportScreen';
import { HomeScreen } from './screens/main/HomeScreen';
import { SendScreen } from './screens/transactions/SendScreen';
import { ReceiveScreen } from './screens/transactions/ReceiveScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export function Popup() {
  const { currentScreen, initialize } = useStore();

  // Initialize app on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Simple router - render screen based on current state
  switch (currentScreen) {
    // Onboarding
    case 'onboarding-start':
      return <StartScreen />;
    case 'onboarding-create':
      return <CreateScreen />;
    case 'onboarding-backup':
      return <BackupScreen />;
    case 'onboarding-verify':
      return <VerifyScreen />;
    case 'onboarding-success':
      return <SuccessScreen />;
    case 'onboarding-import':
      return <ImportScreen />;

    // Main app
    case 'home':
      return <HomeScreen />;
    case 'settings':
      return <SettingsScreen />;

    // Transactions
    case 'send':
      return <SendScreen />;
    case 'receive':
      return <ReceiveScreen />;

    // System
    case 'locked':
      return <LockedScreen />;

    // Default fallback
    default:
      return <div>Unknown screen: {currentScreen}</div>;
  }
}
