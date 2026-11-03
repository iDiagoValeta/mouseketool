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
);
