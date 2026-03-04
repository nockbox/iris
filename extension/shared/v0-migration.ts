/**
 * v0-to-v1 migration - delegates discovery and build to SDK.
 */

import { NOCK_TO_NICKS, RPC_ENDPOINT } from './constants';
import { ensureWasmInitialized } from './wasm-utils';
import {
  buildV0MigrationTransaction as sdkBuildFromV0Notes,
  deriveV0AddressFromMnemonic as sdkDeriveV0Address,
  queryV0BalanceFromMnemonic as sdkQueryV0Balance,
} from '@nockbox/iris-sdk';
import wasm from './sdk-wasm.js';
import { txEngineSettings } from './tx-engine-settings.js';
import { createBrowserClient } from './rpc-client-browser';

export interface V0DiscoveryResult {
  sourceAddress: string;
  v0Notes: any[];
  totalNicks: string;
  totalNock: number;
  /** Raw notes count from RPC (for debugging when v0Notes is empty) */
  rawNotesFromRpc?: number;
}

export interface BuiltV0MigrationResult {
  txId: string;
  feeNicks: string;
  feeNock: number;
  migratedNicks: string;
  migratedNock: number;
  selectedNoteNicks: string;
  selectedNoteNock: number;
  signRawTxPayload: {
    rawTx: any;
    notes: any[];
    spendConditions: any[];
  };
}

export async function deriveV0AddressFromMnemonic(
  mnemonic: string,
  passphrase = ''
): Promise<{ sourceAddress: string }> {
  await ensureWasmInitialized();
  const derived = sdkDeriveV0Address(mnemonic, passphrase);
  return { sourceAddress: derived.sourceAddress };
}

export async function queryV0BalanceFromMnemonic(
  mnemonic: string,
  grpcEndpoint = RPC_ENDPOINT
): Promise<V0DiscoveryResult> {
  await ensureWasmInitialized();
  const discovery = await sdkQueryV0Balance(mnemonic, grpcEndpoint);
  const rawNotesCount = discovery.balance?.notes?.length ?? 0;
  const legacyCount = discovery.v0Notes.length;
  console.log('[V0 Migration] Discovery result:', {
    sourceAddress: discovery.sourceAddress,
    rawNotesFromRpc: rawNotesCount,
    legacyV0Notes: legacyCount,
    totalNicks: discovery.totalNicks,
  });
  if (legacyCount === 0 && rawNotesCount > 0) {
    const first = discovery.balance?.notes?.[0];
    const nv = first?.note?.note_version;
    const nvKeys = nv && typeof nv === 'object' ? Object.keys(nv) : [];
    console.warn('[V0 Migration] RPC returned', rawNotesCount, 'notes but none are Legacy (v0). Check note_version structure.');
    console.warn('[V0 Migration] First entry note_version keys:', nvKeys, 'sample:', nv ? JSON.stringify(nv).slice(0, 300) : 'n/a');
  }
  return {
    sourceAddress: discovery.sourceAddress,
    v0Notes: discovery.v0Notes,
    totalNicks: discovery.totalNicks,
    totalNock: Number(BigInt(discovery.totalNicks)) / NOCK_TO_NICKS,
    rawNotesFromRpc: rawNotesCount,
  };
}

export async function buildV0MigrationTransactionFromNotes(
  v0Notes: any[],
  targetV1Pkh: string,
  feePerWord = '32768'
): Promise<BuiltV0MigrationResult> {
  await ensureWasmInitialized();
  const built = await sdkBuildFromV0Notes(v0Notes, targetV1Pkh, feePerWord, undefined, undefined, {
    singleNoteOnly: true,
    debug: true, // [TEMPORARY] Remove when migration is validated
  }) as { txId: string; fee: string; feeNock: number; migratedNicks: string; migratedNock: number; selectedNoteNicks: string; selectedNoteNock: number; signRawTxPayload: { rawTx: any; notes: any[]; spendConditions: any[] } };
  return {
    txId: built.txId,
    feeNicks: built.fee,
    feeNock: built.feeNock,
    migratedNicks: built.migratedNicks,
    migratedNock: built.migratedNock,
    selectedNoteNicks: built.selectedNoteNicks,
    selectedNoteNock: built.selectedNoteNock,
    signRawTxPayload: {
      rawTx: built.signRawTxPayload.rawTx,
      notes: built.signRawTxPayload.notes,
      spendConditions: built.signRawTxPayload.spendConditions,
    },
  };
}

const CONFIRM_POLL_INTERVAL_MS = 3000;
const CONFIRM_TIMEOUT_MS = 90_000;

/** [TEMPORARY] Set true to log unsigned tx before signing. Remove when migration is validated. */
const DEBUG_V0_MIGRATION = true;

/**
 * Sign a v0 migration raw transaction with the given mnemonic (master key) and broadcast.
 * Polls until the transaction is confirmed on-chain or timeout.
 *
 * @param options.debug - Log unsigned transaction to console before signing
 * @param options.skipBroadcast - Sign but do not broadcast (for debugging)
 */
export async function signAndBroadcastV0Migration(
  mnemonic: string,
  signRawTxPayload: { rawTx: any; notes: any[]; spendConditions: any[] },
  grpcEndpoint = RPC_ENDPOINT,
  options?: { debug?: boolean; skipBroadcast?: boolean }
): Promise<{ txId: string; confirmed: boolean; skipped?: boolean }> {
  await ensureWasmInitialized();

  const masterKey = wasm.deriveMasterKeyFromMnemonic(mnemonic, '');
  if (!masterKey.privateKey || masterKey.privateKey.byteLength !== 32) {
    masterKey.free();
    throw new Error('Cannot derive signing key from mnemonic');
  }

  const debug = options?.debug ?? DEBUG_V0_MIGRATION;
  const skipBroadcast = options?.skipBroadcast ?? false;

  try {
    const { rawTx, notes, spendConditions } = signRawTxPayload;

    if (debug) {
      console.log('[V0 Migration] Unsigned transaction (before signing):', {
        rawTx: { id: rawTx?.id, version: rawTx?.version, spendsCount: rawTx?.spends?.length ?? 0 },
        notesCount: notes.length,
        spendConditionsCount: spendConditions.length,
        fullRawTx: rawTx,
      });
    }

    let builder: ReturnType<typeof wasm.TxBuilder.fromTx>;
    try {
      builder = wasm.TxBuilder.fromTx(
        rawTx,
        notes,
        spendConditions,
        txEngineSettings()
      );
    } catch (e) {
      console.error('[V0 Migration] TxBuilder.fromTx failed:', e);
      throw e;
    }

    const signingKeyBytes = new Uint8Array(masterKey.privateKey.slice(0, 32));
    try {
      builder.sign(signingKeyBytes);
    } catch (e) {
      console.error('[V0 Migration] builder.sign failed:', e);
      throw e;
    }

    try {
      builder.validate();
    } catch (e) {
      console.error('[V0 Migration] builder.validate failed:', e);
      throw e;
    }

    const signedTx = builder.build();
    const signedRawTx = wasm.nockchainTxToRaw(signedTx) as wasm.RawTxV1;
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
