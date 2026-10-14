import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig, type AppConfig } from './config.ts';
import { handleZohoRequest, IDENTITY } from './app.ts';
import { openConfiguredStore } from './open-store.ts';
import { openPostgresStore } from './postgres-store.ts';
import type { TokenStore } from './store.ts';

let ready: Promise<{ config: AppConfig; store: TokenStore }> | null = null;

const REQUIRED_TABLES = ['oauth_states', 'sessions', 'zoho_connections'];

async function reportDatabaseHealth(res: ServerResponse): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || '';
  if (!databaseUrl) {
    sendJson(res, 503, { ok: false, persistence: 'unavailable', identity: IDENTITY, tables: [] });
    return;
  }
  try {
    const store = await openPostgresStore(databaseUrl);
    const ping = await store.ping();
    await store.close();
    const tables = ping.tables.filter((name) => REQUIRED_TABLES.includes(name)).sort();
    const ok = REQUIRED_TABLES.every((name) => tables.includes(name));
    sendJson(res, ok ? 200 : 503, { ok, persistence: 'postgres', identity: IDENTITY, tables });
  } catch (error) {
    sendJson(res, 503, {
      ok: false,
      persistence: 'postgres',
      identity: IDENTITY,
      tables: [],
      message: safeMessage(error),
    });
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Database check failed.';
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 180);
}

function context(): Promise<{ config: AppConfig; store: TokenStore }> {
  if (!ready) {
    ready = (async () => {
      const config = loadConfig(process.env);
      const store = await openConfiguredStore(config);
      return { config, store };
    })();
  }
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  if (path === '/api/health' || path === '/health') {
    await reportDatabaseHealth(res);
    return;
  }
  try {
    const deps = await context();
    await handleZohoRequest(req, res, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid server configuration.';
    const safe = message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]');
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'server_error', message: safe }));
    }
  }
}
