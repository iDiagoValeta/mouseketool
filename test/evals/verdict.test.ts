import { describe, expect, it } from 'vitest';
import { parseVerdict } from '../../evals/harness/verdict.ts';

describe('parseVerdict', () => {
  it('reads a decision with several repositories', () => {
    expect(parseVerdict('Verdict: adapt foo/bar, baz/qux\n\nSummary')).toEqual({
      decision: 'adapt',
      repos: ['foo/bar', 'baz/qux'],
    });
  });

  it('reads build without repositories', () => {
    expect(parseVerdict('Verdict: build')).toEqual({ decision: 'build', repos: [] });
  });

  it('lower-cases repositories and accepts GitHub URLs', () => {
    expect(parseVerdict('Verdict: reuse Foo/Bar, https://github.com/baz/qux')).toEqual({
      decision: 'reuse',
      repos: ['foo/bar', 'baz/qux'],
    });
  });

  it('returns null when no line is a verdict', () => {
    expect(parseVerdict('I would just build it.\nverdict: build')).toBeNull();
    expect(parseVerdict('')).toBeNull();
  });

  it('returns null for an unknown decision', () => {
    expect(parseVerdict('Verdict: maybe foo/bar')).toBeNull();
  });

  it('takes the first matching line even when it is not the first line', () => {
    const text = 'Let me think.\nVerdict: base a/b\nVerdict: build';
    expect(parseVerdict(text)).toEqual({ decision: 'base', repos: ['a/b'] });
  });

  it('tolerates Windows line endings', () => {
    expect(parseVerdict('Verdict: build\r\nWhy.')).toEqual({ decision: 'build', repos: [] });
  });

  it('drops entries that are not repository names', () => {
    expect(parseVerdict('Verdict: adapt foo/bar, not a repo')).toEqual({
      decision: 'adapt',
      repos: ['foo/bar'],
    });
  });
});
