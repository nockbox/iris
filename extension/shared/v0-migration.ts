import { base58 } from '@scure/base';
import { NOCK_TO_NICKS, RPC_ENDPOINT } from './constants';
import { ensureWasmInitialized } from './wasm-utils';
import { wasm } from './sdk-wasm';
import type { TxEngineSettings } from '@nockbox/iris-sdk/wasm';
import { getEffectiveRpcEndpoint } from './rpc-config';
import { createBrowserClient } from './rpc-client-browser';

const DEFAULT_FEE_PER_WORD = '32768';
/** Chain minimum fee (nicks) per docs: fee = max(256, word_count × 32768). */
const CHAIN_MIN_FEE_NICKS = '256';

/** Hardcoded note to use for v0 migration (name.first, name.last). */
const HARDCODED_NOTE_FIRST = '71JNQqthZQp2ZJgHFy7xn3r3tPtt9Vp2ga1xybPPHGboDTwB2EwYLMN';
const HARDCODED_NOTE_LAST = '3VrzrLjtRatrFTPoeKoA38HaPKQ7KSWapXP1T4WcZ8wwnas21Wkcdmx';
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

function buildSinglePkhSpendCondition(pkh: string): any[] {
  return [{ Pkh: { m: 1, hashes: [pkh] } }];
}

