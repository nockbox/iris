/**
 * Router - Screen routing based on navigation state
 */

import { useStore } from './store';

// Screen components
import { LockedScreen } from './screens/system/LockedScreen';
import { StartScreen } from './screens/onboarding/StartScreen';
import { CreateScreen } from './screens/onboarding/CreateScreen';
import { BackupScreen } from './screens/onboarding/BackupScreen';
import { VerifyScreen } from './screens/onboarding/VerifyScreen';
import { SuccessScreen } from './screens/onboarding/SuccessScreen';
import { ImportScreen } from './screens/onboarding/ImportScreen';
import { ImportSuccessScreen } from './screens/onboarding/ImportSuccessScreen';
import { ResumeBackupScreen } from './screens/onboarding/ResumeBackupScreen';
import { HomeScreen } from './screens/main/HomeScreen';
import { SendScreen } from './screens/transactions/SendScreen';
import { SentScreen } from './screens/transactions/SentScreen';
import { ReceiveScreen } from './screens/transactions/ReceiveScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { RecoveryPhraseScreen } from './screens/RecoveryPhraseScreen';

export function Router() {
  const { currentScreen } = useStore();

  // Route to appropriate screen based on current state
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
    case 'onboarding-import-success':
      return <ImportSuccessScreen />;
    case 'onboarding-resume-backup':
      return <ResumeBackupScreen />;

    // Main app
    case 'home':
      return <HomeScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'recovery-phrase':
      return <RecoveryPhraseScreen />;

    // Transactions
    case 'send':
      return <SendScreen />;
    case 'sent':
      return <SentScreen />;
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
