import type { Clock } from '../../src/infrastructure/github/rate-limiter.ts';

/** A clock whose sleep moves time forward instead of waiting. */
export class FakeClock implements Clock {
  readonly sleeps: number[] = [];

  constructor(private current = 1_000_000) {}

  now(): number {
    return this.current;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.current += ms;
  }
}
