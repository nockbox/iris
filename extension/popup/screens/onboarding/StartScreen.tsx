/**
 * Onboarding Start Screen - Create new or import wallet
 */

import { useStore } from "../../store";
import { ScreenContainer } from "../../components/ScreenContainer";

export function StartScreen() {
  const { navigate } = useStore();

  return (
    <ScreenContainer>
      <h2 className="text-xl font-semibold mb-4">Welcome to Fort Nock</h2>

      <p className="text-sm text-gray-400 mb-6">
        A secure wallet for Nockchain
      </p>

      <button
        onClick={() => navigate("onboarding-create")}
        className="btn-primary my-2"
      >
        Create New Wallet
      </button>

      <button
        onClick={() => navigate("onboarding-import")}
        className="btn-secondary my-2"
      >
        I Have a Wallet
      </button>
    </ScreenContainer>
  );
}
