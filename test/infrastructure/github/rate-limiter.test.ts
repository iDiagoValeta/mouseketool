import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/infrastructure/github/rate-limiter.ts';
import { FakeClock } from '../../doubles/fake-clock.ts';

describe('RateLimiter', () => {
  it('lets the first perMinute acquisitions through without sleeping', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(30, clock);

    for (let i = 0; i < 30; i += 1) {
      await limiter.acquire();
    }

    expect(clock.sleeps).toEqual([]);
  });

  it('sleeps the 31st acquisition until the first one leaves the window', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(30, clock);

    for (let i = 0; i < 30; i += 1) {
      await limiter.acquire();
      await clock.sleep(1_000); // one acquisition per second
    }
    clock.sleeps.length = 0;

    // The first acquisition was 30 s ago, so 30 s of the window are left.
    await limiter.acquire();

    expect(clock.sleeps).toEqual([30_000]);
  });

  it('does not sleep once the window has passed', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(2, clock);
    await limiter.acquire();
    await limiter.acquire();
    await clock.sleep(60_000);
    clock.sleeps.length = 0;

    await limiter.acquire();

    expect(clock.sleeps).toEqual([]);
  });

  it('keeps the limit across a long burst', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(30, clock);
    const start = clock.now();

    for (let i = 0; i < 90; i += 1) {
      await limiter.acquire();
    }

    // 90 acquisitions at 30 per minute cannot finish in less than two windows.
    expect(clock.now() - start).toBeGreaterThanOrEqual(120_000);
  });
});
