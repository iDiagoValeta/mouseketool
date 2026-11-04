import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'coverage', '.dev', 'test/architecture/fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Hexagonal boundary: the domain and application layers must not depend on infrastructure.
    // Subpaths are globbed so that a deep import such as @modelcontextprotocol/sdk/server/... is caught too.
    files: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['**/infrastructure/**', '@modelcontextprotocol/**'],
          paths: ['node:child_process', 'node:fs', 'node:fs/promises'],
        },
      ],
    },
  },
  {
    // Driving adapter: the MCP server reaches sources and logs through the ports only. The patterns have no
    // `infrastructure/` prefix because the sibling import is written `../github/...`, which that prefix misses.
    files: ['src/infrastructure/mcp/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/github/**', '**/run-log/**'],
              message: 'The MCP adapter must not import another adapter; use the ports in src/application/ports.',
            },
          ],
        },
      ],
    },
  },
);
