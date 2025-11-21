/**
 * Transaction Builder
 * High-level API for constructing Nockchain transactions
 */

import {
  WasmTxBuilder,
  WasmNote,
  WasmDigest,
  WasmPkh,
  WasmSpendCondition,
  WasmRawTx,
  WasmLockPrimitive,
  WasmLockTim,
  WasmTimelockRange,
} from '../lib/nbx-wasm/nbx_wasm.js';
import { publicKeyToPKHDigest } from './address-encoding.js';
import { base58 } from '@scure/base';
import { NOCK_TO_NICKS } from './constants.js';
import { ensureWasmInitialized } from './wasm-utils.js';

/**
 * Discover the correct spend condition for a note by matching lock-root to name.first
 *
 * The note's name.first commits to the lock-root (Merkle root of spend condition).
 * We try different candidate spend conditions and find which one matches.
 *
 * @param senderPKH - Base58 PKH digest of the sender's public key
 * @param note - Note with nameFirst (lock-root) and originPage
 * @returns The matching WasmSpendCondition
 */
export async function discoverSpendConditionForNote(
  senderPKH: string,
  note: { nameFirst: string; originPage: number }
): Promise<WasmSpendCondition> {
  await ensureWasmInitialized();

  const candidates: Array<{ name: string; condition: WasmSpendCondition }> = [];

  console.log(
    '[TxBuilder] Trying to match lock-root against name.first:',
    note.nameFirst.slice(0, 20) + '...'
  );

  // 1) PKH only (standard simple note)
  try {
    const pkhLeaf = WasmLockPrimitive.newPkh(WasmPkh.single(senderPKH));
    const condition = new WasmSpendCondition([pkhLeaf]);
    candidates.push({ name: 'PKH-only', condition });
  } catch (e) {
    console.warn('[TxBuilder] Failed to create PKH-only condition:', e);
  }

  // 2) PKH ∧ TIM (coinbase helper)
  try {
    const pkhLeaf = WasmLockPrimitive.newPkh(WasmPkh.single(senderPKH));
    const timLeaf = WasmLockPrimitive.newTim(WasmLockTim.coinbase());
    const condition = new WasmSpendCondition([pkhLeaf, timLeaf]);
    candidates.push({ name: 'PKH+TIM(coinbase)', condition });
  } catch (e) {
    console.warn('[TxBuilder] Failed to create PKH+TIM(coinbase) condition:', e);
  }

  // 3) PKH ∧ TIM (relative 100 blocks - common coinbase maturity)
  try {
    const pkhLeaf = WasmLockPrimitive.newPkh(WasmPkh.single(senderPKH));
    const timLeaf = WasmLockPrimitive.newTim(
      new WasmLockTim(new WasmTimelockRange(100n, null), new WasmTimelockRange(null, null))
    );
    const condition = new WasmSpendCondition([pkhLeaf, timLeaf]);
    candidates.push({ name: 'PKH+TIM(rel:100)', condition });
  } catch (e) {
    console.warn('[TxBuilder] Failed to create PKH+TIM(rel:100) condition:', e);
  }

  // 4) PKH ∧ TIM (absolute = originPage + 100)
  try {
    const absMin = BigInt(note.originPage) + 100n;
    const pkhLeaf = WasmLockPrimitive.newPkh(WasmPkh.single(senderPKH));
    const timLeaf = WasmLockPrimitive.newTim(
      new WasmLockTim(new WasmTimelockRange(null, null), new WasmTimelockRange(absMin, null))
    );
    const condition = new WasmSpendCondition([pkhLeaf, timLeaf]);
    candidates.push({ name: 'PKH+TIM(abs:origin+100)', condition });
  } catch (e) {
    console.warn('[TxBuilder] Failed to create PKH+TIM(abs:origin+100) condition:', e);
  }

  console.log(`[TxBuilder] Successfully created ${candidates.length} candidate conditions`);

  // Find the candidate whose first-name matches note.nameFirst
  // The note's name.first is derived from the spend condition
  for (const candidate of candidates) {
    const lockRoot = candidate.condition.hash().value;
    // Get the first-name directly from the spend condition
    const derivedFirstName = candidate.condition.firstName().value;

    console.log(`[TxBuilder] Candidate ${candidate.name}:`);
    console.log(`  Lock-root: ${lockRoot.slice(0, 20)}...`);
    console.log(`  First-name: ${derivedFirstName.slice(0, 20)}...`);

    if (derivedFirstName === note.nameFirst) {
      console.log(`[TxBuilder]  MATCH! Using spend condition: ${candidate.name}`);
      return candidate.condition;
    }
  }

  throw new Error(
    `No matching spend condition for note.name.first (${note.nameFirst.slice(0, 20)}...). ` +
      `Cannot spend this UTXO. It may require a different lock configuration.`
  );
}

/**
 * Note data in V1 WASM format
 */
export interface Note {
  originPage: number;
  nameFirst: string; // base58 digest string
  nameLast: string; // base58 digest string
  noteDataHash: string; // base58 digest string
  assets: number;
  protoNote?: any; // Raw protobuf note for WasmNote.fromProtobuf()
}

