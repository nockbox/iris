/**
 * v0-to-v1 migration - delegates discovery and build to SDK.
 */

import { ensureWasmInitialized } from './wasm-utils';
import { getEffectiveRpcEndpoint } from './rpc-config';
import {
  buildV0MigrationTx as sdkBuildV0MigrationTx,
  queryV0Balance as sdkQueryV0Balance,
  type BuildV0MigrationTxResult,
  type V0BalanceResult,
} from '@nockbox/iris-sdk';
import type { Digest } from '@nockbox/iris-sdk/wasm';
import wasm from './sdk-wasm.js';
import { createBrowserClient } from './rpc-client-browser';

export type { V0BalanceResult };

const CONFIRM_POLL_INTERVAL_MS = 3000;
const CONFIRM_TIMEOUT_MS = 90_000;
/** [TEMPORARY] Set true to log unsigned tx before signing. Remove when migration is validated. */
const DEBUG_V0_MIGRATION = true;

/**
 * Discovery only: query v0 (Legacy) balance for a mnemonic. Use this to display balance
 * before building a migration tx. Does not build a transaction.
 */
export async function queryV0Balance(mnemonic: string): Promise<V0BalanceResult> {
  await ensureWasmInitialized();
  const grpcEndpoint = await getEffectiveRpcEndpoint();
  return sdkQueryV0Balance(mnemonic, grpcEndpoint);
}

/**
 * Build v0 migration transaction (queries balance internally, then builds tx when target provided).
 * Use for fee estimation and for the actual migration payload on the Funds screen.
 */
export async function buildV0MigrationTx(
  mnemonic: string,
  targetV1Pkh?: string,
  debug = false
): Promise<BuildV0MigrationTxResult> {
  await ensureWasmInitialized();
  const grpcEndpoint = await getEffectiveRpcEndpoint();
  const result = await sdkBuildV0MigrationTx(
    mnemonic,
    grpcEndpoint,
    targetV1Pkh as Digest | undefined,
    { debug }
  );

  if (debug) {
    console.log('[V0 Migration] Result:', {
      sourceAddress: result.sourceAddress,
      rawNotesFromRpc: result.rawNotesFromRpc,
      legacyV0Notes: result.v0Notes.length,
      totalNicks: result.totalNicks,
      smallestNoteNock: result.smallestNoteNock,
      txId: result.txId,
    });
  }

  return result;
}

/**
 * Sign a v0 migration raw transaction with the given mnemonic (master key) and broadcast.
 * Polls until the transaction is confirmed on-chain or timeout.
 *
 * @param options.debug - Log unsigned transaction to console before signing
 * @param options.skipBroadcast - Sign but do not broadcast (for debugging)
 */
export async function signAndBroadcastV0Migration(
  mnemonic: string,
  signRawTxPayload: { rawTx: any; notes: any[]; spendConditions?: (any | null)[]; refundLock?: any },
  options?: { debug?: boolean; skipBroadcast?: boolean }
): Promise<{ txId: string; confirmed: boolean; skipped?: boolean }> {
  await ensureWasmInitialized();
  const grpcEndpoint = await getEffectiveRpcEndpoint();

  const masterKey = wasm.deriveMasterKeyFromMnemonic(mnemonic, '');
  if (!masterKey.privateKey || masterKey.privateKey.byteLength !== 32) {
    masterKey.free();
    throw new Error('Cannot derive signing key from mnemonic');
  }

  const debug = options?.debug ?? DEBUG_V0_MIGRATION;
  const skipBroadcast = options?.skipBroadcast ?? debug;

  try {
    const { rawTx, notes } = signRawTxPayload;

    if (debug) {
      console.log('[V0 Migration] Unsigned transaction (before signing):', {
        rawTx: { id: rawTx?.id, version: rawTx?.version, spendsCount: rawTx?.spends?.length ?? 0 },
        notesCount: notes.length,
        spendConditionsCount: signRawTxPayload.spendConditions?.length ?? 0,
        fullRawTx: rawTx,
      });
    }

    // Current WASM API reconstructs from a NockchainTx rather than from notes/refund lock.
    let builder: wasm.TxBuilder;
    try {
      builder = wasm.TxBuilder.fromNockchainTx(
        wasm.rawTxV1ToNockchainTx(rawTx as wasm.RawTxV1),
        wasm.txEngineSettingsV1BythosDefault()
      );
    } catch (e) {
      console.error('[V0 Migration] TxBuilder.fromNockchainTx failed:', e);
      throw e;
    }

    const privateKey = wasm.PrivateKey.fromBytes(masterKey.privateKey);
    try {
      await builder.sign(privateKey);
    } catch (e) {
      console.error('[V0 Migration] builder.sign failed:', e);
      throw e;
    } finally {
      privateKey.free();
    }

    try {
      builder.validate();
    } catch (e) {
      console.error('[V0 Migration] builder.validate failed:', e);
      throw e;
    }

    const signedTx = builder.build();
    const signedRawTx = wasm.nockchainTxToRawTx(signedTx) as wasm.RawTxV1;
    const protobuf = wasm.rawTxToProtobuf(signedRawTx);

    if (debug) {
      console.log('[V0 Migration] Signed transaction (before broadcast):', {
        txId: signedTx.id,
        spendsCount: signedRawTx?.spends?.length ?? 0,
      });
    }

    if (skipBroadcast) {
      console.log('[V0 Migration] Skipping broadcast (debug mode)');
      return { txId: signedTx.id, confirmed: false, skipped: true };
    }

    const rpcClient = createBrowserClient(grpcEndpoint);
    const txId = await rpcClient.sendTransaction(protobuf);

    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const accepted = await rpcClient.isTransactionAccepted(txId);
      if (accepted) {
        return { txId, confirmed: true };
      }
      await new Promise(resolve => setTimeout(resolve, CONFIRM_POLL_INTERVAL_MS));
    }

    return { txId, confirmed: false };
  } finally {
    masterKey.free();
  }
}
