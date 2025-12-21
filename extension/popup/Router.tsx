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
import { HomeScreen } from './screens/HomeScreen';
import { SendScreen } from './screens/SendScreen';
import { SendReviewScreen } from './screens/SendReviewScreen';
import { SendSubmittedScreen } from './screens/SendSubmittedScreen';
import { SentScreen } from './screens/transactions/SentScreen';
import { TransactionDetailsScreen } from './screens/TransactionDetailsScreen';
import { ReceiveScreen } from './screens/ReceiveScreen';
import { ConnectApprovalScreen } from './screens/approvals/ConnectApprovalScreen';
import { SignMessageScreen } from './screens/approvals/SignMessageScreen';
import { TransactionApprovalScreen } from './screens/approvals/TransactionApprovalScreen';
import { SignRawTxScreen } from './screens/approvals/SignRawTxScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ThemeSettingsScreen } from './screens/ThemeSettingsScreen';
import { LockTimeScreen } from './screens/LockTimeScreen';
import { KeySettingsPasswordScreen } from './screens/KeySettingsPasswordScreen';
import { ViewSecretPhraseScreen } from './screens/ViewSecretPhraseScreen';
import { WalletPermissionsScreen } from './screens/WalletPermissionsScreen';
import { WalletSettingsScreen } from './screens/WalletSettingsScreen';
import { WalletStylingScreen } from './screens/WalletStylingScreen';
import { AboutScreen } from './screens/AboutScreen';
import { RecoveryPhraseScreen } from './screens/RecoveryPhraseScreen';
import { V0MigrationScreen } from './screens/V0MigrationScreen';

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
    case 'theme-settings':
      return <ThemeSettingsScreen />;
    case 'lock-time':
      return <LockTimeScreen />;
    case 'key-settings':
      return <KeySettingsPasswordScreen />;
    case 'view-secret-phrase':
      return <ViewSecretPhraseScreen />;
    case 'wallet-permissions':
      return <WalletPermissionsScreen />;
    case 'wallet-settings':
      return <WalletSettingsScreen />;
    case 'wallet-styling':
      return <WalletStylingScreen />;
    case 'about':
      return <AboutScreen />;
    case 'recovery-phrase':
      return <RecoveryPhraseScreen />;
    case 'v0-migration':
      return <V0MigrationScreen />;

    // Transactions
    case 'send':
      return <SendScreen />;
    case 'send-review':
      return <SendReviewScreen />;
    case 'send-submitted':
      return <SendSubmittedScreen />;
    case 'sent':
      return <SentScreen />;
    case 'receive':
      return <ReceiveScreen />;
    case 'tx-details':
      return <TransactionDetailsScreen />;

    // Approvals
    case 'connect-approval':
      return <ConnectApprovalScreen />;
    case 'sign-message':
      return <SignMessageScreen />;
    case 'approve-transaction':
      return <TransactionApprovalScreen />;
    case 'approve-sign-raw-tx':
      return <SignRawTxScreen />;

    // System
    case 'locked':
      return <LockedScreen />;

    // Default fallback
    default:
      return <div>Unknown screen: {currentScreen}</div>;
  }
}
