import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('api', { recursive: true });

await build({
  entryPoints: ['server/vercel-handler.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'server/vercel-bundle.js',
  packages: 'external',
  external: ['node:sqlite'],
});

await writeFile('api/dispatch.js', "export { default } from '../server/vercel-bundle.js';\n");
