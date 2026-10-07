import { SESSION_STORAGE_KEYS } from './constants';
import type { PendingApprovalSessionSnapshot } from './pending-approval-state';
import { SerializedTaskQueue } from './serialized-task-queue';

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

/**
 * Orders approval-session snapshots and makes reset a durable barrier.
 *
 * A reset invalidates queued snapshots immediately, waits for an already-started
 * write, and then removes the session value. Writes remain blocked until the
 * caller has also cleared the corresponding in-memory approval state.
 */
export class PendingApprovalSessionPersistence {
  private readonly queue = new SerializedTaskQueue();
  private generation = 0;
  private resetGeneration: number | null = null;

  constructor(
    private readonly write: (
      snapshot: PendingApprovalSessionSnapshot | null
    ) => Promise<void> = persistPendingApprovalSession
  ) {}

  persist(snapshot: PendingApprovalSessionSnapshot | null): Promise<void> {
    const generation = this.generation;
    if (this.resetGeneration !== null) {
      return Promise.resolve();
    }

    return this.queue.run(async () => {
      if (generation !== this.generation || this.resetGeneration !== null) {
        return;
      }
      await this.write(snapshot);
    });
  }

  beginReset(): number {
    this.generation += 1;
    this.resetGeneration = this.generation;
    return this.generation;
  }

  async clearForReset(generation: number): Promise<boolean> {
    return this.queue.run(async () => {
      if (generation !== this.generation || this.resetGeneration !== generation) {
        return false;
      }
      await this.write(null);
      return true;
    });
  }

  finishReset(generation: number): void {
    if (this.resetGeneration === generation) {
      this.resetGeneration = null;
    }
  }

  isResetting(): boolean {
    return this.resetGeneration !== null;
  }
}