/**
 * Transaction parameters for new builder API
 */
export interface TransactionParams {
  /** Notes (UTXOs) to spend */
  notes: Note[];
  /** Spend condition (determines who can unlock the notes) */
  spendCondition: WasmSpendCondition;
  /** Recipient's PKH as digest string */
  recipientPKH: string;
  /** Amount to send in nicks */
  amount: number;
  /** Transaction fee override in nicks */
  fee?: number;
  /** Your PKH for receiving change (as digest string) */
  refundPKH: string;
  /** Private key for signing (32 bytes) */
  privateKey: Uint8Array;
  /** Whether to include lock data or not */
  includeLockData: boolean;
}

/**
 * Constructed transaction ready for broadcast
 */
export interface ConstructedTransaction {
  /** Transaction ID as digest string */
  txId: string;
  /** Transaction version */
  version: number;
  /** Raw transaction object (for additional operations) */
  rawTx: WasmRawTx;
}

/**
 * Build a complete Nockchain transaction using the new builder API
 *
 * @param params - Transaction parameters
 * @returns Constructed transaction ready for broadcast
 */
export async function buildTransaction(params: TransactionParams): Promise<ConstructedTransaction> {
  // Initialize both WASM modules
  await ensureWasmInitialized();

  const { notes, spendCondition, recipientPKH, amount, fee, refundPKH, privateKey, includeLockData } = params;

  // Validate inputs
  if (notes.length === 0) {
    throw new Error('At least one note (UTXO) is required');
  }
  if (privateKey.length !== 32) {
    throw new Error('Private key must be 32 bytes');
  }

  // Calculate total available from notes
  const totalAvailable = notes.reduce((sum, note) => sum + note.assets, 0);

  if (totalAvailable < amount + (fee || 0)) {
    throw new Error(
      `Insufficient funds: have ${totalAvailable} nicks, need ${amount + (fee || 0)} (${amount} amount + ${fee} fee)`
    );
  }

  // Convert notes using WasmNote.fromProtobuf() to preserve correct NoteData
  const wasmNotes = notes.map(note => {
    if (!note.protoNote) {
      throw new Error(
        'Note missing protoNote - cannot build transaction. RPC must provide full note data.'
      );
    }

    console.log('[TxBuilder] Creating WasmNote from protobuf with:', {
      version: 'V1',
      originPage: note.originPage,
      assets: note.assets,
      hasProtoNote: !!note.protoNote,
    });

    // Use fromProtobuf to correctly deserialize NoteData entries
    // This ensures parent_hash is computed correctly
    return WasmNote.fromProtobuf(note.protoNote);
  });

  console.log('[TxBuilder] Creating transaction with:', {
    inputCount: wasmNotes.length,
    recipientPKH: recipientPKH.slice(0, 20) + '...',
    amount,
    fee,
    refundPKH: refundPKH.slice(0, 20) + '...',
    includeLockData,
  });

  // Create transaction builder with PKH digests (builder computes lock-roots)
  // include_lock_data: false keeps note-data empty (0.5 NOCK fee component)
  // Each note needs its own spend condition (array of conditions, one per note)
  const spendConditions = notes.map(() => spendCondition);
  const builder = new WasmTxBuilder(BigInt(1 << 15));

  builder.simpleSpend(
    wasmNotes,
    spendConditions,
    new WasmDigest(recipientPKH),
    BigInt(amount), // gift
    fee !== undefined ? BigInt(fee) : null,
    new WasmDigest(refundPKH),
    includeLockData,
  );

  console.log('[TxBuilder] Signing transaction...');

  // Sign the transaction
  console.log(builder.curFee());
  console.log(builder.calcFee());
  builder.sign(privateKey);
  console.log(builder.curFee());
  console.log(builder.calcFee());
  builder.validate();
  const rawTx = builder.build();

  console.log('[TxBuilder]  Transaction signed, txId:', rawTx.id.value);

  // DEBUG: Log parent_hash from seeds to diagnose rejection
  try {
    const pbTx = rawTx.toProtobuf();
    console.log('[TxBuilder]  DEBUG: Inspecting transaction seeds...');
    console.log(pbTx);
    // Try to access seeds if available (rawTx is WASM object with potentially hidden properties)
    const rawTxAny = rawTx as any;
    if (rawTxAny.seeds && Array.isArray(rawTxAny.seeds)) {
      console.log('[TxBuilder] Seeds count:', rawTxAny.seeds.length);
      rawTxAny.seeds.forEach((seed: any, i: number) => {
        console.log(`[TxBuilder] Seed ${i}:`, {
          parent_hash: seed.parent_hash?.value
            ? seed.parent_hash.value.slice(0, 30) + '...'
            : 'N/A',
          lock_root: seed.lock_root?.value ? seed.lock_root.value.slice(0, 30) + '...' : 'N/A',
        });
      });
    } else {
      console.log('[TxBuilder]   Seeds not directly accessible on rawTx');
    }
  } catch (e) {
    console.log('[TxBuilder]   Could not inspect seeds:', e);
  }

  // DEBUG: Log the note data that was used to build this transaction
  console.log('[TxBuilder]  DEBUG: Input notes used for transaction:');
  notes.forEach((note, i) => {
    console.log(`[TxBuilder] Input ${i}:`, {
      originPage: note.originPage,
      nameFirst: note.nameFirst.slice(0, 30) + '...',
      nameLast: note.nameLast.slice(0, 30) + '...',
      noteDataHash: note.noteDataHash.slice(0, 30) + '...',
      assets: note.assets,
    });
    console.log(
      `[TxBuilder] The parent_hash in seeds should equal hash(Note) where Note contains these fields`
    );
    console.log(
      `[TxBuilder]   If parent_hash doesn't match the blockchain's stored note hash, TX will be REJECTED`
    );
  });

  return {
    txId: rawTx.id.value,
    version: 1, // V1 only
    rawTx,
  };
}

