import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.env')) {
  console.error(
    'Missing .env. Copy .env.example to .env, generate SESSION_SECRET and TOKEN_ENCRYPTION_KEY, and add the Zoho client credentials.',
  );
  process.exit(1);
}

const node = process.execPath;
const server = spawn(
  node,
  ['--disable-warning=ExperimentalWarning', '--env-file=.env', 'server/index.ts'],
  { stdio: 'inherit' },
);
const client = spawn(
  node,
  ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0', '--port', '5173', '--strictPort'],
  { stdio: 'inherit' },
);

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.kill('SIGTERM');
  client.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
server.on('exit', (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});
client.on('exit', (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});
