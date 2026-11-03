import { describe, expect, it } from 'vitest';
import { resolveToken, TokenMissingError } from '../../../src/infrastructure/github/token.ts';

const MESSAGE = 'mouseketool needs a GitHub token: set GITHUB_TOKEN or run "gh auth login".';

describe('resolveToken', () => {
  it('prefers GITHUB_TOKEN and does not call gh', async () => {
    let ghCalls = 0;
    const token = await resolveToken({ GITHUB_TOKEN: 'from-env' }, async () => { // pragma: allowlist secret
      ghCalls += 1;
      return 'from-gh';
    });

    expect(token).toBe('from-env');
    expect(ghCalls).toBe(0);
  });

  it('falls back to gh when the environment has no token', async () => {
    expect(await resolveToken({}, async () => 'from-gh')).toBe('from-gh');
  });

  it('treats a blank GITHUB_TOKEN as missing', async () => {
    expect(await resolveToken({ GITHUB_TOKEN: '   ' }, async () => 'from-gh')).toBe('from-gh');
  });

  it('throws TokenMissingError with the exact message when there is no token anywhere', async () => {
    const error = await resolveToken({}, async () => null).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TokenMissingError);
    expect((error as Error).message).toBe(MESSAGE);
  });

  it('treats an empty gh output as missing', async () => {
    await expect(resolveToken({}, async () => '  \n')).rejects.toBeInstanceOf(TokenMissingError);
  });
});
