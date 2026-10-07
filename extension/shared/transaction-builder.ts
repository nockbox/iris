/**
 * Transaction Builder
 * High-level API for constructing Nockchain transactions
 */

import wasm from './sdk-wasm.js';
import type { Nicks } from '@nockbox/iris-sdk/wasm';
import { nicksToBigInt } from './currency.js';
import { publicKeyToPKHDigest } from './address-encoding.js';
import { base58 } from '@scure/base';
import { DEFAULT_COINBASE_TIMELOCK_BLOCKS } from '@nockbox/iris-sdk';
import { getEffectiveRpcConfig, getTxEngineSettingsForHeight } from './rpc-config.js';
import type { TransactionContextSnapshot } from './rpc-config.js';
import { ensureWasmInitialized } from './wasm-utils.js';
import {
  createSimplePkhCondition,
  createPkhCoinbaseCondition,
  createPkhRelativeTimelockCondition,
  createPkhAbsoluteTimelockCondition,
  parseDigestString,
} from './spend-conditions.js';
import { firstNameFromCondition } from './first-name-derivation.js';
import { resolveBuilderFeeSummary } from './transaction-fee.js';

type SpendConditionLike = wasm.SpendCondition;
function noteFromProtobuf(protoNote: any): any {
  return wasm.noteFromProtobuf(protoNote);
}

async function createTxBuilder(
  blockHeight?: number,
  txEngineSettings?: wasm.TxEngineSettings
): Promise<wasm.TxBuilder> {
  const height = blockHeight ?? 0;
  const settings = txEngineSettings ?? (await getTxEngineSettingsForHeight(height));
  return new wasm.TxBuilder(settings);
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
  note: { nameFirst: string; originPage: number },
  coinbaseTimelockBlocks?: number
): Promise<wasm.SpendCondition> {
  await ensureWasmInitialized();

  const timelock =
    coinbaseTimelockBlocks ??
    (await getEffectiveRpcConfig()).coinbaseTimelockBlocks ??
    DEFAULT_COINBASE_TIMELOCK_BLOCKS;
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
  /** Pre-resolved settings used to bind construction to one immutable config snapshot. */
  txEngineSettings?: wasm.TxEngineSettings;
}

export type UnsignedTransactionParams = Omit<TransactionParams, 'privateKey'>;

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
  /** Minimum fee required by the transaction engine (in nicks) */
  minimumFee: number;
}

async function prepareTransactionBuilder(params: UnsignedTransactionParams): Promise<{
  builder: wasm.TxBuilder;
  feeUsed: number;
  minimumFee: number;
}> {
  await ensureWasmInitialized();

  const {
    notes,
    spendCondition,
    recipientPKH,
    amount,
    fee,
    refundPKH,
    includeLockData,
    blockHeight,
    txEngineSettings,
  } = params;

  if (notes.length === 0) {
    throw new Error('At least one note (UTXO) is required');
  }

  const totalAvailable = notes.reduce((sum, note) => sum + BigInt(Math.floor(note.assets)), 0n);
  const amountBn = nicksToBigInt(amount);
  const feeBn = fee !== undefined ? nicksToBigInt(fee) : 0n;
  const needBn = amountBn + feeBn;

  if (totalAvailable < needBn) {
    throw new Error(
      `Insufficient funds: have ${totalAvailable} nicks, need ${needBn} (${amount} amount + ${fee ?? '0'} fee)`
    );
  }

  const wasmNotes = notes.map(note => {
    if (!note.protoNote) {
      throw new Error(
        'Note missing protoNote - cannot build transaction. RPC must provide full note data.'
      );
    }
    return noteFromProtobuf(note.protoNote);
  });

  const spendConditions = Array.isArray(spendCondition)
    ? isSpendConditionList(spendCondition)
      ? spendCondition
      : notes.map(() => spendCondition)
    : notes.map(() => spendCondition);

  if (spendConditions.length !== notes.length) {
    throw new Error(
      `Spend condition count mismatch: ${spendConditions.length} conditions for ${notes.length} notes`
    );
  }

  const builder = await createTxBuilder(blockHeight, txEngineSettings);
  try {
    const locks: wasm.TxLock[] = spendConditions.map(sc => ({
      lock: sc,
      lock_sp_index: 0,
    }));
    builder.simpleSpend(
      wasmNotes,
      locks,
      parseDigestString(recipientPKH),
      amount as wasm.Nicks,
      fee !== undefined ? (fee as wasm.Nicks) : null,
      parseDigestString(refundPKH),
      includeLockData
    );

    const { fee: feeUsed, minimumFee } = resolveBuilderFeeSummary(
      builder.curFee(),
      builder.calcFee(),
      fee !== undefined
    );

    return { builder, feeUsed, minimumFee };
  } catch (error) {
    builder.free();
    throw error;
  }
}

