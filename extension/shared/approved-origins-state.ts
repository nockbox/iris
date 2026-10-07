import { SerializedTaskQueue } from './serialized-task-queue';

export class StaleApprovalStateError extends Error {
  constructor() {
    super('Wallet authorization changed; request the action again');
    this.name = 'StaleApprovalStateError';
  }
}

/**
 * Owns origin authorization and serializes its durable snapshots.
 * Reset invalidation is synchronous, while runReset() orders the destructive
 * storage clear after any write that had already started.
 */
export class ApprovedOriginsState {
  private origins = new Set<string>();
  private generation = 0;
  private resetGeneration: number | null = null;
  private readonly persistenceQueue = new SerializedTaskQueue();

  constructor(private readonly persistOrigins: (origins: string[]) => Promise<void>) {}

  captureGeneration(): number {
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation && this.resetGeneration === null;
  }

  has(origin: string): boolean {
    return this.origins.has(origin);
  }

  values(): ReadonlySet<string> {
    return this.origins;
  }

  replace(origins: Iterable<string>, generation: number): void {
    this.assertCurrent(generation);
    this.origins = new Set(origins);
  }

  async persist(generation: number = this.generation): Promise<void> {
    await this.persistenceQueue.run(async () => {
      this.assertCurrent(generation);
      await this.persistOrigins(Array.from(this.origins));
      this.assertCurrent(generation);
    });
  }

  async approve(origin: string, generation: number = this.generation): Promise<void> {
    await this.persistenceQueue.run(async () => {
      this.assertCurrent(generation);
      const nextOrigins = new Set(this.origins);
      nextOrigins.add(origin);
      await this.persistOrigins(Array.from(nextOrigins));
      this.assertCurrent(generation);
      this.origins = nextOrigins;
    });
  }

  async revoke(origin: string, generation: number = this.generation): Promise<void> {
    await this.persistenceQueue.run(async () => {
      this.assertCurrent(generation);
      const nextOrigins = new Set(this.origins);
      nextOrigins.delete(origin);
      await this.persistOrigins(Array.from(nextOrigins));
      this.assertCurrent(generation);
      this.origins = nextOrigins;
    });
  }

  beginReset(): number {
    this.generation += 1;
    this.resetGeneration = this.generation;
    this.origins.clear();
    return this.generation;
  }

  async runReset<T>(generation: number, resetStorage: () => Promise<T>): Promise<T> {
    return this.persistenceQueue.run(async () => {
      if (generation !== this.generation || this.resetGeneration !== generation) {
        throw new StaleApprovalStateError();
      }
      return resetStorage();
    });
  }

  finishReset(generation: number): void {
    if (this.resetGeneration === generation) {
      this.resetGeneration = null;
    }
  }

  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) {
      throw new StaleApprovalStateError();
    }
  }
}
