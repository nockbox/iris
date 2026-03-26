/**
 * Bridge configuration for Nockchain → Base (Zorp bridge).
 * Used by iris-sdk buildBridgeTransaction and validateBridgeTransaction.
 */

import type { BridgeConfig } from '@nockbox/iris-sdk';
import type { Nicks as WasmNicks } from '@nockbox/iris-sdk/wasm';
import {
  ZORP_BRIDGE_THRESHOLD,
  ZORP_BRIDGE_ADDRESSES,
  MIN_BRIDGE_AMOUNT_NOCK,
  DEFAULT_FEE_PER_WORD,
  NOCK_TO_NICKS,
} from './constants';

export const BRIDGE_CONFIG: BridgeConfig = {
  threshold: ZORP_BRIDGE_THRESHOLD,
  addresses: ZORP_BRIDGE_ADDRESSES,
  noteDataKey: 'bridge',
  chainTag: '65736162', // %base in little-endian hex
  versionTag: '0',
  feePerWord: String(DEFAULT_FEE_PER_WORD) as WasmNicks,
  minAmountNicks: String(MIN_BRIDGE_AMOUNT_NOCK * NOCK_TO_NICKS) as WasmNicks,
};
