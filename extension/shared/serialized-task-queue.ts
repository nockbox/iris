/** Serialize asynchronous state snapshots without letting one failure poison later writes. */
export class SerializedTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /** Wait for every task that was enqueued before this call to settle. */
  async drain(): Promise<void> {
    await this.tail;
  }
}
