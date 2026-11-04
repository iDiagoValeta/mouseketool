import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('plugin manifest', () => {
  it('declares the mouseketool server inline, with the plugin root variable', () => {
    const manifest = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8')) as {
      mcpServers?: Record<string, { command: string; args: string[] }>;
    };
    expect(manifest.mcpServers).toEqual({
      mouseketool: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/server.mjs'] },
    });
  });

  it('has no root .mcp.json, which Claude Code would also load as a project config where the variable is unset', () => {
    expect(existsSync('.mcp.json')).toBe(false);
  });
});
