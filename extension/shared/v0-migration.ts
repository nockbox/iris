import { base58 } from '@scure/base';
import { NOCK_TO_NICKS, RPC_ENDPOINT } from './constants';
import { ensureWasmInitialized } from './wasm-utils';
import { wasm } from './sdk-wasm';
import type { TxEngineSettings } from '@nockbox/iris-sdk/wasm';
import { getEffectiveRpcEndpoint } from './rpc-config';
import { createBrowserClient } from './rpc-client-browser';

const DEFAULT_FEE_PER_WORD = '32768';
const TARGET_NOTE_NOCK = 300;
const MIGRATION_AMOUNT_NOCK = 200;
const TARGET_NOTE_NICKS = BigInt(TARGET_NOTE_NOCK * NOCK_TO_NICKS);
const MIGRATION_AMOUNT_NICKS = BigInt(MIGRATION_AMOUNT_NOCK * NOCK_TO_NICKS);
let activeV0MigrationMnemonic: string | null = null;

function isNoteV0(note: unknown): note is any {
  return Boolean(note && typeof note === 'object' && 'inner' in note && 'sig' in note && 'source' in note);
}

export interface V0DiscoveryResult {
  sourceAddress: string;
  sourcePkh: string;
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

export function setV0MigrationSigningMnemonic(mnemonic: string): void {
  activeV0MigrationMnemonic = mnemonic.trim();
}

export function clearV0MigrationSigningMnemonic(): void {
  activeV0MigrationMnemonic = null;
}

function getV0MigrationSigningMnemonic(): string {
  if (!activeV0MigrationMnemonic) {
    throw new Error('Missing v0 signing phrase. Re-import your v0 wallet and try again.');
  }
  return activeV0MigrationMnemonic;
}

function toRawTx(rawTx: any): any {
  const asProtobuf = rawTx && typeof rawTx.toProtobuf === 'function' ? rawTx.toProtobuf() : rawTx;
  try {
    return wasm.rawTxFromProtobuf(asProtobuf);
  } catch {
    if (rawTx && typeof rawTx === 'object' && 'spends' in rawTx) {
      return rawTx;
    }
    throw new Error(
      'Raw transaction must be protobuf or have .toProtobuf(); data did not match any variant of RawTx'
    );
  }
}

function toNote(note: any): any {
  if (note && typeof note === 'object' && ('version' in note || 'inner' in note)) {
    return note;
  }
  if (note && typeof note.toProtobuf === 'function') {
    return wasm.note_from_protobuf(note.toProtobuf());
  }
  return wasm.note_from_protobuf(note);
}

function txEngineSettings(): any {
  return {
    tx_engine_version: 1,
    tx_engine_patch: 0,
    min_fee: '0',
    cost_per_word: String(DEFAULT_FEE_PER_WORD),
    witness_word_div: 1,
  };
}

export async function deriveV0AddressFromMnemonic(
  mnemonic: string,
  passphrase = ''
): Promise<{ sourceAddress: string; sourcePkh: string }> {
  await ensureWasmInitialized();
  const master = wasm.deriveMasterKeyFromMnemonic(mnemonic, passphrase);
  const publicKey = Uint8Array.from(master.publicKey);
  const sourceAddress = base58.encode(publicKey);
  const sourcePkh = wasm.hashPublicKey(publicKey);
  return { sourceAddress, sourcePkh };
}

export async function queryV0BalanceFromMnemonic(
  mnemonic: string,
  grpcEndpoint?: string
): Promise<V0DiscoveryResult> {
  const { sourceAddress, sourcePkh } = await deriveV0AddressFromMnemonic(mnemonic);
  return queryV0BalanceByAddress(sourceAddress, grpcEndpoint, sourcePkh);
}

async function queryV0BalanceByAddress(
  sourceAddress: string,
  grpcEndpoint?: string,
  providedSourcePkh?: string
): Promise<V0DiscoveryResult> {
  await ensureWasmInitialized();
  const effectiveEndpoint = (
    grpcEndpoint && grpcEndpoint.trim().length > 0 ? grpcEndpoint : await getEffectiveRpcEndpoint()
  ).trim();
  const normalizedEndpoint = /^https?:\/\//i.test(effectiveEndpoint)
    ? effectiveEndpoint
    : `https://${effectiveEndpoint || RPC_ENDPOINT}`;
  const grpcClient = new wasm.GrpcClient(normalizedEndpoint);
  const balance = await grpcClient.getBalanceByAddress(sourceAddress);

  const v0NotesProtobuf: any[] = [];
  let totalNicks = 0n;

  for (const entry of balance.notes ?? []) {
    if (!entry?.note?.note_version || !('Legacy' in entry.note.note_version) || !entry.note) {
      continue;
    }

    const parsed = wasm.note_from_protobuf(entry.note);
    if (!isNoteV0(parsed)) {
      continue;
    }

    totalNicks += BigInt(parsed.assets);
    v0NotesProtobuf.push(entry.note);
  }

  let sourcePkh = providedSourcePkh;
  if (!sourcePkh) {
    const pkBytes = base58.decode(sourceAddress);
    if (pkBytes.length !== 97) {
      throw new Error('Invalid legacy address: expected bare pubkey (97 bytes)');
    }
    sourcePkh = wasm.hashPublicKey(Uint8Array.from(pkBytes));
  }

  return {
    sourceAddress,
    sourcePkh,
    v0NotesProtobuf,
    totalNicks: totalNicks.toString(),
    totalNock: Number(totalNicks) / NOCK_TO_NICKS,
  };
}

export async function buildV0MigrationTransactionFromNotes(
  v0NotesProtobuf: any[],
  sourceV0Pkh: string,
  targetV1Pkh: string,
  feePerWord: string = DEFAULT_FEE_PER_WORD
): Promise<BuiltV0MigrationResult> {
  await ensureWasmInitialized();

  if (!v0NotesProtobuf.length) {
    throw new Error('No v0 notes available for migration');
  }

  const sourceSpendCondition = [{ Pkh: { m: 1, hashes: [sourceV0Pkh] } }];
  const settings: TxEngineSettings = {
    tx_engine_version: 1 as any,
    tx_engine_patch: 0 as any,
    min_fee: '256',
    cost_per_word: feePerWord,
    witness_word_div: 1,
  };
  const builder = new wasm.TxBuilder(settings);

  const candidates: Array<{ note: any; assets: bigint }> = [];
  for (const notePb of v0NotesProtobuf) {
    const parsed = wasm.note_from_protobuf(notePb);
    if (!isNoteV0(parsed)) continue;
    const assets = BigInt(parsed.assets);
    if (assets < MIGRATION_AMOUNT_NICKS) continue;
    candidates.push({ note: parsed, assets });
  }

  if (!candidates.length) {
    throw new Error('No v0 note is large enough to migrate 200 NOCK.');
  }

  let selected = candidates[0];
  for (const candidate of candidates) {
    const currentDiff = selected.assets > TARGET_NOTE_NICKS
      ? selected.assets - TARGET_NOTE_NICKS
      : TARGET_NOTE_NICKS - selected.assets;
    const nextDiff = candidate.assets > TARGET_NOTE_NICKS
      ? candidate.assets - TARGET_NOTE_NICKS
      : TARGET_NOTE_NICKS - candidate.assets;
    if (nextDiff < currentDiff) {
      selected = candidate;
    }
  }

  const feeNicksBigInt = selected.assets - MIGRATION_AMOUNT_NICKS;
  const recipientDigest = wasm.hex_to_digest(targetV1Pkh);
  const refundDigest = wasm.hex_to_digest(targetV1Pkh);

  builder.simpleSpend(
    [selected.note],
    [sourceSpendCondition],
    recipientDigest,
    MIGRATION_AMOUNT_NICKS.toString(),
    feeNicksBigInt.toString(),
    refundDigest,
    false
  );

  const feeNicks = feeNicksBigInt.toString();
  const transaction = builder.build();
  const txNotes = builder.allNotes();
  const rawTx = {
    version: 1,
    id: transaction.id,
    spends: transaction.spends,
  };

  return {
    txId: transaction.id,
    feeNicks,
    feeNock: Number(feeNicksBigInt) / NOCK_TO_NICKS,
    migratedNicks: MIGRATION_AMOUNT_NICKS.toString(),
    migratedNock: Number(MIGRATION_AMOUNT_NICKS) / NOCK_TO_NICKS,
    selectedNoteNicks: selected.assets.toString(),
    selectedNoteNock: Number(selected.assets) / NOCK_TO_NICKS,
    signRawTxPayload: {
      rawTx,
      notes: (txNotes.notes ?? []).filter((note: unknown) => isNoteV0(note)),
      spendConditions: txNotes.spend_conditions ?? [],
    },
  };
}

export async function signAndBroadcastV0MigrationTransaction(params: {
  rawTx: any;
  notes: any[];
  spendConditions: any[];
}): Promise<{ txId: string }> {
  await ensureWasmInitialized();
  const signingMnemonic = getV0MigrationSigningMnemonic();
  const masterKey = wasm.deriveMasterKeyFromMnemonic(signingMnemonic, '');

  if (!masterKey.privateKey) {
    masterKey.free();
    throw new Error('Cannot sign migration transaction: private key unavailable');
  }

  try {
    const irisRawTx = toRawTx(params.rawTx);
    const irisNotes = (params.notes || []).map(note => toNote(note));
    const irisSpendConditions = (params.spendConditions || []) as any[];

    const builder = wasm.TxBuilder.fromTx(
      irisRawTx,
      irisNotes,
      irisSpendConditions,
      txEngineSettings()
    );
    const signingKeyBytes = new Uint8Array(masterKey.privateKey.slice(0, 32));
    builder.sign(signingKeyBytes);
    builder.validate();

    const signedTx = builder.build();
    const rawSignedTx = wasm.nockchainTxToRaw(signedTx) as any;
    const protobufTx = wasm.rawTxToProtobuf(rawSignedTx);

    const endpoint = await getEffectiveRpcEndpoint();
    const rpcClient = createBrowserClient(endpoint);
    await rpcClient.sendTransaction(protobufTx);

    return { txId: signedTx.id };
  } finally {
    masterKey.free();
  }
}
