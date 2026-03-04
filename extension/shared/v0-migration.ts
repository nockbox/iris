/**
 * v0-to-v1 migration - delegates to SDK.
 */

import { NOCK_TO_NICKS, RPC_ENDPOINT } from './constants';
import { ensureWasmInitialized } from './wasm-utils';
import {
  buildV0MigrationTransactionFromNotes as sdkBuildFromNotes,
  deriveV0AddressFromMnemonic as sdkDeriveV0Address,
  queryV0BalanceFromMnemonic as sdkQueryV0Balance,
} from '@nockbox/iris-sdk';

export interface V0DiscoveryResult {
  sourceAddress: string;
  v0NotesProtobuf: any[];
  totalNicks: string;
  totalNock: number;
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
  const v0NotesProtobuf = discovery.balance.notes
    ?.filter((e: any) => e?.note?.note_version && 'Legacy' in e.note.note_version)
    .map((e: any) => e.note) ?? [];
  return {
    sourceAddress: discovery.sourceAddress,
    v0NotesProtobuf,
    totalNicks: discovery.totalNicks,
    totalNock: Number(BigInt(discovery.totalNicks)) / NOCK_TO_NICKS,
  };
}

export async function buildV0MigrationTransactionFromNotes(
  v0NotesProtobuf: any[],
  targetV1Pkh: string,
  feePerWord = '32768'
): Promise<BuiltV0MigrationResult> {
  await ensureWasmInitialized();
  const built = await sdkBuildFromNotes(v0NotesProtobuf, targetV1Pkh, feePerWord, {
    debug: true, // [TEMPORARY] Remove when migration is validated
  });
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