/** Build an unsigned transaction without deriving or accessing a private key. */
export async function buildUnsignedTransaction(
  params: UnsignedTransactionParams
): Promise<ConstructedTransaction> {
  const { builder, feeUsed, minimumFee } = await prepareTransactionBuilder(params);
  try {
    const nockchainTx = builder.build();
    return {
      txId: getTxIdCompat(nockchainTx),
      version: 1,
      nockchainTx,
      feeUsed,
      minimumFee,
    };
  } finally {
    builder.free();
  }
}

/**
 * Build a complete Nockchain transaction using the new builder API
 *
 * @param params - Transaction parameters
 * @returns Constructed transaction ready for broadcast
 */
export async function buildTransaction(params: TransactionParams): Promise<ConstructedTransaction> {
  const { builder } = await prepareTransactionBuilder(params);
  try {
    await builder.sign(params.privateKey);
    builder.validate();

    // Signing may change witness size. Report the actual assigned fee and the
    // final minimum independently instead of conflating calcFee() with fee used.
    const { fee: feeUsed, minimumFee } = resolveBuilderFeeSummary(
      builder.curFee(),
      builder.calcFee(),
      params.fee !== undefined
    );

    const nockchainTx = builder.build();
    return {
      txId: getTxIdCompat(nockchainTx),
      version: 1,
      nockchainTx,
      feeUsed,
      minimumFee,
    };
  } finally {
    builder.free();
  }
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
function validatePaymentCandidates(notes: Note[], amount: Nicks, fee?: Nicks): void {
  if (notes.length === 0) {
    throw new Error('At least one note is required');
  }

  const totalAvailable = notes.reduce((sum, note) => sum + BigInt(Math.floor(note.assets)), 0n);
  const totalNeeded = nicksToBigInt(amount) + nicksToBigInt(fee ?? ('0' as Nicks));
  if (totalAvailable < totalNeeded) {
    throw new Error(
      `Insufficient funds: have ${totalAvailable} nicks across ${notes.length} notes, need ${totalNeeded}`
    );
  }
}

async function discoverSpendConditions(
  notes: Note[],
  senderPKH: string,
  coinbaseTimelockBlocks?: number
): Promise<SpendConditionLike[]> {
  const spendConditions: SpendConditionLike[] = [];
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const spendCondition = await discoverSpendConditionForNote(
      senderPKH,
      {
        nameFirst: note.nameFirst,
        originPage: note.originPage,
      },
      coinbaseTimelockBlocks
    );
    const derivedFirstName = firstNameFromCondition(spendCondition);
    if (derivedFirstName !== note.nameFirst) {
      throw new Error(
        `First-name mismatch for note ${i}! Computed: ${derivedFirstName.slice(0, 20)}..., ` +
          `Expected: ${note.nameFirst.slice(0, 20)}...`
      );
    }
    spendConditions.push(spendCondition);
  }
  return spendConditions;
}

export async function buildMultiNotePayment(
  notes: Note[],
  recipientPKH: string,
  amount: Nicks,
  senderPublicKey: Uint8Array,
  privateKey: wasm.PrivateKey,
  fee?: Nicks,
  refundPKH?: string,
  blockHeight?: number,
  context?: Pick<TransactionContextSnapshot, 'coinbaseTimelockBlocks' | 'txEngineSettings'>
): Promise<ConstructedTransaction> {
  // Initialize WASM
  await ensureWasmInitialized();

  validatePaymentCandidates(notes, amount, fee);

  // Create sender's PKH digest string for change
  const senderPKH = publicKeyToPKHDigest(senderPublicKey);

  const spendConditions = await discoverSpendConditions(
    notes,
    senderPKH,
    context?.coinbaseTimelockBlocks
  );

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
    txEngineSettings: context?.txEngineSettings,
  });
}

/**
 * Build the exact unsigned payment intent for a wallet account. This deliberately
 * accepts the account PKH rather than key material so read-only dApp calls cannot
 * derive or access a private key.
 */
export async function buildUnsignedMultiNotePayment(
  notes: Note[],
  recipientPKH: string,
  amount: Nicks,
  senderPKH: string,
  fee?: Nicks,
  refundPKH?: string,
  blockHeight?: number,
  context?: Pick<TransactionContextSnapshot, 'coinbaseTimelockBlocks' | 'txEngineSettings'>
): Promise<ConstructedTransaction> {
  await ensureWasmInitialized();

  validatePaymentCandidates(notes, amount, fee);
  const spendConditions = await discoverSpendConditions(
    notes,
    senderPKH,
    context?.coinbaseTimelockBlocks
  );

  return buildUnsignedTransaction({
    notes,
    spendCondition: spendConditions,
    recipientPKH,
    amount,
    fee,
    refundPKH: refundPKH ?? senderPKH,
    includeLockData: false,
    blockHeight,
    txEngineSettings: context?.txEngineSettings,
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
