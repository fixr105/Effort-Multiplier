import { existsSync, readFileSync } from 'node:fs';

const required = [
  'ZOHO_CLIENT_ID',
  'ZOHO_CLIENT_SECRET',
  'ZOHO_REDIRECT_URI',
  'SESSION_SECRET',
  'TOKEN_ENCRYPTION_KEY',
];

if (!existsSync('.env')) {
  console.log('env file: missing');
  for (const name of required) console.log(`${name}: missing`);
  console.log('DATABASE_URL: missing');
  process.exit(1);
}

const values = new Map();
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const index = trimmed.indexOf('=');
  if (index === -1) continue;
  values.set(trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim());
}

let missing = 0;
for (const name of required) {
  const present = Boolean(values.get(name));
  if (!present) missing += 1;
  console.log(`${name}: ${present ? 'configured' : 'missing'}`);
}
const database = Boolean(values.get('DATABASE_URL'));
console.log(`DATABASE_URL: ${database ? 'configured' : 'missing'}`);
console.log(`redirect: ${values.get('ZOHO_REDIRECT_URI') || 'missing'}`);
if (missing > 0) process.exit(1);
