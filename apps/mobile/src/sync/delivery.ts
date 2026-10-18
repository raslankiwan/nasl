import { ApiError } from '../api/sessionClient.ts';
import type { Outbox, OutboxEntry } from './outbox.ts';

export function isRetryable(error: unknown): boolean {
  return (
    !(error instanceof ApiError) || error.status >= 500 || [401, 408, 429].includes(error.status)
  );
}

/** One delivery lane for immediate saves and retries. Ownership is rechecked before every send. */
export class Delivery {
  private readonly outbox: Outbox;
  private readonly post: (entry: OutboxEntry) => Promise<unknown>;
  private readonly owns: (entry: OutboxEntry) => boolean;
  private lane: Promise<unknown> = Promise.resolve();

  constructor(
    outbox: Outbox,
    post: (entry: OutboxEntry) => Promise<unknown>,
    owns: (entry: OutboxEntry) => boolean,
  ) {
    this.outbox = outbox;
    this.post = post;
    this.owns = owns;
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.lane.then(work);
    this.lane = result.catch(() => {});
    return result;
  }

  send(entry: Pick<OutboxEntry, 'id' | 'path' | 'body' | 'userId'>): Promise<boolean> {
    return this.exclusive(async () => {
      await this.outbox.enqueue(entry);
      const saved = (await this.outbox.pending()).find((e) => e.id === entry.id)!;
      if (!this.owns(saved)) return false;
      try {
        await this.post(saved);
      } catch (error) {
        if (!isRetryable(error)) {
          await this.outbox.remove(entry.id);
          throw error;
        }
        await this.outbox.recordFailure(
          entry.id,
          error instanceof Error ? error.message : 'failed',
        );
        return false;
      }
      await this.outbox.remove(entry.id);
      return true;
    });
  }

  flush(retryBlocked = false): Promise<boolean> {
    return this.exclusive(async () => {
      for (const entry of await this.outbox.pending()) {
        if (!this.owns(entry) || (entry.blocked && !retryBlocked)) continue;
        try {
          await this.post(entry);
        } catch (error) {
          const retry = isRetryable(error);
          await this.outbox.recordFailure(
            entry.id,
            error instanceof Error ? error.message : 'failed',
            !retry,
          );
          if (retry) return false;
          continue;
        }
        await this.outbox.remove(entry.id);
      }
      return true;
    });
  }
}
