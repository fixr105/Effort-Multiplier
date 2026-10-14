import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';

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

const routes = [
  'api/ready.js',
  'api/integrations/index.js',
  'api/integrations/[product]/status.js',
  'api/integrations/zoho/callback.js',
  'api/integrations/zoho/connect.js',
  'api/integrations/zoho/status.js',
  'api/integrations/zoho/leads.js',
  'api/integrations/zoho/disconnect.js',
  'api/integrations/zoho/[product]/connect.js',
  'api/integrations/zoho/[product]/disconnect.js',
  'api/integrations/zoho/[product]/preview.js',
  'api/integrations/zoho/[product]/organization.js',
];

for (const route of routes) {
  const spec = relative(dirname(route), 'api/handler.js').replaceAll('\\', '/');
  const specifier = spec.startsWith('.') ? spec : `./${spec}`;
  await mkdir(dirname(route), { recursive: true });
  await writeFile(route, `export { default } from '${specifier}';\n`);
}
