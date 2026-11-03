export type Clock = { now(): number; sleep(ms: number): Promise<void> };

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const WINDOW_MS = 60_000;

/**
 * Sliding window: at most `perMinute` acquisitions in any 60 s. An acquisition over the limit
 * waits for the oldest one to leave the window instead of failing, so a burst of searches
 * is slowed down rather than rejected by GitHub.
 */
export class RateLimiter {
  private readonly acquiredAt: number[] = [];

  constructor(
    private readonly perMinute: number,
    private readonly clock: Clock,
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      while (this.acquiredAt.length > 0 && now - this.acquiredAt[0]! >= WINDOW_MS) {
        this.acquiredAt.shift();
      }

      if (this.acquiredAt.length < this.perMinute) {
        this.acquiredAt.push(now);
        return;
      }

      await this.clock.sleep(this.acquiredAt[0]! + WINDOW_MS - now);
    }
  }
}
