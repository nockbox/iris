import type { Account } from './types.js';
import { getEffectiveRpcConfig } from './rpc-config.js';
import {
  coinbasePkhLockRootBase58,
  simplePkhLockRootBase58,
} from './spend-conditions.js';
import { ensureWasmInitialized } from './wasm-utils.js';

/** Build lock-root to account mappings for locally known accounts. */
export async function buildLockRootToAccountMap(
  accounts: Account[]
): Promise<Map<string, Account>> {
  await ensureWasmInitialized();
  const config = await getEffectiveRpcConfig();
  const timelock = config.coinbaseTimelockBlocks ?? 100;
  const map = new Map<string, Account>();

  for (const account of accounts) {
    const address = account.address?.trim();
    if (!address) continue;

    try {
      map.set(simplePkhLockRootBase58(address), account);
      map.set(coinbasePkhLockRootBase58(address, timelock), account);
    } catch {
      // Skip invalid addresses instead of failing the whole map build.
    }
  }

  return map;
}

/** Resolve a counterparty when tx history stores either a wallet address or a lock root. */
export function resolveCounterpartyAccount(
  counterparty: string | undefined,
  accounts: Account[],
  lockRootToAccount: Map<string, Account>
): Account | undefined {
  if (!counterparty) return undefined;

  const directMatch = accounts.find(
    account => account.address.toLowerCase() === counterparty.toLowerCase()
  );
  if (directMatch) return directMatch;

  return lockRootToAccount.get(counterparty);
}
