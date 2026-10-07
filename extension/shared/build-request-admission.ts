/** Fail-fast admission control for read-only public transaction builds. */
export class BuildRequestAdmission {
  private readonly activeOrigins = new Set<string>();

  constructor(private readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('Build concurrency limit must be a positive integer');
    }
  }

  tryAcquire(origin: string): (() => void) | null {
    if (this.activeOrigins.has(origin) || this.activeOrigins.size >= this.maxConcurrent) {
      return null;
    }
    this.activeOrigins.add(origin);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.activeOrigins.delete(origin);
    };
  }
}
