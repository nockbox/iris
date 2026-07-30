import { SESSION_STORAGE_KEYS } from './constants';
import type { PendingApprovalSessionSnapshot } from './pending-approval-state';

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
