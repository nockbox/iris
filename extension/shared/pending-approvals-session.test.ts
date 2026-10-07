import { describe, expect, it, vi } from 'vitest';

vi.mock('@nockbox/iris-sdk', () => ({
  PROVIDER_METHODS: {},
}));
import type { ConnectRequest, SignRawTxRequest, TransactionRequest } from './types';
import {
  buildPendingApprovalSessionSnapshot,
  pendingApprovalAccountMatches,
  pendingApprovalOriginMatches,
  pendingApprovalPermissionStillValid,
  restorePendingApprovalSessionSnapshot,
  type PendingRequestLike,
} from './pending-approval-state';
import { PendingApprovalSessionPersistence } from './pending-approvals-session';

const ACTIVE_TIMESTAMP = 1_000;
const ORIGIN = 'https://app.example';
const ACCOUNT = 'account-a';

function connectRequest(
  id: string,
  timestamp = ACTIVE_TIMESTAMP,
  accountAddress = ACCOUNT
): ConnectRequest {
  return {
    id,
    origin: ORIGIN,
    timestamp,
    accountAddress,
  };
}

function transactionRequest(id: string, timestamp = ACTIVE_TIMESTAMP): TransactionRequest {
  return {
    id,
    origin: ORIGIN,
    timestamp,
    accountAddress: ACCOUNT,
    to: 'recipient',
    amount: '10' as TransactionRequest['amount'],
    fee: '1' as TransactionRequest['fee'],
  };
}

function rawRequest(id: string, timestamp = ACTIVE_TIMESTAMP): SignRawTxRequest {
  return {
    id,
    origin: ORIGIN,
    timestamp,
    accountAddress: ACCOUNT,
    rawTx: { native: true },
    inputs: [],
    inputsVerified: false,
    inputCount: 1,
    transactionId: 'tx-id',
    signingIntentId: 'intent-id',
    totalFee: '1' as SignRawTxRequest['totalFee'],
    reviewBlockHeight: 1,
  };
}

function pendingMap(
  entries: Array<[string, PendingRequestLike['request']]>
): Map<string, PendingRequestLike> {
  return new Map(
    entries.map(([id, request]) => [
      id,
      {
        request,
        origin: request.origin,
        tabId: 1,
        documentId: 'document-1',
      },
    ])
  );
}

const isExpired = (timestamp: number) => timestamp < ACTIVE_TIMESTAMP;

