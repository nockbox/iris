/**
 * Home Screen - Main wallet view showing balance and actions
 */

import { INTERNAL_METHODS } from "../../../shared/constants";
import { useStore } from "../../store";
import { send } from "../../utils/messaging";
import { ScreenContainer } from "../../components/ScreenContainer";
import { AccountSelector } from "../../components/AccountSelector";
import { RecentTransactions } from "../../components/RecentTransactions";
import { LockIcon } from "../../components/icons/LockIcon";
import { SettingsIcon } from "../../components/icons/SettingsIcon";

export function HomeScreen() {
  const { wallet, navigate, syncWallet } = useStore();

  async function handleLock() {
    await send(INTERNAL_METHODS.LOCK);
    syncWallet({ ...wallet, locked: true });
    navigate("locked");
  }

  return (
    <ScreenContainer className="flex flex-col">
      {/* Header with Lock and Settings icons */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Fort Nock</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleLock}
            className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-800"
            title="Lock Wallet"
          >
            <LockIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => navigate("settings")}
            className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-800"
            title="Settings"
          >
            <SettingsIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Account Selector */}
      <div className="mb-4">
        <AccountSelector />
      </div>

      <div className="my-4">
        <div className="text-sm text-gray-400 mb-2">Balance</div>
        <div className="text-3xl font-bold">{(wallet.balance || 0).toFixed(2)} NOCK</div>
      </div>

      <div className="grid grid-cols-2 gap-2 my-4">
        <button onClick={() => navigate("send")} className="btn-primary">
          Send
        </button>
        <button onClick={() => navigate("receive")} className="btn-secondary">
          Receive
        </button>
      </div>

      {/* Recent Transactions */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <RecentTransactions onViewAll={() => navigate("home")} />
      </div>
    </ScreenContainer>
  );
}
