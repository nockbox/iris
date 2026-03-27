/**
 * Map on-chain lock roots (from history sync) back to local accounts using PKH → spend-condition hash.
 */

import type { Account } from './types.js';
import { getEffectiveRpcConfig } from './rpc-config.js';
import {
  coinbasePkhLockRootBase58,
  simplePkhLockRootBase58,
} from './spend-conditions.js';
import { ensureWasmInitialized } from './wasm-utils.js';

/** Build lock root → account for every account (simple PKH + coinbase timelock variant). */
export async function buildLockRootToAccountMap(
  accounts: Account[]
): Promise<Map<string, Account>> {
  await ensureWasmInitialized();
  const config = await getEffectiveRpcConfig();
  const timelock = config.coinbaseTimelockBlocks ?? 100;
  const map = new Map<string, Account>();

  for (const acc of accounts) {
    const addr = acc.address?.trim();
    if (!addr) continue;
    try {
      map.set(simplePkhLockRootBase58(addr), acc);
      map.set(coinbasePkhLockRootBase58(addr, timelock), acc);
    } catch {
      // Invalid PKH — skip
    }
  }

  return map;
}

/** Resolve counterparty when stored value is either a PKH address or a lock-root digest. */
export function resolveCounterpartyAccount(
  counterparty: string | undefined,
  accounts: Account[],
  lockRootToAccount: Map<string, Account>
): Account | undefined {
  if (!counterparty) return undefined;
  const byPkh = accounts.find(
    a => a.address.toLowerCase() === counterparty.toLowerCase()
  );
  if (byPkh) return byPkh;
  return lockRootToAccount.get(counterparty);
}
