/**
 * Transaction Builder
 * High-level API for constructing Nockchain transactions
 */

import * as wasm from '@nockbox/iris-wasm/iris_wasm.js';
import { publicKeyToPKHDigest } from './address-encoding.js';
import { base58 } from '@scure/base';
import { DEFAULT_FEE_PER_WORD } from './constants.js';
import { ensureWasmInitialized } from './wasm-utils.js';

/**
 * Discover the correct spend condition for a note by matching lock-root to name.first
 *
 * The note's name.first commits to the lock-root (Merkle root of spend condition).
 * We try different candidate spend conditions and find which one matches.
 *
 * @param senderPKH - Base58 PKH digest of the sender's public key
 * @param note - Note with nameFirst (lock-root) and originPage
 * @returns The matching SpendCondition
 */
export async function discoverSpendConditionForNote(
  senderPKH: string,
  note: { nameFirst: string; originPage: number }
): Promise<wasm.SpendCondition> {
  await ensureWasmInitialized();

  const candidates: Array<{ name: string; condition: wasm.SpendCondition }> = [];

  // 1) PKH only (standard simple note)
  try {
    const pkhLeaf = wasm.LockPrimitive.newPkh(wasm.Pkh.single(senderPKH));
    const condition = new wasm.SpendCondition([pkhLeaf]);
    candidates.push({ name: 'PKH-only', condition });
  } catch (e) {
    console.warn('[TxBuilder] Failed to create PKH-only condition:', e);
  }

  // 2) PKH ∧ TIM (coinbase helper)
  try {
    const pkhLeaf = wasm.LockPrimitive.newPkh(wasm.Pkh.single(senderPKH));
    const timLeaf = wasm.LockPrimitive.newTim(wasm.LockTim.coinbase());
    const condition = new wasm.SpendCondition([pkhLeaf, timLeaf]);
    candidates.push({ name: 'PKH+TIM(coinbase)', condition });
  } catch (e) {
    console.warn('[TxBuilder] Failed to create PKH+TIM(coinbase) condition:', e);
  }

  // 3) PKH ∧ TIM (relative 100 blocks - common coinbase maturity)
  try {
    const pkhLeaf = wasm.LockPrimitive.newPkh(wasm.Pkh.single(senderPKH));
    const timLeaf = wasm.LockPrimitive.newTim(
      new wasm.LockTim(new wasm.TimelockRange(100n, null), new wasm.TimelockRange(null, null))
    );
    const condition = new wasm.SpendCondition([pkhLeaf, timLeaf]);
    candidates.push({ name: 'PKH+TIM(rel:100)', condition });
  } catch (e) {
    console.warn('[TxBuilder] Failed to create PKH+TIM(rel:100) condition:', e);
  }

  // 4) PKH ∧ TIM (absolute = originPage + 100)
  try {
    const absMin = BigInt(note.originPage) + 100n;
    const pkhLeaf = wasm.LockPrimitive.newPkh(wasm.Pkh.single(senderPKH));
    const timLeaf = wasm.LockPrimitive.newTim(
      new wasm.LockTim(new wasm.TimelockRange(null, null), new wasm.TimelockRange(absMin, null))
    );
    const condition = new wasm.SpendCondition([pkhLeaf, timLeaf]);
    candidates.push({ name: 'PKH+TIM(abs:origin+100)', condition });
  } catch (e) {
    console.warn('[TxBuilder] Failed to create PKH+TIM(abs:origin+100) condition:', e);
  }

  // Find the candidate whose first-name matches note.nameFirst
  for (const candidate of candidates) {
    const derivedFirstName = candidate.condition.firstName().value;
    if (derivedFirstName === note.nameFirst) {
      return candidate.condition;
    }
  }

  throw new Error(
    `No matching spend condition for note.name.first (${note.nameFirst.slice(0, 20)}...). ` +
      `Cannot spend this UTXO. It may require a different lock configuration.`
  );
}

/**
 * Note data in V1 WASM format (local interface for transaction builder)
 */
export interface Note {
  originPage: number;
  nameFirst: string; // base58 digest string
  nameLast: string; // base58 digest string
  noteDataHash: string; // base58 digest string
  assets: number;
  protoNote?: any;
}

/**
 * Transaction parameters for new builder API
 */
export interface TransactionParams {
  /** Notes (UTXOs) to spend */
  notes: Note[];
  /** Spend condition(s) - single condition applied to all notes, or array with one per note */
  spendCondition: wasm.SpendCondition | wasm.SpendCondition[];
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
  nockchainTx: wasm.RawTx;
  /** Fee used in the transaction (in nicks) */
  feeUsed: number;
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

  const {
    notes,
    spendCondition,
    recipientPKH,
    amount,
    fee,
    refundPKH,
    privateKey,
    includeLockData,
  } = params;

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

  // Convert notes using Note.fromProtobuf() to preserve correct NoteData
  const wasmNotes = notes.map(note => {
    if (!note.protoNote) {
      throw new Error(
        'Note missing protoNote - cannot build transaction. RPC must provide full note data.'
      );
    }
    return wasm.Note.fromProtobuf(note.protoNote);
  });

  // Create transaction builder with PKH digests (builder computes lock-roots)
  // include_lock_data: false keeps note-data empty (0.5 NOCK fee component)
  // Each note needs its own spend condition (array of conditions, one per note)
  const spendConditions = Array.isArray(spendCondition)
    ? spendCondition // Use provided array (one per note)
    : notes.map(() => spendCondition); // Single condition applied to all notes