function txEngineSettings(): any {
  return {
    tx_engine_version: 1,
    tx_engine_patch: 0,
    min_fee: CHAIN_MIN_FEE_NICKS,
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
  feePerWord: string = DEFAULT_FEE_PER_WORD,
  /** Optional minimum fee override (nicks). When set, fee = max(override, word-based). Use for priority. */
  minFeeOverrideNicks?: string
): Promise<BuiltV0MigrationResult> {
  await ensureWasmInitialized();

  if (!v0NotesProtobuf.length) {
    throw new Error('No v0 notes available for migration');
  }

  const minFee =
    minFeeOverrideNicks && BigInt(minFeeOverrideNicks) >= BigInt(CHAIN_MIN_FEE_NICKS)
      ? minFeeOverrideNicks
      : CHAIN_MIN_FEE_NICKS;

  const settings: TxEngineSettings = {
    tx_engine_version: 1 as any,
    tx_engine_patch: 0 as any,
    min_fee: minFee,
    cost_per_word: feePerWord,
    witness_word_div: 1,
  } as any;
  const builder = new wasm.TxBuilder(settings);

  const candidates: Array<{ note: any; assets: bigint }> = [];
  for (const notePb of v0NotesProtobuf) {
    const parsed = wasm.note_from_protobuf(notePb);
    if (!isNoteV0(parsed)) continue;
    const assets = BigInt(parsed.assets);
    if (assets < BigInt(CHAIN_MIN_FEE_NICKS)) continue;
    candidates.push({ note: parsed, assets });
  }

  if (!candidates.length) {
    throw new Error(`No v0 note has at least ${CHAIN_MIN_FEE_NICKS} nicks to cover the fee.`);
  }

  // Prefer hardcoded note if present; otherwise pick smallest (SDK-style: SpendBuilder + computeRefund)
  // IMPORTANT: We use exactly ONE note, never all notes.
  const hardcoded = candidates.find(
    c =>
      (c.note as any).name?.first === HARDCODED_NOTE_FIRST &&
      (c.note as any).name?.last === HARDCODED_NOTE_LAST
  );
  const selected = hardcoded ?? candidates.reduce((a, b) => (a.assets < b.assets ? a : b));

  console.log('[V0 Migration] build: using single note only', {
    candidatesCount: candidates.length,
    notesUsed: 1,
    selectedNoteNicks: selected.assets.toString(),
    selection: hardcoded ? 'hardcoded' : 'smallest',
  });

  const targetSpendCondition = buildSinglePkhSpendCondition(targetV1Pkh);
  const spendBuilder = new wasm.SpendBuilder(selected.note, null, targetSpendCondition);
  spendBuilder.computeRefund(false);
  builder.spend(spendBuilder);

  builder.recalcAndSetFee(false);
  const feeResult = builder.calcFee();
  const feeNicks = feeResult;
  const transaction = builder.build();
  const txNotes = builder.allNotes();
  const rawTx = {
    version: 1,
    id: transaction.id,
    spends: transaction.spends,
  };

  const feeNicksBigInt = BigInt(feeNicks);
  const giftNicks = selected.assets - feeNicksBigInt;

  if (giftNicks < 0n) {
    throw new Error(
      `Selected note (${selected.assets} nicks) cannot cover the fee (${feeNicks} nicks). Try a larger note.`
    );
  }

  const spendCount = Array.isArray(transaction.spends) ? transaction.spends.length : 0;
  if (spendCount !== 1) {
    throw new Error(`V0 migration must use exactly 1 note, got ${spendCount} spends`);
  }

  return {
    txId: transaction.id,
    feeNicks,
    feeNock: Number(feeNicksBigInt) / NOCK_TO_NICKS,
    migratedNicks: giftNicks.toString(),
    migratedNock: Number(giftNicks) / NOCK_TO_NICKS,
    selectedNoteNicks: selected.assets.toString(),
    selectedNoteNock: Number(selected.assets) / NOCK_TO_NICKS,
    signRawTxPayload: {
      rawTx,
      notes: (txNotes.notes ?? []).filter((note: unknown) => isNoteV0(note)),
      spendConditions:
        txNotes.spend_conditions && txNotes.spend_conditions.length > 0
          ? txNotes.spend_conditions
          : [buildSinglePkhSpendCondition(sourceV0Pkh)],
    },
  };
}

export async function signAndBroadcastV0MigrationTransaction(params: {
  rawTx: any;
  notes: any[];
  spendConditions: any[];
}): Promise<{ txId: string; accepted: boolean }> {
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
    console.log('[V0 Migration] pre-sign payload', {
      notesCount: irisNotes.length,
      spendConditionsCount: irisSpendConditions.length,
      spendConditionKinds: irisSpendConditions.map((condition: any, idx: number) => {
        const first = Array.isArray(condition) ? condition[0] : condition?.primitives?.[0]?.primitive;
        if (!first) return `#${idx}:unknown`;
        if (first.Pkh) return `#${idx}:Pkh`;
        if (first.Tim) return `#${idx}:Tim`;
        if (first.Hax) return `#${idx}:Hax`;
        if (first.Burn || first.Brn) return `#${idx}:Brn`;
        return `#${idx}:other`;
      }),
      rawTxId: params.rawTx?.id,
    });

    let builder: any;
    try {
      builder = wasm.TxBuilder.fromTx(irisRawTx, irisNotes, irisSpendConditions, txEngineSettings());
      const signingKeyBytes = new Uint8Array(masterKey.privateKey.slice(0, 32));
      builder.sign(signingKeyBytes);
      builder.validate();

      const signedTx = builder.build();
      const rawSignedTx = wasm.nockchainTxToRaw(signedTx) as any;
      const protobufTx = wasm.rawTxToProtobuf(rawSignedTx);

      // Use protobuf id - it's serialized as base58 (matches RPC expectation)
      // signedTx.id / rawSignedTx.id may be in a different format
      const txId = protobufTx?.id ?? signedTx.id;
      console.log('[V0 Migration] signed transaction', {
        txIdFromProtobuf: protobufTx?.id,
        txIdFromSignedTx: signedTx.id,
        rawSignedTxId: rawSignedTx?.id,
        txIdUsed: txId,
      });

      const endpoint = await getEffectiveRpcEndpoint();
      const rpcClient = createBrowserClient(endpoint);
      await rpcClient.sendTransaction(protobufTx);
      const accepted = await rpcClient.isTransactionAccepted(txId);
      return { txId, accepted };
    } catch (error) {
      console.error('[V0 Migration] sign/broadcast failed', {
        error: error instanceof Error ? error.message : String(error),
        notesCount: irisNotes.length,
        spendConditionsCount: irisSpendConditions.length,
        rawTxId: params.rawTx?.id,
      });
      throw error;
    } finally {
      builder?.free?.();
    }
  } finally {
    masterKey.free();
  }
}
