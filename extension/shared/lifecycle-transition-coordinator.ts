import { SerializedTaskQueue } from './serialized-task-queue';

/**
 * Orders wallet lifecycle side effects while allowing a newer transition to
 * invalidate slow work immediately. Callers still perform any synchronous
 * Vault lock/epoch invalidation before waiting on `run`.
 */
export class LifecycleTransitionCoordinator {
  private generation = 0;
  private readonly queue = new SerializedTaskQueue();

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  run<T>(
    generation: number,
    task: (isCurrent: () => boolean) => Promise<T>
  ): Promise<T | undefined> {
    return this.queue.run(async () => {
      if (!this.isCurrent(generation)) return undefined;
      return await task(() => this.isCurrent(generation));
    });
  }
}
