import type { ApprovalType } from './constants';
import type { ConnectRequest, SignRequest, TransactionRequest, SignRawTxRequest } from './types';

type PersistableRequest = ConnectRequest | SignRequest | TransactionRequest;

export type PendingApprovalSessionSnapshot = {
  currentRequestId: string | null;
  currentRequestType: ApprovalType | null;
  queue: Array<{ id: string; type: ApprovalType }>;
  pending: Record<
    string,
    {
      request: PersistableRequest;
      origin: string;
      tabId?: number;
      documentId?: string;
    }
  >;
};

export type PendingRequestLike = {
  request: ConnectRequest | SignRequest | TransactionRequest | SignRawTxRequest;
  origin: string;
  tabId?: number;
  documentId?: string;
};

export type RestoredPendingApprovalSession = {
  currentRequestId: string | null;
  requestQueue: Array<{ id: string; type: ApprovalType }>;
  pending: PendingApprovalSessionSnapshot['pending'];
};

function isPersistableRequest(
  request: ConnectRequest | SignRequest | TransactionRequest | SignRawTxRequest
): request is PersistableRequest {
  // Native WASM raw transactions are not structured-clone safe. They must be
  // requested again after a service-worker restart.
  return !('rawTx' in request);
}

export function buildPendingApprovalSessionSnapshot(
  pendingRequests: Map<string, PendingRequestLike>,
  currentRequestId: string | null,
  currentRequestType: ApprovalType | null,
  requestQueue: Array<{ id: string; type: ApprovalType }>,
  isExpired: (timestamp: number) => boolean
): PendingApprovalSessionSnapshot | null {
  const pending: PendingApprovalSessionSnapshot['pending'] = {};

  for (const [id, entry] of pendingRequests.entries()) {
    if (!isPersistableRequest(entry.request) || isExpired(entry.request.timestamp)) {
      continue;
    }
    pending[id] = {
      request: entry.request,
      origin: entry.origin,
      tabId: entry.tabId,
      documentId: entry.documentId,
    };
  }

  const queue = requestQueue.filter(item => pending[item.id]);
  const activeCurrentId = currentRequestId && pending[currentRequestId] ? currentRequestId : null;
  const activeCurrentType = activeCurrentId ? currentRequestType : null;

  if (!activeCurrentId && queue.length === 0 && Object.keys(pending).length === 0) {
    return null;
  }

  return {
    currentRequestId: activeCurrentId,
    currentRequestType: activeCurrentType,
    queue,
    pending,
  };
}

/**
 * Normalize a persisted session before the background worker attaches live
 * response callbacks. Invalid current requests are replaced by the next valid
 * queued request, then by the oldest remaining request as a legacy fallback.
 */
export function restorePendingApprovalSessionSnapshot(
  snapshot: PendingApprovalSessionSnapshot,
  isExpired: (timestamp: number) => boolean
): RestoredPendingApprovalSession {
  const pending: PendingApprovalSessionSnapshot['pending'] = {};

  for (const [id, entry] of Object.entries(snapshot.pending)) {
    if (!isExpired(entry.request.timestamp)) {
      pending[id] = entry;
    }
  }

  const requestQueue = snapshot.queue.filter(item => pending[item.id]);
  let currentRequestId =
    snapshot.currentRequestId && pending[snapshot.currentRequestId]
      ? snapshot.currentRequestId
      : null;

  while (!currentRequestId && requestQueue.length > 0) {
    const next = requestQueue.shift()!;
    if (pending[next.id]) {
      currentRequestId = next.id;
    }
  }

  if (!currentRequestId) {
    const oldest = Object.entries(pending).sort(
      ([, a], [, b]) => a.request.timestamp - b.request.timestamp
    )[0];
    currentRequestId = oldest?.[0] ?? null;
  }

  return {
    currentRequestId,
    requestQueue,
    pending,
  };
}

export function pendingApprovalOriginMatches(
  request: PendingRequestLike['request'],
  currentOrigin: string | null
): boolean {
  return currentOrigin !== null && request.origin === currentOrigin;
}

export function pendingApprovalAccountMatches(
  request: PendingRequestLike['request'],
  currentAccountAddress: string | null
): boolean {
  return (
    currentAccountAddress !== null &&
    'accountAddress' in request &&
    typeof request.accountAddress === 'string' &&
    request.accountAddress === currentAccountAddress
  );
}
