import { SESSION_STORAGE_KEYS } from './constants';
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

type PendingRequestLike = {
  request: ConnectRequest | SignRequest | TransactionRequest | SignRawTxRequest;
  origin: string;
  tabId?: number;
  documentId?: string;
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
    if (!isPersistableRequest(entry.request)) {
      continue;
    }
    if (isExpired(entry.request.timestamp)) {
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

export async function persistPendingApprovalSession(
  snapshot: PendingApprovalSessionSnapshot | null
): Promise<void> {
  const sessionStorage = chrome.storage.session;
  if (!sessionStorage) {
    return;
  }

  if (!snapshot) {
    await sessionStorage.remove(SESSION_STORAGE_KEYS.PENDING_APPROVALS);
    return;
  }

  await sessionStorage.set({
    [SESSION_STORAGE_KEYS.PENDING_APPROVALS]: snapshot,
  });
}

export async function loadPendingApprovalSession(): Promise<PendingApprovalSessionSnapshot | null> {
  const sessionStorage = chrome.storage.session;
  if (!sessionStorage) {
    return null;
  }

  const stored = await sessionStorage.get([SESSION_STORAGE_KEYS.PENDING_APPROVALS]);
  const snapshot = stored[SESSION_STORAGE_KEYS.PENDING_APPROVALS] as
    | PendingApprovalSessionSnapshot
    | undefined;

  return snapshot ?? null;
}
