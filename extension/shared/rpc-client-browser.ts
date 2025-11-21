/**
 * Browser gRPC-web client for Nockchain
 * Uses WASM-based tonic-web-wasm-client for proper bigint handling
 */

import { GrpcClient } from '../lib/nbx-wasm/nbx_wasm.js';
import type { Note } from './types';
import { base58 } from '@scure/base';
import { ensureWasmInitialized } from './wasm-utils.js';
import { RPC_ENDPOINT } from './constants.js';

/**
 * Browser RPC client for Nockchain blockchain
 * Compatible with Chrome extensions and web browsers
 * Uses Rust WASM client for proper bigint serialization
 */
export class NockchainBrowserRPCClient {
  private client: GrpcClient | null = null;
  private endpoint: string;

  constructor(endpoint: string = RPC_ENDPOINT) {
    this.endpoint = endpoint;
  }

  /**
   * Ensure the WASM client is initialized
   */
  private async ensureClient(): Promise<GrpcClient> {
    if (this.client) {
      return this.client;
    }

    await ensureWasmInitialized();
    this.client = new GrpcClient(this.endpoint);
    return this.client;
  }

  /**
   * Get balance (UTXOs/notes) for an address
   * @param address - Base58-encoded V1 address
   */
  async getBalance(address: string): Promise<Note[]> {
    console.log(
      `[RPC Browser] Fetching balance for ${address.slice(0, 20)}... from ${this.endpoint}`
    );

    try {
      const client = await this.ensureClient();
      const response = await client.get_balance_by_address(address);

      console.log('[RPC Browser] Balance response:', {
        noteCount: response.notes?.length || 0,
        blockHeight: response.height?.value,
      });

      return this.convertBalanceToNotes(response);
    } catch (error) {
      console.error('[RPC Browser] Error fetching balance:', error);
      throw new Error(
        `Failed to fetch balance: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get notes by first-name (v1 query method)
   * @param firstNameBase58 - Base58-encoded first-name hash (~55 characters)
   * @returns Array of notes with matching first-name
   */
  async getNotesByFirstName(firstNameBase58: string): Promise<Note[]> {
    console.log(
      `[RPC Browser] Fetching notes by first-name ${firstNameBase58.slice(0, 20)}... from ${this.endpoint}`
    );

    try {
      const client = await this.ensureClient();

      console.log(
        '[RPC Browser] Sending gRPC request for first-name:',
        firstNameBase58.slice(0, 20) + '...'
      );
      const response = await client.get_balance_by_first_name(firstNameBase58);

      const noteCount = response.notes?.length || 0;
      console.log('[RPC Browser] Balance response:', {
        noteCount,
        blockHeight: response.height?.value,
      });

      // DEBUG: Log the raw response structure
      console.log('[RPC Browser] ===== RAW RESPONSE STRUCTURE =====');
      console.log('[RPC Browser] response keys:', Object.keys(response));
      if (response.notes && response.notes.length > 0) {
        console.log('[RPC Browser] First note keys:', Object.keys(response.notes[0]));
        console.log('[RPC Browser] First note full object:', response.notes[0]);
      }
      console.log('[RPC Browser] ===== END RAW RESPONSE =====');

      const notes = this.convertBalanceToNotes(response);
      console.log(
        `[RPC Browser] Converted ${notes.length} notes, total assets:`,
        notes.reduce((sum, n) => sum + n.assets, 0)
      );

      return notes;
    } catch (error) {
      console.error('[RPC Browser] Error fetching notes by first-name:', error);
      throw new Error(
        `Failed to fetch notes by first-name: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get current block height from balance query
   */
  async getCurrentBlockHeight(): Promise<bigint> {
    try {
      const client = await this.ensureClient();
      // Use a dummy address to get chain info
      const dummyAddress = '1'.repeat(132);
      const response = await client.get_balance_by_address(dummyAddress);

      if (response.height?.value) {
        return BigInt(response.height.value);
      }

      return BigInt(0);
    } catch (error) {
      console.error('[RPC Browser] Error getting block height:', error);
      return BigInt(0);
    }
  }

  /**
   * Send a transaction to the network
   * @param rawTx - The signed raw transaction object
   * @returns Transaction ID if successful
   */
  async sendTransaction(rawTx: any): Promise<string> {
    console.log('[RPC Browser] Sending transaction...');

    try {
      const client = await this.ensureClient();
      const response = await client.send_transaction(rawTx);

      console.log('[RPC Browser] Transaction sent successfully');
      return response;
    } catch (error) {
      console.error('[RPC Browser] Error sending transaction:', error);
      throw new Error(
        `Failed to send transaction: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if a transaction was accepted by the network
   * @param txId - Base58-encoded transaction ID
   * @returns true if accepted, false otherwise
   */
  async isTransactionAccepted(txId: string): Promise<boolean> {
    try {
      const client = await this.ensureClient();
      const accepted = await client.transaction_accepted(txId);
      return accepted;
    } catch (error) {
      console.error('[RPC Browser] Error checking transaction status:', error);
      return false;
    }
  }

  /**
   * Convert proto Balance format to our Note[] interface
   */
  private convertBalanceToNotes(balance: any): Note[] {
    if (!balance.notes || balance.notes.length === 0) {
      return [];
    }

    const notes: Note[] = [];

    for (const entry of balance.notes) {
      try {
        const note = this.convertProtoNote(entry);
        if (note) {
          notes.push(note);
        }
      } catch (error) {
        console.error('[RPC Browser] Error converting note:', error, entry);
      }
    }

    return notes;
  }

  /**
   * Convert a single proto note to our Note interface
   */
  private convertProtoNote(balanceEntry: any): Note | null {
    if (!balanceEntry.note) {
      return null;
    }

    const protoNote = balanceEntry.note;
    const name = balanceEntry.name;
    const noteDataHash = balanceEntry.note_data_hash; // May be base58 string or undefined

    // WASM client returns note_version with V1 format
    const noteVersion = protoNote.note_version;
    const noteData = noteVersion?.V1 || protoNote.v1;

    // DEBUG: Log what we're getting from RPC
    console.log('[RPC Browser] ===== FULL BALANCE ENTRY DEBUG =====');
    console.log('[RPC Browser] balanceEntry keys:', Object.keys(balanceEntry));
    console.log('[RPC Browser] balanceEntry.source:', balanceEntry.source);
    console.log('[RPC Browser] balanceEntry.output_source:', balanceEntry.output_source);
    console.log('[RPC Browser] protoNote keys:', Object.keys(protoNote));
    console.log('[RPC Browser] protoNote.source:', protoNote.source);
    console.log('[RPC Browser] protoNote.output_source:', protoNote.output_source);
    console.log('[RPC Browser] noteVersion:', noteVersion);
    console.log('[RPC Browser] noteDataHash:', noteDataHash);

    // Check if there's noteData in the response
    if (noteData) {
      console.log('[RPC Browser] noteData keys:', Object.keys(noteData));
      console.log('[RPC Browser] noteData.source:', noteData.source);
      console.log('[RPC Browser] noteData.output_source:', noteData.output_source);
      console.log('[RPC Browser] noteData.note_data:', noteData.note_data);
      if (noteData.note_data) {
        console.log(
          '[RPC Browser] convertProtoNote - noteData.note_data.entries:',
          noteData.note_data.entries
        );
        console.log(
          '[RPC Browser] convertProtoNote - noteData.note_data.hash:',
          noteData.note_data.hash
        );
        console.log(
          '[RPC Browser] convertProtoNote - noteData.note_data keys:',
          Object.keys(noteData.note_data)
        );

        // DETAILED: Inspect entries array structure
        if (noteData.note_data.entries && Array.isArray(noteData.note_data.entries)) {
          console.log(
            '[RPC Browser] noteData.note_data.entries.length:',
            noteData.note_data.entries.length
          );
          noteData.note_data.entries.forEach((entry: any, idx: number) => {
            console.log(`[RPC Browser] Entry ${idx}:`, {
              key: entry.key,
              blobType: typeof entry.blob,
              blobIsUint8Array: entry.blob instanceof Uint8Array,
              blobLength: entry.blob?.length,
              blobFirst20Bytes: entry.blob?.slice?.(0, 20),
            });
          });
        }
      }
    }

    if (!noteData) {
      console.warn('[RPC Browser] Unknown note format:', protoNote);
      return null;
    }

    // WASM client returns name as { first: "base58", last: "base58" } instead of bytes
    let nameFirst: Uint8Array;
    let nameLast: Uint8Array;
    let nameFirstBase58: string | undefined;
    let nameLastBase58: string | undefined;

    if (name?.first && name?.last && typeof name.first === 'string') {
      // WASM format: base58 strings
      // Store the base58 strings for later use in transactions
      nameFirstBase58 = name.first;
      nameLastBase58 = name.last;

      // Also decode to bytes for compatibility
      nameFirst = base58.decode(name.first);
      nameLast = base58.decode(name.last);
    } else {
      // Old format: bytes
      const nameBytes = name?.bytes || new Uint8Array(80);
      nameFirst = nameBytes.slice(0, 40);
      nameLast = nameBytes.slice(40, 80);
    }

    // WASM client handles bigints properly, but we still need to convert to number for assets
    // The WASM deserializer already handles proper bigint conversion
    const safeToNumber = (value: any): number => {
      if (typeof value === 'bigint') {
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
          console.warn(
            '[RPC Browser] Value exceeds MAX_SAFE_INTEGER, precision may be lost:',
            value
          );
        }
        return Number(value);
      }
      if (typeof value === 'string') {
        const bigIntValue = BigInt(value);
        if (bigIntValue > BigInt(Number.MAX_SAFE_INTEGER)) {
          console.warn(
            '[RPC Browser] Value exceeds MAX_SAFE_INTEGER, precision may be lost:',
            value
          );
        }
        return Number(bigIntValue);
      }
      return Number(value || 0);
    };

    // Extract assets - WASM format has { value: "123" }, old format is direct
    const assetsValue = noteData.assets?.value || noteData.assets || 0;

    // Extract version - WASM format has { value: "1" }, old format is direct
    const versionValue = noteData.version?.value
      ? parseInt(noteData.version.value)
      : noteData.version || 1;

    // Extract originPage - WASM format has { value: "123" }, old format is direct
    const originPageValue = noteData.origin_page?.value || noteData.originPage || 0;

    if (noteVersion?.Legacy || protoNote.legacy) {
      return {
        version: 0,
        originPage: BigInt(originPageValue),
        timelockMin: noteData.timelockMin ? BigInt(noteData.timelockMin) : undefined,
        timelockMax: noteData.timelockMax ? BigInt(noteData.timelockMax) : undefined,
        nameFirst,
        nameLast,
        nameFirstBase58,
        nameLastBase58,
        noteDataHashBase58: noteDataHash,
        lockPubkeys: noteData.lock?.pubkeys || [],
        lockKeysRequired: BigInt(noteData.lock?.keysRequired || 1),
        sourceHash: noteData.source?.hash?.bytes || new Uint8Array(40),
        sourceIsCoinbase: noteData.source?.isCoinbase || false,
        assets: safeToNumber(assetsValue),
        protoNote: balanceEntry.note, // Store raw protobuf for WasmNote.fromProtobuf()
      };
    } else {
      return {
        version: versionValue,
        originPage: BigInt(originPageValue),
        timelockMin: undefined,
        timelockMax: undefined,
        nameFirst,
        nameLast,
        nameFirstBase58,
        nameLastBase58,
        noteDataHashBase58: noteDataHash,
        lockPubkeys: [],
        lockKeysRequired: BigInt(1),
        sourceHash: new Uint8Array(40),
        sourceIsCoinbase: false,
        assets: safeToNumber(assetsValue),
        protoNote: balanceEntry.note, // Store raw protobuf for WasmNote.fromProtobuf()
      };
    }
  }
}

/**
 * Create a browser client instance
 * @param endpoint - gRPC-web endpoint URL (defaults to RPC_ENDPOINT)
 */
export function createBrowserClient(endpoint = RPC_ENDPOINT): NockchainBrowserRPCClient {
  return new NockchainBrowserRPCClient(endpoint);
}
