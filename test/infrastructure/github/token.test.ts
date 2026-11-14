import { describe, expect, it } from 'vitest';
import {
  InvalidTokenError,
  resolveToken,
  TokenMissingError,
} from '../../../src/infrastructure/github/token.ts';

const MESSAGE =
  'mouseketool needs a GitHub token: set MOUSEKETOOL_GITHUB_TOKEN or GITHUB_TOKEN, or run "gh auth login".';

describe('resolveToken', () => {
  it('prefers MOUSEKETOOL_GITHUB_TOKEN over GITHUB_TOKEN and gh', async () => {
    let ghCalls = 0;
    const resolved = await resolveToken(
      { MOUSEKETOOL_GITHUB_TOKEN: 'from-own', GITHUB_TOKEN: 'from-env' }, // pragma: allowlist secret
      async () => {
        ghCalls += 1;
        return 'from-gh';
      },
    );

    expect(resolved).toEqual({ value: 'from-own', source: 'MOUSEKETOOL_GITHUB_TOKEN' });
    expect(ghCalls).toBe(0);
  });

  it('takes GITHUB_TOKEN when MOUSEKETOOL_GITHUB_TOKEN is unset, and does not call gh', async () => {
    let ghCalls = 0;
    const resolved = await resolveToken({ GITHUB_TOKEN: 'from-env' }, async () => { // pragma: allowlist secret
      ghCalls += 1;
      return 'from-gh';
    });

    expect(resolved).toEqual({ value: 'from-env', source: 'GITHUB_TOKEN' });
    expect(ghCalls).toBe(0);
  });

  it('falls back to gh when the environment has no token', async () => {
    expect(await resolveToken({}, async () => 'from-gh')).toEqual({ value: 'from-gh', source: 'gh auth token' });
  });

  it('treats a blank MOUSEKETOOL_GITHUB_TOKEN or GITHUB_TOKEN as missing', async () => {
    expect(
      await resolveToken({ MOUSEKETOOL_GITHUB_TOKEN: ' ', GITHUB_TOKEN: 'from-env' }, async () => null), // pragma: allowlist secret
    ).toEqual({ value: 'from-env', source: 'GITHUB_TOKEN' });
    expect(await resolveToken({ GITHUB_TOKEN: '   ' }, async () => 'from-gh')).toEqual({
      value: 'from-gh',
      source: 'gh auth token',
    });
  });

  it('throws TokenMissingError with the exact message when there is no token anywhere', async () => {
    const error = await resolveToken({}, async () => null).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TokenMissingError);
    expect((error as Error).message).toBe(MESSAGE);
  });

  it('treats an empty gh output as missing', async () => {
    await expect(resolveToken({}, async () => '  \n')).rejects.toBeInstanceOf(TokenMissingError);
  });

  describe('a value that is not a plain token', () => {
    const MULTILINE = 'first-line\nsecond-line';

    it('rejects a GITHUB_TOKEN with an embedded newline, naming the source but not the value', async () => {
      const error = await resolveToken({ GITHUB_TOKEN: MULTILINE }, async () => null).catch( // pragma: allowlist secret
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(InvalidTokenError);
      expect((error as Error).message).toContain('GITHUB_TOKEN');
      expect((error as Error).message).not.toContain('first-line');
      expect((error as Error).message).not.toContain('second-line');
    });

    it('rejects an invalid MOUSEKETOOL_GITHUB_TOKEN, naming it, instead of falling back to GITHUB_TOKEN', async () => {
      const error = await resolveToken(
        { MOUSEKETOOL_GITHUB_TOKEN: MULTILINE, GITHUB_TOKEN: 'from-env' }, // pragma: allowlist secret
        async () => null,
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InvalidTokenError);
      expect((error as Error).message).toContain('MOUSEKETOOL_GITHUB_TOKEN');
      expect((error as Error).message).not.toContain('first-line');
    });

    it('rejects a gh output with extra lines, naming gh but not the value', async () => {
      const error = await resolveToken({}, async () => `${MULTILINE}\n`).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InvalidTokenError);
      expect((error as Error).message).toContain('gh auth token');
      expect((error as Error).message).not.toContain('first-line');
    });

    it('rejects an embedded space or control character', async () => {
      await expect(resolveToken({ GITHUB_TOKEN: 'a b' }, async () => null)).rejects.toBeInstanceOf( // pragma: allowlist secret
        InvalidTokenError,
      );
      await expect(resolveToken({}, async () => 'a\u0007b')).rejects.toBeInstanceOf(
        InvalidTokenError,
      );
    });

    it('does not fall back to gh when the environment token is invalid', async () => {
      let ghCalls = 0;

      await expect(
        resolveToken({ GITHUB_TOKEN: MULTILINE }, async () => { // pragma: allowlist secret
          ghCalls += 1;
          return 'from-gh';
        }),
      ).rejects.toBeInstanceOf(InvalidTokenError);
      expect(ghCalls).toBe(0);
    });
  });
});
