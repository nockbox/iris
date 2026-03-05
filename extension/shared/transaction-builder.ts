/**
 * Transaction Builder
 * High-level API for constructing Nockchain transactions
 */

import wasm from './sdk-wasm.js';
import type { Nicks } from './currency.js';
import { publicKeyToPKHDigest } from './address-encoding.js';
import { base58 } from '@scure/base';
import { getEffectiveRpcConfig, getTxEngineSettingsForHeight } from './rpc-config.js';
import { ensureWasmInitialized } from './wasm-utils.js';
import {
  createSimplePkhCondition,
  createPkhCoinbaseCondition,
  createPkhRelativeTimelockCondition,
  createPkhAbsoluteTimelockCondition,
} from './spend-conditions.js';
import { firstNameFromCondition } from './first-name-derivation.js';

type SpendConditionLike = wasm.SpendCondition;
function noteFromProtobuf(protoNote: any): any {
  return wasm.noteFromProtobuf(protoNote);
}

async function createTxBuilder(blockHeight?: number): Promise<wasm.TxBuilder> {
  const height = blockHeight ?? 0;
  const settings = await getTxEngineSettingsForHeight(height);
  return new wasm.TxBuilder(settings);
}

function getFeeFromBuilder(builder: wasm.TxBuilder): number {
  return Number(builder.calcFee());
}

function getTxIdCompat(nockchainTx: wasm.NockchainTx): string {
  return nockchainTx.id;
}

