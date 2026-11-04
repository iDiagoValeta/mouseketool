import { readFile } from 'node:fs/promises';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

async function restrictedImports(fixture: string, filePath: string) {
  const code = await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), 'utf8');
  const [result] = await new ESLint().lintText(code, { filePath });
  return result?.messages.filter((message) => message.ruleId === 'no-restricted-imports') ?? [];
}

describe('architecture contract', () => {
  it('rejects a domain file that imports infrastructure', async () => {
    const restricted = await restrictedImports('domain-imports-infra.ts', 'src/domain/x.ts');

    expect(restricted.length).toBeGreaterThan(0);
  });

  it('rejects an MCP adapter file that imports the GitHub or run log adapters', async () => {
    const restricted = await restrictedImports('mcp-imports-adapter.ts', 'src/infrastructure/mcp/x.ts');

    // One message per import: the GitHub adapter and the run log adapter.
    expect(restricted).toHaveLength(2);
  });

  it('lets the composition root import every adapter', async () => {
    const restricted = await restrictedImports('mcp-imports-adapter.ts', 'src/composition-root.ts');

    expect(restricted).toEqual([]);
  });
});