describe('pending approval session state', () => {
  it('orders a slow snapshot before reset and leaves the session empty', async () => {
    const snapshot = buildPendingApprovalSessionSnapshot(
      pendingMap([['connect', connectRequest('connect')]]),
      'connect',
      'connect',
      [],
      isExpired
    )!;
    let releaseOldWrite!: () => void;
    let oldWriteStarted!: () => void;
    const oldWriteGate = new Promise<void>(resolve => {
      releaseOldWrite = resolve;
    });
    const oldWriteIsRunning = new Promise<void>(resolve => {
      oldWriteStarted = resolve;
    });
    let durableSnapshot = null as typeof snapshot | null;
    const writes: Array<typeof snapshot | null> = [];
    const persistence = new PendingApprovalSessionPersistence(async nextSnapshot => {
      writes.push(nextSnapshot);
      if (nextSnapshot) {
        oldWriteStarted();
        await oldWriteGate;
      }
      durableSnapshot = nextSnapshot;
    });

    const oldWrite = persistence.persist(snapshot);
    await oldWriteIsRunning;
    const resetGeneration = persistence.beginReset();
    await persistence.persist(snapshot);
    const reset = persistence.clearForReset(resetGeneration);
    releaseOldWrite();

    await oldWrite;
    await expect(reset).resolves.toBe(true);
    persistence.finishReset(resetGeneration);

    expect(writes).toEqual([snapshot, null]);
    expect(durableSnapshot).toBeNull();
  });

  it('excludes native raw approvals from session storage', () => {
    const snapshot = buildPendingApprovalSessionSnapshot(
      pendingMap([['raw', rawRequest('raw')]]),
      'raw',
      'sign-raw-tx',
      [],
      isExpired
    );

    expect(snapshot).toBeNull();
  });

  it('keeps persistable requests queued behind a raw approval', () => {
    const snapshot = buildPendingApprovalSessionSnapshot(
      pendingMap([
        ['raw', rawRequest('raw')],
        ['transaction', transactionRequest('transaction')],
      ]),
      'raw',
      'sign-raw-tx',
      [{ id: 'transaction', type: 'transaction' }],
      isExpired
    );

    expect(snapshot).toEqual({
      currentRequestId: null,
      currentRequestType: null,
      queue: [{ id: 'transaction', type: 'transaction' }],
      pending: {
        transaction: expect.objectContaining({
          request: expect.objectContaining({ id: 'transaction' }),
        }),
      },
    });
  });

  it('promotes the first valid queued request when the active request is unavailable', () => {
    const snapshot = buildPendingApprovalSessionSnapshot(
      pendingMap([
        ['raw', rawRequest('raw')],
        ['connect', connectRequest('connect')],
        ['transaction', transactionRequest('transaction')],
      ]),
      'raw',
      'sign-raw-tx',
      [
        { id: 'connect', type: 'connect' },
        { id: 'transaction', type: 'transaction' },
      ],
      isExpired
    )!;

    const restored = restorePendingApprovalSessionSnapshot(snapshot, isExpired);

    expect(restored.currentRequestId).toBe('connect');
    expect(restored.requestQueue).toEqual([{ id: 'transaction', type: 'transaction' }]);
  });

  it('preserves an estimated-fee approval across a worker restart', () => {
    const request = { ...transactionRequest('transaction'), feeEstimated: true };
    const snapshot = buildPendingApprovalSessionSnapshot(
      pendingMap([['transaction', request]]),
      'transaction',
      'transaction',
      [],
      isExpired
    )!;

    const restored = restorePendingApprovalSessionSnapshot(snapshot, isExpired);

    expect(restored.pending.transaction.request).toMatchObject({
      fee: '1',
      feeEstimated: true,
      accountAddress: ACCOUNT,
    });
  });

  it('structured-clones an unsigned build snapshot across a worker restart', () => {
    const request: TransactionRequest = {
      ...transactionRequest('transaction'),
      builtTransaction: {
        tx: {
          version: 1,
          id: 'unsigned-id',
          spends: [],
          display: { inputs: { inputs: [] }, outputs: [] },
          witness_data: { data: [] },
        } as unknown as NonNullable<TransactionRequest['builtTransaction']>['tx'],
        notes: [
          {
            version: 1,
            origin_page: 10,
            name: { first: 'first', last: 'last', _sig: 0 },
            note_data: [],
            assets: '11',
          },
        ] as unknown as NonNullable<TransactionRequest['builtTransaction']>['notes'],
        outputs: [],
        intentId: 'intent-id' as NonNullable<TransactionRequest['builtTransaction']>['intentId'],
        accountAddress: ACCOUNT as NonNullable<
          TransactionRequest['builtTransaction']
        >['accountAddress'],
        blockHeight: 10,
        to: 'recipient' as NonNullable<TransactionRequest['builtTransaction']>['to'],
        amount: '10' as TransactionRequest['amount'],
        inputTotal: '11' as TransactionRequest['amount'],
        fee: '1' as TransactionRequest['fee'],
        minimumFee: '1' as TransactionRequest['fee'],
        change: '0' as TransactionRequest['amount'],
      },
      transactionContext: {
        fingerprint: 'network-fingerprint',
        networkIdentity: 'network-identity',
        rpcUrl: 'https://rpc.example',
        networkName: 'Testnet',
        coinbaseTimelockBlocks: 100,
        txEngineActivationHeight: 0,
        nextTxEngineActivationHeight: 100,
        txEngineSettings: {
          tx_engine_version: 1,
          tx_engine_patch: 0,
          min_fee: '1',
          cost_per_word: '1',
          witness_word_div: 1,
        } as NonNullable<TransactionRequest['transactionContext']>['txEngineSettings'],
      },
    };
    const snapshot = buildPendingApprovalSessionSnapshot(
      pendingMap([['transaction', request]]),
      'transaction',
      'transaction',
      [],
      isExpired
    )!;

    const clonedSnapshot = structuredClone(snapshot);
    const restored = restorePendingApprovalSessionSnapshot(clonedSnapshot, isExpired);

    expect(restored.pending.transaction.request).toMatchObject({
      builtTransaction: {
        tx: { version: 1, id: 'unsigned-id' },
        notes: [{ version: 1, assets: '11' }],
        intentId: 'intent-id',
        accountAddress: ACCOUNT,
        to: 'recipient',
        amount: '10',
        inputTotal: '11',
        fee: '1',
        minimumFee: '1',
        change: '0',
      },
      transactionContext: {
        fingerprint: 'network-fingerprint',
        networkIdentity: 'network-identity',
        rpcUrl: 'https://rpc.example',
        txEngineActivationHeight: 0,
        nextTxEngineActivationHeight: 100,
      },
    });
  });

  it('drops expired requests without blocking later queued approvals', () => {
    const snapshot = buildPendingApprovalSessionSnapshot(
      pendingMap([
        ['expired', connectRequest('expired', ACTIVE_TIMESTAMP - 1)],
        ['transaction', transactionRequest('transaction')],
      ]),
      'expired',
      'connect',
      [{ id: 'transaction', type: 'transaction' }],
      () => false
    )!;

    const restored = restorePendingApprovalSessionSnapshot(snapshot, isExpired);

    expect(restored.pending).not.toHaveProperty('expired');
    expect(restored.currentRequestId).toBe('transaction');
  });

  it('requires the exact normalized requester origin', () => {
    const request = transactionRequest('transaction');

    expect(pendingApprovalOriginMatches(request, ORIGIN)).toBe(true);
    expect(pendingApprovalOriginMatches(request, 'http://app.example')).toBe(false);
    expect(pendingApprovalOriginMatches(request, 'https://other.example')).toBe(false);
    expect(pendingApprovalOriginMatches(request, null)).toBe(false);
  });

  it('invalidates sensitive approvals when origin permission is revoked', () => {
    const request = transactionRequest('transaction');

    expect(pendingApprovalPermissionStillValid(request, new Set([ORIGIN]))).toBe(true);
    expect(pendingApprovalPermissionStillValid(request, new Set())).toBe(false);
    expect(pendingApprovalPermissionStillValid(connectRequest('connect'), new Set())).toBe(true);
  });

  it('requires the account selected when the approval was created', () => {
    const request = transactionRequest('transaction');

    expect(pendingApprovalAccountMatches(request, ACCOUNT)).toBe(true);
    expect(pendingApprovalAccountMatches(request, 'account-b')).toBe(false);
    expect(pendingApprovalAccountMatches(request, null)).toBe(false);
    expect(
      pendingApprovalAccountMatches(
        {
          id: 'connect',
          origin: ORIGIN,
          timestamp: ACTIVE_TIMESTAMP,
        },
        ACCOUNT
      )
    ).toBe(false);
  });
});
