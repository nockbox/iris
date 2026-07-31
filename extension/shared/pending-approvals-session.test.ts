import { describe, expect, it } from 'vitest';
import type { ConnectRequest, SignRawTxRequest, TransactionRequest } from './types';
import {
  buildPendingApprovalSessionSnapshot,
  pendingApprovalAccountMatches,
  pendingApprovalOriginMatches,
  restorePendingApprovalSessionSnapshot,
  type PendingRequestLike,
} from './pending-approval-state';

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
