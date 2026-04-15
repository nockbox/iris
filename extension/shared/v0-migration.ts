/**
 * v0-to-v1 migration - delegates discovery and build to SDK.
 */

import { ensureWasmInitialized } from './wasm-utils';
import { getEffectiveRpcEndpoint, getTxEngineSettingsForHeight } from './rpc-config';
import {
  buildV0MigrationTx as sdkBuildV0MigrationTx,
  buildV0MigrationTxBuilderFromPayload,
  queryV0Balance as sdkQueryV0Balance,
  type BuildV0MigrationTxResult,
  type V0BalanceResult,
  type V0MigrationTxSignPayload,
} from '@nockbox/iris-sdk';
import type { Digest } from '@nockbox/iris-sdk/wasm';
import wasm from './sdk-wasm.js';
import { NOCK_TO_NICKS } from './constants';
import { createBrowserClient } from './rpc-client-browser';

export type { V0BalanceResult };

/** Shared optional flags for v0 migration build and sign/broadcast. */
export type V0MigrationOptions = {
  /**
   * Build: use a single smallest note and log the build result.
   * Sign/broadcast: log unsigned/signed txs and do not send to the network.
   */
  debug?: boolean;
};

const CONFIRM_POLL_INTERVAL_MS = 3000;
const CONFIRM_TIMEOUT_MS = 90_000;

async function migrationTxEngineSettings(grpcEndpoint: string): Promise<wasm.TxEngineSettings> {
  const client = createBrowserClient(grpcEndpoint);
  const blockHeight = await client.getCurrentBlockHeight();
  return (await getTxEngineSettingsForHeight(blockHeight)) as wasm.TxEngineSettings;
}

function v0SourcePublicKeyFromMnemonic(mnemonic: string): wasm.PublicKey {
  const masterKey = wasm.deriveMasterKeyFromMnemonic(mnemonic, '');
  try {
    const pk = wasm.publicKeyFromBeBytes(masterKey.publicKey);
    if (!pk) {
      throw new Error('Could not derive v0 public key from mnemonic');
    }
    return pk;
  } finally {
    masterKey.free();
  }
}

/**
 * Same fee read pattern as `buildTransaction`: sign, validate, then `calcFee()` (post-signature).
 */
async function feeNicksAfterSign(builder: wasm.TxBuilder, privateKey: wasm.PrivateKey): Promise<string> {
  await builder.sign(privateKey);
  builder.validate();
  return String(builder.calcFee());
}

/**
 * Discovery only: query v0 (Legacy) balance for a mnemonic. Use this to display balance
 * before building a migration tx. Does not build a transaction.
 */
export async function queryV0Balance(mnemonic: string): Promise<V0BalanceResult> {
  await ensureWasmInitialized();
  const grpcEndpoint = await getEffectiveRpcEndpoint();
  const sourcePublicKey = v0SourcePublicKeyFromMnemonic(mnemonic);
  return sdkQueryV0Balance(sourcePublicKey, grpcEndpoint);
}

/**
 * Build v0 migration transaction (queries balance internally, then builds to `targetV1Pkh`).
 *
 * @param targetV1Pkh - Destination v1 PKH (`Digest` from iris-wasm). Use `pkhAddressToDigest` for base58 wallet addresses.
 * @param options.debug - When true, builds with a single smallest note and logs the result (see {@link V0MigrationOptions}).
 */
export async function buildV0MigrationTx(
  mnemonic: string,
  targetV1Pkh: Digest,
  options?: V0MigrationOptions
): Promise<BuildV0MigrationTxResult> {
  await ensureWasmInitialized();
  const grpcEndpoint = await getEffectiveRpcEndpoint();
  const txEngineSettings = await migrationTxEngineSettings(grpcEndpoint);
  const sourcePublicKey = v0SourcePublicKeyFromMnemonic(mnemonic);

  const debug = options?.debug === true;

  let result = await sdkBuildV0MigrationTx(sourcePublicKey, grpcEndpoint, targetV1Pkh, {
    txEngineSettings,
    maxNotes: debug ? 1 : undefined,
  });

  if (result.v0MigrationTxSignPayload) {
    const masterKey = wasm.deriveMasterKeyFromMnemonic(mnemonic, '');
    try {
      if (!masterKey.privateKey || masterKey.privateKey.byteLength !== 32) {
        throw new Error('Cannot derive signing key from mnemonic');
      }
      const privateKey = wasm.PrivateKey.fromBytes(masterKey.privateKey);
      try {
        const builder = buildV0MigrationTxBuilderFromPayload(
          result.v0MigrationTxSignPayload,
          txEngineSettings
        );
        const feeNicks = await feeNicksAfterSign(builder, privateKey);
        result = {
          ...result,
          fee: feeNicks as BuildV0MigrationTxResult['fee'],
          feeNock: Number(BigInt(feeNicks)) / NOCK_TO_NICKS,
        };
      } finally {
        privateKey.free();
      }
    } finally {
      masterKey.free();
    }
  }

  if (debug) {
    console.log('[V0 Migration] Result:', {
      sourceAddress: result.sourceAddress,
      rawNotesFromRpc: result.rawNotesFromRpc,
      legacyV0Notes: result.v0Notes.length,
      totalNicks: result.totalNicks,
      smallestNoteNock: result.smallestNoteNock,
      txId: result.txId,
      feeNock: result.feeNock,
      sdkDebugUsesSingleSmallestNote: debug,
    });
  }

  return result;
}

/**
 * Sign a v0 migration raw transaction with the given mnemonic (master key) and broadcast.
 * Polls until the transaction is confirmed on-chain or timeout.
 *
 * @param options - See {@link V0MigrationOptions} for `debug`.
 */
export async function signAndBroadcastV0Migration(
  mnemonic: string,
  payload: V0MigrationTxSignPayload,
  options?: V0MigrationOptions
): Promise<{ txId: string; confirmed: boolean; skipped?: boolean }> {
  await ensureWasmInitialized();
  const grpcEndpoint = await getEffectiveRpcEndpoint();
  const txEngineSettings = await migrationTxEngineSettings(grpcEndpoint);

  const masterKey = wasm.deriveMasterKeyFromMnemonic(mnemonic, '');
  if (!masterKey.privateKey || masterKey.privateKey.byteLength !== 32) {
    masterKey.free();
    throw new Error('Cannot derive signing key from mnemonic');
  }

  const debug = options?.debug === true;

  try {
    const { rawTx, notes, spendConditions, refundLock } = payload;

    if (debug) {
      const dbgTx = rawTx as { id?: string; version?: number; spends?: unknown[] };
      console.log('[V0 Migration] Unsigned transaction (before signing):', {
        rawTx: { id: dbgTx.id, version: dbgTx.version, spendsCount: dbgTx.spends?.length ?? 0 },
        notesCount: notes.length,
        spendConditionsCount: spendConditions?.length ?? 0,
        fullRawTx: rawTx,
      });
    }

    let builder: wasm.TxBuilder;
    try {
      builder = buildV0MigrationTxBuilderFromPayload(
        { rawTx, notes, spendConditions, refundLock },
        txEngineSettings
      );
    } catch (e) {
      console.error('[V0 Migration] Failed to reconstruct signer builder from notes:', e);
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