/**
 * Create a simple payment transaction (single recipient)
 *
 * This is a convenience wrapper around buildTransaction for the common case
 * of sending a payment to one recipient with change back to yourself.
 *
 * @param note - UTXO to spend
 * @param recipientPKH - Recipient's PKH digest string
 * @param amount - Amount to send in nicks
 * @param senderPublicKey - Your public key (97 bytes, for creating spend condition)
 * @param fee - Transaction fee in nicks
 * @param privateKey - Your private key (32 bytes)
 * @returns Constructed transaction
 */
export async function buildPayment(
  note: Note,
  recipientPKH: string,
  amount: number,
  senderPublicKey: Uint8Array,
  privateKey: Uint8Array,
  fee?: number,
): Promise<ConstructedTransaction> {
  // Initialize WASM
  await ensureWasmInitialized();

  const totalNeeded = amount + (fee || 0);

  if (note.assets < totalNeeded) {
    throw new Error(`Insufficient funds in note: have ${note.assets} nicks, need ${totalNeeded}`);
  }

  // Create sender's PKH digest string for change
  const senderPKH = publicKeyToPKHDigest(senderPublicKey);

  // Discover the correct spend condition by matching lock-root to note.nameFirst
  // the spend condition MUST match what was locked on the note
  const spendCondition = await discoverSpendConditionForNote(senderPKH, {
    nameFirst: note.nameFirst,
    originPage: note.originPage,
  });

  // Sanity check: verify the derived first-name matches
  const derivedFirstName = spendCondition.firstName().value;
  if (derivedFirstName !== note.nameFirst) {
    throw new Error(
      `First-name mismatch! Computed: ${derivedFirstName.slice(0, 20)}..., ` +
        `Expected: ${note.nameFirst.slice(0, 20)}...`
    );
  }

  console.log('[TxBuilder]  Spend condition verified, building transaction...');

  return buildTransaction({
    notes: [note],
    spendCondition,
    recipientPKH,
    amount,
    fee,
    refundPKH: senderPKH,
    privateKey,
     // include_lock_data: false for empty note-data (lower fee)
    includeLockData: false,
  });
}

/**
 * Create a spend condition for a single public key
 * Helper function for the common case
 *
 * @param publicKey - The 97-byte public key
 * @returns WasmSpendCondition for this public key
 */
export async function createSinglePKHSpendCondition(
  publicKey: Uint8Array
): Promise<WasmSpendCondition> {
  await ensureWasmInitialized();

  const pkhDigest = publicKeyToPKHDigest(publicKey);
  const pkh = WasmPkh.single(pkhDigest);
  return WasmSpendCondition.newPkh(pkh);
}

/**
 * Calculate the note data hash for a given spend condition
 * This is needed when converting legacy notes to new format
 *
 * @param spendCondition - The spend condition
 * @returns The note data hash as 40-byte digest
 */
export async function calculateNoteDataHash(
  spendCondition: WasmSpendCondition
): Promise<Uint8Array> {
  await ensureWasmInitialized();

  const hashDigest = spendCondition.hash();
  // The digest value is already a base58 string, decode it to bytes
  return base58.decode(hashDigest.value);
}

/**
 * Estimate transaction size in bytes (for fee estimation)
 * This is a rough estimate - actual size depends on serialization format
 *
 * @param inputCount - Number of inputs
 * @param outputCount - Number of outputs
 * @returns Estimated size in bytes
 */
export function estimateTransactionSize(inputCount: number, outputCount: number): number {
  // Rough estimates based on typical sizes:
  // - Each input: ~200 bytes (note data + signature)
  // - Each output: ~150 bytes (seed data)
  // - Transaction overhead: ~100 bytes
  return 100 + inputCount * 200 + outputCount * 150;
}

/**
 * Calculate recommended fee based on transaction size
 *
 * @param inputCount - Number of inputs
 * @param outputCount - Number of outputs
 * @param feePerByte - Fee per byte in nicks (default: 1 nick/byte)
 * @returns Recommended fee in nicks
 */
export function calculateRecommendedFee(
  inputCount: number,
  outputCount: number,
  feePerByte: number = 1
): number {
  const size = estimateTransactionSize(inputCount, outputCount);
  return size * feePerByte;
}
