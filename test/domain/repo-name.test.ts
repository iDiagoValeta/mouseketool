import { describe, expect, it } from 'vitest';
import { InvalidRepoNameError, parseRepoName } from '../../src/domain/repo-name.ts';

describe('parseRepoName', () => {
  it.each([
    ['https://github.com/Foo/Bar', 'foo/bar'],
    ['foo/bar/', 'foo/bar'],
    ['Foo/Bar.git', 'foo/bar'],
    ['github.com/foo/bar', 'foo/bar'],
    ['  foo/bar  ', 'foo/bar'],
    ['Foo/.github', 'foo/.github'],
    ['https://github.com/foo/bar/tree/main/src', 'foo/bar'],
    ['https://github.com/foo/bar/blob/main/README.md#usage', 'foo/bar'],
    ['https://www.github.com/foo/bar#readme', 'foo/bar'],
    ['github.com/foo/bar?tab=readme-ov-file', 'foo/bar'],
    ['https://github.com/foo/bar.git', 'foo/bar'],
  ])('normalises %s to %s', (input, expected) => {
    expect(parseRepoName(input)).toBe(expected);
  });

  it.each([
    'foo',
    'foo/bar/baz',
    '',
    'foo/',
    '/bar',
    'foo/bar baz',
    'foo/..',
    'foo/.',
    'https://github.com/foo',
    'https://github.com/foo/..',
    'https://gitlab.com/foo/bar',
  ])(
    'rejects %j',
    (input) => {
      expect(() => parseRepoName(input)).toThrow(InvalidRepoNameError);
    },
  );

  it('reports the offending input in the error message', () => {
    expect(() => parseRepoName('foo')).toThrow('Expected "owner/name", got "foo"');
  });

  it('names the error class so callers can tell it apart', () => {
    const error = new InvalidRepoNameError('foo');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InvalidRepoNameError');
  });
});
