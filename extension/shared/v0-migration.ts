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
import type { TransactionDetails, WalletTransaction } from './types';

export type { V0BalanceResult };

/** Shared optional flags for v0 migration build and sign/broadcast. */
export type V0MigrationOptions = {
  /**
   * Build: use a single smallest note and log the build result.
   * Sign/broadcast: log unsigned/signed txs.
   */
  debug?: boolean;
};

function summarizeSmallestV0Note(
  notes: Array<{ assets: string }>
): { index: number; assetsNicks: string; assetsNock: number } | null {
  if (!notes.length) return null;
  let smallestIndex = 0;
  let smallestAssets = BigInt(notes[0].assets);
  for (let i = 1; i < notes.length; i++) {
    const assets = BigInt(notes[i].assets);
    if (assets < smallestAssets) {
      smallestAssets = assets;
      smallestIndex = i;
    }
  }
  return {
    index: smallestIndex,
    assetsNicks: smallestAssets.toString(),
    assetsNock: Number(smallestAssets) / NOCK_TO_NICKS,
  };
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
        let feeNicks: string;
        try {
          feeNicks = await feeNicksAfterSign(builder, privateKey);
        } catch (e) {
          if (debug) {
            console.error('[V0 Migration] Fee estimation failed during sign/validate:', {
              error: e instanceof Error ? e.message : String(e),
              txId: result.txId,
              notesUsed: result.v0MigrationTxSignPayload.notes.length,
              smallestDiscoveredNote: summarizeSmallestV0Note(
                result.v0Notes as Array<{ assets: string }>
              ),
            });
          }
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

  if (debug) {
    const smallestNote = summarizeSmallestV0Note(result.v0Notes as Array<{ assets: string }>);
    console.log('[V0 Migration] Result:', {
      sourceAddress: result.sourceAddress,
      rawNotesFromRpc: result.rawNotesFromRpc,
      legacyV0Notes: result.v0Notes.length,
      totalNicks: result.totalNicks,
      smallestNoteNock: result.smallestNoteNock,
      smallestDiscoveredNote: smallestNote,
      txId: result.txId,
      feeNock: result.feeNock,
      sdkDebugUsesSingleSmallestNote: debug,
    });
    if (!result.v0MigrationTxSignPayload) {
      console.warn(
        '[V0 Migration] Build returned discovery-only result (no sign payload). This usually means the selected single note could not produce a valid migration tx with current fees/settings.',
        {
          endpoint: grpcEndpoint,
          txEngineSettings,
          smallestDiscoveredNote: smallestNote,
        }
      );
    }
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
    let convergedFeeNicks = '0';
    try {
      convergedFeeNicks = await feeNicksAfterSign(builder, privateKey);
    } catch (e) {
      console.error('[V0 Migration] builder.sign/validate failed:', e);
      throw e;
    } finally {
      privateKey.free();
    }

    const signedTx = builder.build();
    const signedRawTx = wasm.nockchainTxToRawTx(signedTx) as wasm.RawTxV1;
    const protobuf = wasm.rawTxToProtobuf(signedRawTx);

    if (debug) {
      let derivedOutputs: unknown[] = [];
      try {
        const rpcClient = createBrowserClient(grpcEndpoint);
        const blockHeight = await rpcClient.getCurrentBlockHeight();
        const outputs = wasm.rawTxOutputs(signedRawTx, blockHeight, txEngineSettings);
        derivedOutputs = outputs.map(output => {
          const protobufNote = wasm.noteToProtobuf(output);
          const note = protobufNote as Record<string, unknown>;
          const name = note.name as Record<string, unknown> | undefined;
          const noteVersion = note.note_version as Record<string, unknown> | undefined;
          const v1 = noteVersion?.V1 as Record<string, unknown> | undefined;
          const v1Name = v1?.name as Record<string, unknown> | undefined;
          return {
            firstName:
              typeof name?.first === 'string'
                ? name.first
                : typeof v1Name?.first === 'string'
                  ? v1Name.first
                  : null,
            assetsNicks: note.assets,
            fullOutputNote: protobufNote,
          };
        });
      } catch (e) {
        console.warn(
          '[V0 Migration] Failed to derive output notes from signed tx for debug logging:',
          e
        );
      }

      console.log('[V0 Migration] Signed transaction (before broadcast):', {
        txId: signedTx.id,
        spendsCount: signedRawTx?.spends?.length ?? 0,
        feeNicks: convergedFeeNicks,
        feeNock: Number(BigInt(convergedFeeNicks)) / NOCK_TO_NICKS,
        derivedOutputs,
        fullSignedRawTx: signedRawTx,
        protobufPayload: protobuf,
      });
      console.log('[V0 Migration] Debug mode enabled; broadcasting after logging');
    }

    const rpcClient = createBrowserClient(grpcEndpoint);
    // Note: the node's WalletSendTransaction ACK is an empty Acknowledged
    await rpcClient.sendTransaction(protobuf);
    const txId = signedTx.id;

    // Confirmation is driven by the normal wallet history-sync loop (see vault.ts),
    // which uses the same mempool/peek path as regular sends. Blocking here on
    // `transactionAccepted` caused stalls because some nodes' peek path returns
    // "Peek operation failed" for freshly-broadcast v0→v1 migration txs.
    return { txId, confirmed: false };
  } finally {
    masterKey.free();
  }
}

/**
 * Whether a wallet history row looks like a v0→v1 migration receipt (long legacy sender, short v1 recipient).
 */
export function isMigrationWalletTx(tx: WalletTransaction): boolean {
  if (tx.migrationFromV0) return true;
  const from = (tx.sender ?? '').trim();
  const to = (tx.recipient ?? '').trim();
  if (tx.direction !== 'incoming' || !from || !to) return false;
  return from.length >= 60 && to.length < 60;
}

/**
 * Whether {@link TransactionDetails} on the post-send screen came from the
 * v0 migration flow (legacy pubkey as `from`, shorter v1 account as `to`).
 * Regular send uses the current v1 account as `from`, which is shorter.
 */
export function isV0MigrationSubmittedTx(
  tx: Pick<TransactionDetails, 'from' | 'to'> | null | undefined
): boolean {
  const from = (tx?.from ?? '').trim();
  const to = (tx?.to ?? '').trim();
  return from.length >= 100 && to.length > 0 && to.length < from.length;
}
