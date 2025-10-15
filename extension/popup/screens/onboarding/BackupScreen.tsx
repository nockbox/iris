/**
 * Onboarding Backup Screen - Display mnemonic for user to write down
 */

import { useStore } from '../../store';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Alert } from '../../components/Alert';

export function BackupScreen() {
  const { onboardingMnemonic, navigate } = useStore();

  if (!onboardingMnemonic) {
    // Should never happen, but handle gracefully
    return (
      <ScreenContainer>
        <h2 className="text-xl font-semibold mb-4 text-red-500">Error</h2>
        <p className="text-sm text-gray-400">No mnemonic found. Please restart onboarding.</p>
        <button onClick={() => navigate('onboarding-start')} className="btn-primary my-2">
          Back to Start
        </button>
      </ScreenContainer>
    );
  }

  const words = onboardingMnemonic.split(' ');

  function handleContinue() {
    navigate('onboarding-verify');
  }

  return (
    <ScreenContainer className="flex flex-col">
      <h2 className="text-xl font-semibold mb-2">Secret Recovery Phrase</h2>

      <Alert type="warning" className="mb-4">
        <strong>Warning:</strong> Write down these 24 words in order and store them safely.
        Never share them with anyone. This is the ONLY way to recover your wallet.
      </Alert>

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

      <button onClick={handleContinue} className="btn-primary">
        I've Written It Down
      </button>
    </ScreenContainer>
  );
}