function isSpendConditionList(
  value: wasm.SpendCondition | wasm.SpendCondition[]
): value is wasm.SpendCondition[] {
  return Array.isArray(value) && value.length > 0 && Array.isArray(value[0]);
}

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

  const config = await getEffectiveRpcConfig();
  const timelock = config.coinbaseTimelockBlocks ?? 100;
  const timelockBigInt = BigInt(timelock);

  const candidates: Array<{ name: string; condition: SpendConditionLike }> = [];

  // 1) PKH only (standard simple note)
  try {
    const condition = createSimplePkhCondition(senderPKH);
    candidates.push({ name: 'PKH-only', condition });
  } catch (e) {
    console.warn('[TxBuilder] Failed to create PKH-only condition:', e);
  }

  // 2) PKH ∧ TIM (coinbase helper)
  try {
    const condition = createPkhCoinbaseCondition(senderPKH, timelock);
    candidates.push({ name: 'PKH+TIM(coinbase)', condition });
  } catch (e) {
    console.warn('[TxBuilder] Failed to create PKH+TIM(coinbase) condition:', e);
  }

  // 3) PKH ∧ TIM (relative blocks - common coinbase maturity)
  try {
    const condition = createPkhRelativeTimelockCondition(senderPKH, timelockBigInt);
    candidates.push({ name: `PKH+TIM(rel:${timelock})`, condition });
  } catch (e) {
    console.warn('[TxBuilder] Failed to create PKH+TIM(rel) condition:', e);
  }

  // 4) PKH ∧ TIM (absolute = originPage + timelock)
  try {
    const absMin = BigInt(note.originPage) + timelockBigInt;
    const condition = createPkhAbsoluteTimelockCondition(senderPKH, absMin);
    candidates.push({ name: `PKH+TIM(abs:origin+${timelock})`, condition });
  } catch (e) {
    console.warn('[TxBuilder] Failed to create PKH+TIM(abs) condition:', e);
  }

  // Find the candidate whose first-name matches note.nameFirst
  for (const candidate of candidates) {
    const derivedFirstName = firstNameFromCondition(candidate.condition);
    if (derivedFirstName === note.nameFirst) {
      return candidate.condition as wasm.SpendCondition;
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
  /** Amount to send in nicks (WASM Nicks = string) */
  amount: Nicks;
  /** Transaction fee override in nicks (WASM Nicks = string) */
  fee?: Nicks;
  /** Your PKH for receiving change (as digest string) */
  refundPKH: string;
  /** Private key for signing (32 bytes) */
  privateKey: wasm.PrivateKey;
  /** Whether to include lock data or not */
  includeLockData: boolean;
  /** Current block height (for tx engine selection by activation height). If omitted, uses tx-engine-1. */
  blockHeight?: number;
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
  nockchainTx: wasm.NockchainTx;
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
    blockHeight,
  } = params;

  // Validate inputs
  if (notes.length === 0) {
    throw new Error('At least one note (UTXO) is required');
  }

  // Calculate total available from notes
  const totalAvailable = notes.reduce((sum, note) => sum + note.assets, 0);
  const amountNum = Number(amount);
  const feeNum = fee !== undefined ? Number(fee) : 0;

  if (totalAvailable < amountNum + feeNum) {
    throw new Error(
      `Insufficient funds: have ${totalAvailable} nicks, need ${amountNum + feeNum} (${amount} amount + ${fee ?? '0'} fee)`
    );
  }

  // Convert notes using Note.fromProtobuf() to preserve correct NoteData
  const wasmNotes = notes.map(note => {
    if (!note.protoNote) {
      throw new Error(
        'Note missing protoNote - cannot build transaction. RPC must provide full note data.'
      );
    }
    return noteFromProtobuf(note.protoNote);
  });

  // Create transaction builder with PKH digests (builder computes lock-roots)
  // include_lock_data: false keeps note-data empty (0.5 NOCK fee component)
  // Each note needs its own spend condition (array of conditions, one per note)
  const spendConditions = Array.isArray(spendCondition)
    ? isSpendConditionList(spendCondition)
      ? spendCondition // Use provided array (one per note)
      : notes.map(() => spendCondition) // Single condition applied to all notes
    : notes.map(() => spendCondition); // Single condition applied to all notes

  if (spendConditions.length !== notes.length) {
    throw new Error(
      `Spend condition count mismatch: ${spendConditions.length} conditions for ${notes.length} notes`
    );
  }

  // New WASM API: constructor takes fee_per_word; blockHeight selects tx engine by activation height
  const builder = await createTxBuilder(blockHeight);

  // New API: Nicks values are strings and digest values are strings.
  builder.simpleSpend(
    wasmNotes,
    spendConditions,
    recipientPKH,
    amount,
    fee ?? null,
    refundPKH,
    includeLockData
  );

  // Sign and validate the transaction
  await builder.sign(privateKey);
  builder.validate();

  // Get the fee before building (for return value)
  const feeUsed = getFeeFromBuilder(builder);

  // Build the final transaction
  const nockchainTx = builder.build();

  return {
    txId: getTxIdCompat(nockchainTx),
    version: 1, // V1 only
    nockchainTx,
    feeUsed,
  };
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
 * @param privateKey - Your private key (wasm object)
 * @param fee - Transaction fee in nicks (optional, WASM will auto-calculate if not provided)
 * @param refundPKH - Override for change address (optional, defaults to sender's PKH).
 *                    Set to recipientPKH for "send max" to sweep all funds to recipient.
 * @param blockHeight - Current block height for tx engine selection (optional).
 * @returns Constructed transaction
 */
export async function buildMultiNotePayment(
  notes: Note[],
  recipientPKH: string,
  amount: Nicks,
  senderPublicKey: Uint8Array,
  privateKey: wasm.PrivateKey,
  fee?: Nicks,
  refundPKH?: string,
  blockHeight?: number
): Promise<ConstructedTransaction> {
  // Initialize WASM
  await ensureWasmInitialized();

  if (notes.length === 0) {
    throw new Error('At least one note is required');
  }

  // Calculate total available from all notes
  const totalAvailable = notes.reduce((sum, note) => sum + note.assets, 0);
  const totalNeeded = Number(amount) + Number(fee || '0');

  if (totalAvailable < totalNeeded) {
    throw new Error(
      `Insufficient funds: have ${totalAvailable} nicks across ${notes.length} notes, need ${totalNeeded}`
    );
  }

  // Create sender's PKH digest string for change
  const senderPKH = publicKeyToPKHDigest(senderPublicKey);

  // Discover the correct spend condition for each note
  // Each note may have different spend conditions (e.g., some are coinbase with timelocks)
  const spendConditions: SpendConditionLike[] = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const spendCondition = await discoverSpendConditionForNote(senderPKH, {
      nameFirst: note.nameFirst,
      originPage: note.originPage,
    });

    // Sanity check: verify the derived first-name matches
    const derivedFirstName = firstNameFromCondition(spendCondition);
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
    blockHeight,
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
  return createSimplePkhCondition(pkhDigest) as wasm.SpendCondition;
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

  return base58.decode(wasm.spendConditionHash(spendCondition));
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
