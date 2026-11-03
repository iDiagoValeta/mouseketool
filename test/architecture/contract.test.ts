import { readFile } from 'node:fs/promises';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const fixture = new URL('./fixtures/domain-imports-infra.ts', import.meta.url);

describe('architecture contract', () => {
  it('rejects a domain file that imports infrastructure', async () => {
    const code = await readFile(fixture, 'utf8');
    const eslint = new ESLint();

    const [result] = await eslint.lintText(code, { filePath: 'src/domain/x.ts' });
    const restricted = result?.messages.filter((message) => message.ruleId === 'no-restricted-imports') ?? [];

    expect(restricted.length).toBeGreaterThan(0);
  });
});
