/**
 * Locked Screen - Unlock wallet with password
 */

import { useState } from "react";
import { INTERNAL_METHODS, ERROR_CODES } from "../../../shared/constants";
import { useStore } from "../../store";
import { send } from "../../utils/messaging";
import { ScreenContainer } from "../../components/ScreenContainer";
import { Alert } from "../../components/Alert";

export function LockedScreen() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { navigate, syncWallet, wallet } = useStore();

  async function handleUnlock() {
    // Clear previous errors
    setError("");

    if (!password) {
      setError("Please enter a password");
      return;
    }

    const result = await send<{
      ok?: boolean;
      address?: string;
      accounts?: Array<{ name: string; address: string; index: number }>;
      error?: string;
    }>(INTERNAL_METHODS.UNLOCK, [password]);

    if (result?.error) {
      setError(
        result.error === ERROR_CODES.BAD_PASSWORD
          ? "Incorrect password"
          : `Error: ${result.error}`
      );
      setPassword(""); // Clear password on error
    } else {
      setPassword("");
      const accounts = result.accounts || [];
      const currentAccount = accounts[0] || null;
      syncWallet({
        locked: false,
        address: result.address || null,
        accounts,
        currentAccount,
        balance: wallet.balance || 0,
      });
      navigate("home");
    }
  }

  return (
    <ScreenContainer>
      <h2 className="text-xl font-semibold mb-4">Fort Nock</h2>

      <div>
        <input
          type="password"
          placeholder="Password"
          className="input-field my-2"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(""); // Clear error on input
          }}
          onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
        />

        {error && (
          <Alert type="error" className="my-2">
            {error}
          </Alert>
        )}

        <button onClick={handleUnlock} className="btn-primary my-2">
          Unlock
        </button>
      </div>
    </ScreenContainer>
  );
}
