import { describe, expect, it } from 'vitest';
import { LifecycleTransitionCoordinator } from './lifecycle-transition-coordinator';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('LifecycleTransitionCoordinator', () => {
  it('orders effects and prevents an invalidated unlock from running later effects', async () => {
    const coordinator = new LifecycleTransitionCoordinator();
    const delayedWrite = deferred<void>();
    const effects: string[] = [];

    const unlockGeneration = coordinator.begin();
    const unlock = coordinator.run(unlockGeneration, async isCurrent => {
      effects.push('unlock-write-start');
      await delayedWrite.promise;
      effects.push('unlock-write-finish');
      if (isCurrent()) effects.push('connect');
    });

    await Promise.resolve();
    const lockGeneration = coordinator.begin();
    const lock = coordinator.run(lockGeneration, async () => {
      effects.push('lock-marker');
      effects.push('disconnect');
    });

    delayedWrite.resolve();
    await Promise.all([unlock, lock]);

    expect(effects).toEqual([
      'unlock-write-start',
      'unlock-write-finish',
      'lock-marker',
      'disconnect',
    ]);
  });

  it('does not start queued stale setup work', async () => {
    const coordinator = new LifecycleTransitionCoordinator();
    const hold = deferred<void>();
    const firstGeneration = coordinator.begin();
    const first = coordinator.run(firstGeneration, async () => hold.promise);
    await Promise.resolve();

    const staleGeneration = coordinator.begin();
    const stale = coordinator.run(staleGeneration, async () => 'stale');
    const resetGeneration = coordinator.begin();
    const reset = coordinator.run(resetGeneration, async () => 'reset');

    hold.resolve();
    await expect(first).resolves.toBeUndefined();
    await expect(stale).resolves.toBeUndefined();
    await expect(reset).resolves.toBe('reset');
  });
});
