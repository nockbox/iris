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

const CONFIRM_POLL_INTERVAL_MS = 3000;
const CONFIRM_TIMEOUT_MS = 90_000;

/** Dedupes React Strict Mode double-mount for the same built tx id. */
let lastLoggedV0MigrationUnsignedTxId: string | undefined;

/**
 * Log the unsigned migration tx for inspection before the user taps Send.
 * Call from the review screen when {@link V0MigrationTxSignPayload} is ready.
 */
export function logV0MigrationUnsignedTxPayload(
  payload: V0MigrationTxSignPayload,
  message = '[V0 Migration] Unsigned transaction (review — before Send):'
): void {
  const { rawTx, notes, spendConditions, refundLock } = payload;
  const dbgTx = rawTx as { id?: string; version?: number; spends?: unknown[] };
  const id = dbgTx.id;
  if (typeof id === 'string' && lastLoggedV0MigrationUnsignedTxId === id) {
    return;
  }
  if (typeof id === 'string') {
    lastLoggedV0MigrationUnsignedTxId = id;
  }

  const rawTxV1 = rawTx as wasm.RawTxV1;
  const protobufTx = wasm.rawTxToProtobuf(rawTxV1);
  const seedLockRoots = [
    ...new Set(
      rawTxV1.spends.flatMap(([, spend]) => spend.seeds.map(seed => seed.lock_root))
    ),
  ];

  console.log(message, {
    rawTx: { id: dbgTx.id, version: dbgTx.version, spendsCount: dbgTx.spends?.length ?? 0 },
    protobufTx,
    targetLockRoot: refundLock,
    seedLockRoots,
    allSeedsUseTargetLockRoot: seedLockRoots.length === 1 && seedLockRoots[0] === refundLock,
    notesCount: notes.length,
    spendConditionsCount: spendConditions?.length ?? 0,
    inputNotesSummary: notes.map((n, i) => ({
      index: i,
      assetsNicks: n.assets,
    })),
    fullRawTx: rawTx,
  });
}

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
 * Reconstructed migration builders need fee/signature convergence:
 * signing changes witness size, which can increase required fee.
 * Re-sign + recalc a few rounds until fee stabilizes, then validate.
 */
async function feeNicksAfterSign(builder: wasm.TxBuilder, privateKey: wasm.PrivateKey): Promise<string> {
  let previousFee = '';
  const MAX_FEE_CONVERGENCE_ROUNDS = 4;

  for (let i = 0; i < MAX_FEE_CONVERGENCE_ROUNDS; i++) {
    builder.recalcAndSetFee(false);
    await builder.sign(privateKey);
    const currentFee = String(builder.curFee());
    if (currentFee === previousFee) {
      break;
    }
    previousFee = currentFee;
  }

  // Ensure final tx has signatures matching the last fee adjustment.
  await builder.sign(privateKey);
  builder.validate();
  return String(builder.curFee());
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
 * @param targetV1Pkh - Destination v1 PKH (`Digest` from iris-wasm). Use `pkhAddressToDigest` for base58 wallet addresses.
 */
export async function buildV0MigrationTx(
  mnemonic: string,
  targetV1Pkh: Digest
): Promise<BuildV0MigrationTxResult> {
  await ensureWasmInitialized();
  const grpcEndpoint = await getEffectiveRpcEndpoint();
  const txEngineSettings = await migrationTxEngineSettings(grpcEndpoint);
  const sourcePublicKey = v0SourcePublicKeyFromMnemonic(mnemonic);

  let result = await sdkBuildV0MigrationTx(sourcePublicKey, grpcEndpoint, targetV1Pkh, {
    txEngineSettings,
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
        let feeNicks: string;
        try {
          feeNicks = await feeNicksAfterSign(builder, privateKey);
        } catch (e) {
          throw e;
        }
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

  return result;
}

/**
 * Sign a v0 migration raw transaction with the given mnemonic (master key) and broadcast.
 * Polls until the transaction is confirmed on-chain or timeout.
 */
export async function signAndBroadcastV0Migration(
  mnemonic: string,
  payload: V0MigrationTxSignPayload
): Promise<{ txId: string; confirmed: boolean }> {
  await ensureWasmInitialized();
  const grpcEndpoint = await getEffectiveRpcEndpoint();
  const txEngineSettings = await migrationTxEngineSettings(grpcEndpoint);

  const masterKey = wasm.deriveMasterKeyFromMnemonic(mnemonic, '');
  if (!masterKey.privateKey || masterKey.privateKey.byteLength !== 32) {
    masterKey.free();
    throw new Error('Cannot derive signing key from mnemonic');
  }

  try {
    const { rawTx, notes, spendConditions, refundLock } = payload;

    let builder: wasm.TxBuilder;
    try {
      builder = buildV0MigrationTxBuilderFromPayload(
        { rawTx, notes, spendConditions, refundLock },
        txEngineSettings
      );
    } catch (e) {
      throw e;
    }

    const privateKey = wasm.PrivateKey.fromBytes(masterKey.privateKey);
    try {
      await feeNicksAfterSign(builder, privateKey);
    } catch (e) {
      throw e;
    } finally {
      privateKey.free();
    }

    const signedTx = builder.build();
    const signedRawTx = wasm.nockchainTxToRawTx(signedTx) as wasm.RawTxV1;
    const protobuf = wasm.rawTxToProtobuf(signedRawTx);

    const rpcClient = createBrowserClient(grpcEndpoint);
    // Note: the node's WalletSendTransaction ACK is an empty Acknowledged
    await rpcClient.sendTransaction(protobuf);
    const txId = signedTx.id;

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
