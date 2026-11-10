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

  it('lower-cases repositories', () => {
    expect(parseVerdict('Verdict: reuse Foo/Bar,Baz/Qux')).toEqual({
      decision: 'reuse',
      repos: ['foo/bar', 'baz/qux'],
    });
  });

  it('skips blank lines and surrounding spaces before the verdict', () => {
    expect(parseVerdict('\n  \n  Verdict: build  \nWhy.')).toEqual({ decision: 'build', repos: [] });
  });

  it('returns null when no line is a verdict', () => {
    expect(parseVerdict('I would just build it.\nverdict: build')).toBeNull();
    expect(parseVerdict('')).toBeNull();
  });

  it('returns null for an unknown decision', () => {
    expect(parseVerdict('Verdict: maybe foo/bar')).toBeNull();
  });

  it('reads only the first line, as the skill requires the verdict there', () => {
    expect(parseVerdict('Let me think.\nVerdict: base a/b')).toBeNull();
    expect(parseVerdict('**Verdict: build**\nVerdict: build')).toBeNull();
  });

  it('tolerates Windows line endings', () => {
    expect(parseVerdict('Verdict: build\r\nWhy.')).toEqual({ decision: 'build', repos: [] });
  });

  it('returns null when the line holds anything else, so every form is judged the same way', () => {
    expect(parseVerdict('Verdict: adapt foo/bar, not a repo')).toBeNull();
    expect(parseVerdict('Verdict: reuse foo/bar (best fit)')).toBeNull();
    expect(parseVerdict('Verdict: reuse https://github.com/foo/bar')).toBeNull();
    expect(parseVerdict('Verdict: build because nothing fits')).toBeNull();
    expect(parseVerdict('Verdict: build, but borrow a/b')).toBeNull();
    expect(parseVerdict('Verdict: reuse')).toBeNull();
  });
});
