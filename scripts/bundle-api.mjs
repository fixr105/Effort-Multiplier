import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('api', { recursive: true });

await build({
  entryPoints: { handler: 'server/vercel-handler.ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outdir: 'api',
  entryNames: '[name]',
  packages: 'external',
  external: ['node:sqlite'],
});
