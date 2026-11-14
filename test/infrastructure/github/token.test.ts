import { describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InvalidTokenError,
  resolveToken,
  TokenFileError,
  TokenMissingError,
  tokenFilePath,
} from '../../../src/infrastructure/github/token.ts';

/** A config directory holding `mouseketool/token` with the given content. */
function configWithToken(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mouseketool-token-'));
  mkdirSync(join(dir, 'mouseketool'));
  writeFileSync(join(dir, 'mouseketool', 'token'), content, { mode: 0o600 });
  return dir;
}

const MESSAGE =
  'mouseketool needs a GitHub token: save one in ~/.config/mouseketool/token, set MOUSEKETOOL_GITHUB_TOKEN ' +
  'or GITHUB_TOKEN, or run "gh auth login".';

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

  describe('the token file', () => {
    it('is read from XDG_CONFIG_HOME, else from HOME/.config, and not at all without either', () => {
      expect(tokenFilePath({ XDG_CONFIG_HOME: '/x', HOME: '/h' })).toBe('/x/mouseketool/token');
      expect(tokenFilePath({ HOME: '/h' })).toBe('/h/.config/mouseketool/token');
      expect(tokenFilePath({})).toBeNull();
    });

    it('comes after MOUSEKETOOL_GITHUB_TOKEN and before GITHUB_TOKEN and gh, named by its path', async () => {
      const dir = configWithToken('from-file\n');
      const path = join(dir, 'mouseketool', 'token');

      expect(
        await resolveToken({ XDG_CONFIG_HOME: dir, MOUSEKETOOL_GITHUB_TOKEN: 'from-own' }, async () => null), // pragma: allowlist secret
      ).toEqual({ value: 'from-own', source: 'MOUSEKETOOL_GITHUB_TOKEN' });
      expect(
        await resolveToken({ XDG_CONFIG_HOME: dir, GITHUB_TOKEN: 'from-env' }, async () => 'from-gh'), // pragma: allowlist secret
      ).toEqual({ value: 'from-file', source: path });
    });

    it('counts a missing or blank file as missing', async () => {
      const empty = mkdtempSync(join(tmpdir(), 'mouseketool-token-'));
      expect(await resolveToken({ XDG_CONFIG_HOME: empty }, async () => 'from-gh')).toEqual({
        value: 'from-gh',
        source: 'gh auth token',
      });
      expect(await resolveToken({ XDG_CONFIG_HOME: configWithToken(' \n') }, async () => 'from-gh')).toEqual({
        value: 'from-gh',
        source: 'gh auth token',
      });
    });

    it('stops at an invalid file, naming its path but not the value', async () => {
      const dir = configWithToken('first-line\nsecond-line\n');
      const error = await resolveToken({ XDG_CONFIG_HOME: dir, GITHUB_TOKEN: 'from-env' }, async () => null).catch( // pragma: allowlist secret
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(InvalidTokenError);
      expect((error as Error).message).toContain(join(dir, 'mouseketool', 'token'));
      expect((error as Error).message).not.toContain('first-line');
    });

    it.skipIf(process.getuid?.() === 0)('stops at a file it cannot read instead of falling back', async () => {
      const dir = configWithToken('from-file');
      chmodSync(join(dir, 'mouseketool', 'token'), 0o000);

      await expect(
        resolveToken({ XDG_CONFIG_HOME: dir, GITHUB_TOKEN: 'from-env' }, async () => null), // pragma: allowlist secret
      ).rejects.toBeInstanceOf(TokenFileError);
    });
  });
});
