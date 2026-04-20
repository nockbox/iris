/**
 * Bridge configuration for Nockchain → Base (Zorp bridge).
 * Used by iris-sdk buildBridgeTransaction and validateBridgeTransaction.
 */

import type { BridgeConfig } from '@nockbox/iris-sdk';
import {
  MIN_BRIDGE_AMOUNT_NOCK,
  NOCK_TO_NICKS,
  ZORP_BRIDGE_ADDRESSES,
  ZORP_BRIDGE_THRESHOLD,
} from '@nockbox/iris-sdk';
import type { Nicks } from '@nockbox/iris-sdk/wasm';
import type { WalletTransaction } from './types';

export const BRIDGE_CONFIG: BridgeConfig = {
  threshold: ZORP_BRIDGE_THRESHOLD,
  addresses: ZORP_BRIDGE_ADDRESSES,
  noteDataKey: 'bridge',
  chainTag: '65736162', // %base in little-endian hex
  versionTag: '0',
  minAmountNicks: String(MIN_BRIDGE_AMOUNT_NOCK * NOCK_TO_NICKS) as Nicks,
};

/** Nockchain → Base bridge rows (set via WalletTransaction.kind in sendBridgeTransaction). */
export function isBridgeWalletTx(tx: WalletTransaction): boolean {
  return tx.kind === 'bridge';
}
