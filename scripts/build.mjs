// Bundles the server and every dependency into dist/server.mjs, which is committed: an installed plugin is a
// copy of the repository and runs no build, so the bundle must need nothing but Node. The licenses of the
// bundled packages ship next to it, as their terms ask.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const { metafile } = await build({
  entryPoints: [join(root, 'src/main.ts')],
  outfile: join(dist, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  minify: true,
  legalComments: 'none',
  metafile: true,
  // Some bundled packages are CommonJS and call require, which an ES module does not have.
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
});

// Each bundled package once, found by the last node_modules/ segment of its files' paths.
const packages = new Map();
for (const input of Object.keys(metafile.inputs)) {
  const at = input.lastIndexOf('node_modules/');
  if (at === -1) continue;
  const parts = input.slice(at + 'node_modules/'.length).split('/');
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
  packages.set(name, join(root, input.slice(0, at), 'node_modules', name));
}

const sections = [...packages.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, dir]) => {
    const { version, license } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const file = readdirSync(dir).find((entry) => /^licen[cs]e/i.test(entry));
    if (file === undefined) throw new Error(`${name} ships no license file`);
    return `## ${name} ${version} (${license})\n\n${readFileSync(join(dir, file), 'utf8').trim()}\n`;
  });

writeFileSync(
  join(dist, 'THIRD_PARTY_LICENSES.md'),
  `# Third-party licenses\n\n\`server.mjs\` bundles these packages.\n\n${sections.join('\n')}`,
);
