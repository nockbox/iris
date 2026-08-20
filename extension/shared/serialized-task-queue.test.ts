import { describe, expect, it } from 'vitest';
import { SerializedTaskQueue } from './serialized-task-queue';

describe('SerializedTaskQueue', () => {
  it('runs writes in order and captures state when each queued task executes', async () => {
    const queue = new SerializedTaskQueue();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const events: string[] = [];
    let state = 'old';

    const first = queue.run(async () => {
      events.push(`first:${state}`);
      await firstGate;
    });
    const second = queue.run(async () => {
      events.push(`second:${state}`);
    });

    await Promise.resolve();
    state = 'new';
    expect(events).toEqual(['first:old']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:old', 'second:new']);
  });

  it('does not let a failed write poison later queued work', async () => {
    const queue = new SerializedTaskQueue();
    const failed = queue.run(async () => {
      throw new Error('storage failed');
    });
    const succeeded = queue.run(async () => 'persisted');

    await expect(failed).rejects.toThrow('storage failed');
    await expect(succeeded).resolves.toBe('persisted');
    await expect(queue.drain()).resolves.toBeUndefined();
  });
});
