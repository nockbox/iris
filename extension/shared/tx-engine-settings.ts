/**
 * Centralized TxEngineSettings for the extension.
 * Patch 1 (Bythos): witness_word_div = 4, cost_per_word configurable.
 */

import wasm from './sdk-wasm.js';
import { DEFAULT_FEE_PER_WORD } from './constants.js';

export function txEngineSettings(costPerWord = DEFAULT_FEE_PER_WORD): wasm.TxEngineSettings {
  return {
    tx_engine_version: 1,
    tx_engine_patch: 1,
    min_fee: '256',
    cost_per_word: String(costPerWord),
    witness_word_div: 4,
  };
}
