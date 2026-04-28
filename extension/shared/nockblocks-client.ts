const DEFAULT_NOCKBLOCKS_RPC_URL = 'https://nockblocks.com/rpc/v1';

type JsonRpcResponse<T> = {
  jsonrpc: '2.0';
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export interface NockblocksSeed {
  isCoinbase?: boolean;
  lockRoot?: string;
  noteData?: Record<string, unknown>;
  gift?: number;
  parentHash?: string;
}

export interface NockblocksSpend {
  firstName?: string;
  lastName?: string;
  version?: string;
  lockRoot?: string;
  seeds?: NockblocksSeed[];
  fee?: number;
}

export interface NockblocksOutput {
  // Valid note outputs always include firstName; optional reflects defensive JSON parsing.
  firstName?: string;
  lastName?: string;
  seeds?: NockblocksSeed[];
}

export interface NockblocksTransactionBody {
  spends?: NockblocksSpend[];
  outputs?: NockblocksOutput[];
}

export interface NockblocksTransaction {
  id?: string;
  txId?: string;
  blockId?: string;
  blockHeight?: number;
  timestamp?: number;
  heardAtTimestamp?: number;
  version?: number;
  totalSize?: number;
  spends?: NockblocksSpend[];
  outputs?: NockblocksOutput[];
  transaction?: NockblocksTransactionBody;
}

export interface NockblocksBlock {
  blockId: string;
  height: number;
  timestamp: number;
  parentId?: string;
  transactions: NockblocksTransaction[];
}

function getEnvVar(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function getApiKey(): string | undefined {
  return getEnvVar(import.meta.env.VITE_NOCKBLOCKS_API_KEY);
}

function getApiUrl(): string {
  return getEnvVar(import.meta.env.VITE_NOCKBLOCKS_API_URL) || DEFAULT_NOCKBLOCKS_RPC_URL;
}

function normalizeTransaction(transaction: NockblocksTransaction): NockblocksTransaction {
  return {
    ...transaction,
    txId: transaction.txId || transaction.id,
    spends: transaction.spends || transaction.transaction?.spends || [],
    outputs: transaction.outputs || transaction.transaction?.outputs || [],
  };
}

function normalizeBlock(block: unknown): NockblocksBlock | null {
  if (!block || typeof block !== 'object') {
    return null;
  }

  const value = block as Record<string, unknown>;
  const blockId =
    typeof value.blockId === 'string'
      ? value.blockId
      : typeof value.digest === 'string'
        ? value.digest
        : undefined;
  const parentId =
    typeof value.parentId === 'string'
      ? value.parentId
      : typeof value.parent === 'string'
        ? value.parent
        : undefined;
  const txs = Array.isArray(value.transactions)
    ? value.transactions.map(tx => normalizeTransaction(tx as NockblocksTransaction))
    : [];

  if (typeof blockId !== 'string' || typeof value.height !== 'number') {
    return null;
  }

  return {
    blockId,
    height: value.height,
    timestamp: typeof value.timestamp === 'number' ? value.timestamp : 0,
    parentId,
    transactions: txs,
  };
}

export function isNockblocksConfigured(): boolean {
  return Boolean(getApiKey());
}

export class NockblocksClient {
  private readonly apiUrl: string;
  private readonly apiKey?: string;

  constructor(options?: { apiUrl?: string; apiKey?: string }) {
    this.apiUrl = options?.apiUrl || getApiUrl();
    this.apiKey = options?.apiKey || getApiKey();
  }

  private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!this.apiKey) {
      throw new Error('Nockblocks API key is not configured');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);

    let response: Response;
    try {
      response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          params: [params],
          id: crypto.randomUUID(),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Nockblocks ${method} timed out after 20s`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let bodySnippet = '';
      try {
        const text = await response.text();
        if (text) bodySnippet = `: ${text.slice(0, 500)}`;
      } catch {
        // ignore body read failure
      }
      throw new Error(`Nockblocks API error ${response.status}${bodySnippet}`);
    }

    const payload = (await response.json()) as JsonRpcResponse<T>;
    if (payload.error) {
      throw new Error(payload.error.message || `Nockblocks ${method} failed`);
    }

    if (payload.result === undefined) {
      throw new Error(`Nockblocks ${method} returned no result`);
    }

    return payload.result;
  }

  async getMempoolTransactionByTxid(transactionId: string): Promise<NockblocksTransaction | null> {
    try {
      const result = await this.request<NockblocksTransaction | null>(
        'getMempoolTransactionByTxid',
        { transactionId }
      );
      return result ? normalizeTransaction(result) : null;
    } catch (error) {
      if (error instanceof Error && /no result|not found/i.test(error.message)) {
        return null;
      }
      throw error;
    }
  }

  async getTransactionByTxid(transactionId: string): Promise<NockblocksTransaction | null> {
    try {
      const result = await this.request<NockblocksTransaction | null>('getTransactionByTxid', {
        transactionId,
      });
      return result ? normalizeTransaction(result) : null;
    } catch (error) {
      if (error instanceof Error && /no result|not found/i.test(error.message)) {
        return null;
      }
      throw error;
    }
  }

  async getTransactionsByAddress(
    address: string,
    options?: { limit?: number; offset?: number }
  ): Promise<NockblocksTransaction[]> {
    const params: Record<string, unknown> = { address };
    if (options?.limit != null) params.limit = options.limit;
    if (options?.offset != null) params.offset = options.offset;

    const result = await this.request<{ transactions?: NockblocksTransaction[] }>(
      'getTransactionsByAddress',
      params
    );

    return (result.transactions || []).map(normalizeTransaction);
  }

  async getTip(): Promise<NockblocksBlock> {
    const result = await this.request<Record<string, unknown>>('getTip', {});
    const block = normalizeBlock(result);
    if (!block) {
      throw new Error('Invalid getTip response from Nockblocks');
    }
    return block;
  }

  async getBlocksByHeight(heights: number[]): Promise<NockblocksBlock[]> {
    const result = await this.request<unknown>('getBlocksByHeight', { heights });

    if (Array.isArray(result)) {
      return result.map(normalizeBlock).filter((block): block is NockblocksBlock => Boolean(block));
    }

    if (result && typeof result === 'object') {
      const value = result as Record<string, unknown>;
      if (Array.isArray(value.blocks)) {
        return value.blocks
          .map(normalizeBlock)
          .filter((block): block is NockblocksBlock => Boolean(block));
      }

      const block = normalizeBlock(value);
      return block ? [block] : [];
    }

    return [];
  }
}

export function createNockblocksClient(options?: {
  apiUrl?: string;
  apiKey?: string;
}): NockblocksClient {
  return new NockblocksClient(options);
}