  if (spendConditions.length !== notes.length) {
    throw new Error(
      `Spend condition count mismatch: ${spendConditions.length} conditions for ${notes.length} notes`
    );
  }

  // New WASM API: constructor takes fee_per_word
  const builder = new wasm.TxBuilder(BigInt(DEFAULT_FEE_PER_WORD));

  // simpleSpend now takes fee_override (user-specified fee) instead of fee_per_word
  builder.simpleSpend(
    wasmNotes,
    spendConditions,
    new wasm.Digest(recipientPKH),
    BigInt(amount), // gift
    fee !== undefined ? BigInt(fee) : null, // fee_override (user-specified fee)
    new wasm.Digest(refundPKH),
    includeLockData
  );

  // Sign and validate the transaction
  builder.sign(privateKey);
  builder.validate();

  // Get the fee before building (for return value)
  const feeUsed = Number(builder.curFee());

  // Build the final transaction
  const nockchainTx = builder.build();

  return {
    txId: nockchainTx.id.value,
    version: 1, // V1 only
    nockchainTx,
    feeUsed,
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
  fee?: number
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

  return buildTransaction({
    notes: [note],
    spendCondition,
    recipientPKH,
    amount,
    fee,
    refundPKH: senderPKH,
    privateKey,
    // include_lock_data: false for lower fees (0.5 NOCK per word saved)
    includeLockData: false,
  });
}

/**
 * Create a payment transaction using multiple notes (UTXOs)
 *
 * This allows spending from multiple UTXOs when a single UTXO doesn't have
 * sufficient balance. The transaction will use all provided notes as inputs.
 *
 * @param notes - Array of UTXOs to spend
 * @param recipientPKH - Recipient's PKH digest string
 * @param amount - Amount to send in nicks
 * @param senderPublicKey - Your public key (97 bytes, for creating spend condition)
 * @param privateKey - Your private key (32 bytes)
 * @param fee - Transaction fee in nicks (optional, WASM will auto-calculate if not provided)
 * @param refundPKH - Override for change address (optional, defaults to sender's PKH).
 *                    Set to recipientPKH for "send max" to sweep all funds to recipient.
 * @returns Constructed transaction
 */
export async function buildMultiNotePayment(
  notes: Note[],
  recipientPKH: string,
  amount: number,
  senderPublicKey: Uint8Array,
  privateKey: Uint8Array,
  fee?: number,
  refundPKH?: string
): Promise<ConstructedTransaction> {
  // Initialize WASM
  await ensureWasmInitialized();

  if (notes.length === 0) {
    throw new Error('At least one note is required');
  }

  // Calculate total available from all notes
  const totalAvailable = notes.reduce((sum, note) => sum + note.assets, 0);
  const totalNeeded = amount + (fee || 0);

  if (totalAvailable < totalNeeded) {
    throw new Error(
      `Insufficient funds: have ${totalAvailable} nicks across ${notes.length} notes, need ${totalNeeded}`
    );
  }

  // Create sender's PKH digest string for change
  const senderPKH = publicKeyToPKHDigest(senderPublicKey);

  // Discover the correct spend condition for each note
  // Each note may have different spend conditions (e.g., some are coinbase with timelocks)
  const spendConditions: wasm.SpendCondition[] = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const spendCondition = await discoverSpendConditionForNote(senderPKH, {
      nameFirst: note.nameFirst,
      originPage: note.originPage,
    });

    // Sanity check: verify the derived first-name matches
    const derivedFirstName = spendCondition.firstName().value;
    if (derivedFirstName !== note.nameFirst) {
      throw new Error(
        `First-name mismatch for note ${i}! Computed: ${derivedFirstName.slice(0, 20)}..., ` +
          `Expected: ${note.nameFirst.slice(0, 20)}...`
      );
    }

    spendConditions.push(spendCondition);
  }

  // Use provided refundPKH or default to sender's PKH
  // For "send max", refundPKH = recipientPKH to sweep all funds to recipient
  const changeAddress = refundPKH ?? senderPKH;

  // Build transaction with all notes and their individual spend conditions
  return buildTransaction({
    notes,
    spendCondition: spendConditions, // Array of spend conditions (one per note)
    recipientPKH,
    amount,
    fee,
    refundPKH: changeAddress,
    privateKey,
    // include_lock_data: false for lower fees (0.5 NOCK per word saved)
    includeLockData: false,
  });
}

/**
 * Create a spend condition for a single public key
 * Helper function for the common case
 *
 * @param publicKey - The 97-byte public key
 * @returns SpendCondition for this public key
 */
export async function createSinglePKHSpendCondition(
  publicKey: Uint8Array
): Promise<wasm.SpendCondition> {
  await ensureWasmInitialized();

  const pkhDigest = publicKeyToPKHDigest(publicKey);
  const pkh = wasm.Pkh.single(pkhDigest);
  return wasm.SpendCondition.newPkh(pkh);
}

/**
 * Calculate the note data hash for a given spend condition
 * This is needed when converting legacy notes to new format
 *
 * @param spendCondition - The spend condition
 * @returns The note data hash as 40-byte digest
 */
export async function calculateNoteDataHash(
  spendCondition: wasm.SpendCondition
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
