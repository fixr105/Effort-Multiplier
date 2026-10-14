import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig } from './config.ts';
import { loadGoogleConfig } from './google-config.ts';
import { handleZohoRequest, IDENTITY, type ServerDeps } from './app.ts';
import { openConfiguredStore } from './open-store.ts';
import { openPostgresStore } from './postgres-store.ts';

let ready: Promise<ServerDeps> | null = null;

const REQUIRED_TABLES = ['oauth_states', 'sessions', 'zoho_connections', 'google_grants', 'google_connections'];

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

function restoreForwardedPath(req: IncomingMessage): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const forwarded = url.searchParams.get('em_path');
  if (forwarded === null) return;
  url.searchParams.delete('em_path');
  const suffix = forwarded.replace(/^\/+/, '');
  url.pathname = suffix ? `/api/${suffix}` : '/api';
  const query = url.searchParams.toString();
  req.url = query ? `${url.pathname}?${query}` : url.pathname;
}

function context(): Promise<ServerDeps> {
  if (!ready) {
    ready = (async () => {
      const config = loadConfig(process.env);
      const store = await openConfiguredStore(config);
      return { config, store, googleConfig: loadGoogleConfig(process.env, config.production) };
    })();
  }
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  restoreForwardedPath(req);
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
