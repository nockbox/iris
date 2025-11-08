/**
 * Transaction Builder
 * High-level API for constructing Nockchain transactions
 */

import initCryptoWasm from '../lib/nbx-crypto/nbx_crypto.js';
import initTxWasm, {
  WasmTxBuilder,
  WasmNote,
  WasmName,
  WasmDigest,
  WasmVersion,
  WasmPkh,
  WasmSpendCondition,
  WasmRawTx,
} from '../lib/nbx-nockchain-types/nbx_nockchain_types.js';
import { publicKeyToPKHDigest } from './address-encoding.js';

let cryptoWasmInitialized = false;
let txWasmInitialized = false;

/**
 * Ensure crypto WASM is initialized
 */
async function ensureCryptoWasmInit(): Promise<void> {
  if (!cryptoWasmInitialized) {
    const cryptoWasmUrl = chrome.runtime.getURL('lib/nbx-crypto/nbx_crypto_bg.wasm');
    await initCryptoWasm({ module_or_path: cryptoWasmUrl });
    cryptoWasmInitialized = true;
  }
}

/**
 * Ensure transaction WASM is initialized
 */
async function ensureTxWasmInit(): Promise<void> {
  if (!txWasmInitialized) {
    const txWasmUrl = chrome.runtime.getURL('lib/nbx-nockchain-types/nbx_nockchain_types_bg.wasm');
    await initTxWasm({ module_or_path: txWasmUrl });
    txWasmInitialized = true;
  }
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
  /** Transaction fee in nicks */
  fee: number;
  /** Your PKH for receiving change (as digest string) */
  refundPKH: string;
  /** Private key for signing (32 bytes) */
  privateKey: Uint8Array;
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
  await ensureCryptoWasmInit();
  await ensureTxWasmInit();

  const { notes, spendCondition, recipientPKH, amount, fee, refundPKH, privateKey } = params;

  // Validate inputs
  if (notes.length === 0) {
    throw new Error('At least one note (UTXO) is required');
  }
  if (privateKey.length !== 32) {
    throw new Error('Private key must be 32 bytes');
  }

  // Calculate total available from notes
  const totalAvailable = notes.reduce((sum, note) => sum + note.assets, 0);

  if (totalAvailable < amount + fee) {
    throw new Error(
      `Insufficient funds: have ${totalAvailable} nicks, need ${amount + fee} (${amount} amount + ${fee} fee)`
    );
  }

  // Convert notes to WasmNote format (V1 only)
  const wasmNotes = notes.map(note => {
    return new WasmNote(
      WasmVersion.V1(),
      note.originPage,
      new WasmName(note.nameFirst, note.nameLast),
      new WasmDigest(note.noteDataHash),
      note.assets
    );
  });

  // Create transaction builder
  const builder = WasmTxBuilder.newSimple(
    wasmNotes,
    spendCondition,
    new WasmDigest(recipientPKH),
    amount, // gift
    fee,
    new WasmDigest(refundPKH)
  );

  // Sign the transaction
  const rawTx = builder.sign(privateKey);

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
  fee: number,
  privateKey: Uint8Array
): Promise<ConstructedTransaction> {
  // Initialize WASM
  await ensureCryptoWasmInit();
  await ensureTxWasmInit();

  const totalNeeded = amount + fee;

  if (note.assets < totalNeeded) {
    throw new Error(`Insufficient funds in note: have ${note.assets} nicks, need ${totalNeeded}`);
  }

  // Create sender's PKH digest string for change
  const senderPKH = publicKeyToPKHDigest(senderPublicKey);

  // Create spend condition (single PKH)
  const pkh = WasmPkh.single(senderPKH);
  const spendCondition = WasmSpendCondition.newPkh(pkh);

  return buildTransaction({
    notes: [note],
    spendCondition,
    recipientPKH,
    amount,
    fee,
    refundPKH: senderPKH,
    privateKey,
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
  await ensureCryptoWasmInit();
  await ensureTxWasmInit();

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
  await ensureTxWasmInit();

  const hashDigest = spendCondition.hash();
  // The digest value is already a base58 string, decode it to bytes
  const { base58 } = await import('@scure/base');
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
