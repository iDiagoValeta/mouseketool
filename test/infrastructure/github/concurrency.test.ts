import { describe, expect, it } from 'vitest';
import { Concurrency } from '../../../src/infrastructure/github/concurrency.ts';

/** A task that stays open until `release` is called, recording how many tasks ran at its start. */
function gate(log: { peak: number; now: number }) {
  let release!: () => void;
  const done = new Promise<void>((resolve) => (release = resolve));
  const task = async () => {
    log.now += 1;
    log.peak = Math.max(log.peak, log.now);
    await done;
    log.now -= 1;
  };
  return { task, release };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Concurrency', () => {
  it('runs at most the limit at once and starts the waiting ones as slots free', async () => {
    const log = { peak: 0, now: 0 };
    const limit = new Concurrency(2);
    const gates = Array.from({ length: 5 }, () => gate(log));

    const all = Promise.all(gates.map((g) => limit.run(g.task)));
    await tick();
    expect(log.now).toBe(2);

    for (const g of gates) {
      g.release();
      await tick();
    }
    await all;

    expect(log.peak).toBe(2);
  });

  it('does not let a task that arrives as a slot frees go past the limit', async () => {
    const log = { peak: 0, now: 0 };
    const limit = new Concurrency(1);
    const first = gate(log);
    const second = gate(log);
    const third = gate(log);

    const a = limit.run(first.task);
    const b = limit.run(second.task);
    await tick();
    first.release();
    const c = limit.run(third.task);
    await tick();
    expect(log.now).toBe(1);

    second.release();
    await tick();
    third.release();
    await Promise.all([a, b, c]);
    expect(log.peak).toBe(1);
  });

  it('frees the slot when a task fails, and passes the failure on', async () => {
    const limit = new Concurrency(1);

    await expect(limit.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limit.run(async () => 'next')).resolves.toBe('next');
  });
});
