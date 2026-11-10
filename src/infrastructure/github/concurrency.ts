export type Clock = { now(): number; sleep(ms: number): Promise<void> };

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * At most `limit` tasks run at once; the others wait their turn, in the order they came. A finished task
 * hands its slot straight to the next one, so a task that arrives meanwhile cannot take it.
 */
export class Concurrency {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running < this.limit) {
      this.running += 1;
    } else {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next === undefined) {
        this.running -= 1;
      } else {
        next();
      }
    }
  }
}
