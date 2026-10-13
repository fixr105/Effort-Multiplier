import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config.ts';
import { decryptString, encryptString } from './crypto.ts';
import { assertAccountsOrigin, DomainError } from './domains.ts';
import {
  createOauthState,
  createSessionId,
  OAUTH_STATE_TTL_MS,
  readCookie,
  serializeSessionCookie,
  SESSION_COOKIE,
  SESSION_ROTATE_AFTER_MS,
  SESSION_TTL_MS,
  signSession,
  verifySessionToken,
} from './session.ts';
import type { SessionRecord, StoredConnection, TokenStore } from './store.ts';
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  fetchLeads,
  refreshAccessToken,
  revokeRefreshToken,
  ZOHO_SCOPE,
  ZohoRequestError,
} from './zoho.ts';

const ACCESS_REFRESH_SKEW_MS = 60_000;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_PATTERN = /^[A-Za-z0-9._~-]{1,1024}$/;
const IDENTITY = 'local-browser-session';

const PUBLIC_MESSAGES = {
  not_connected: 'Zoho CRM is not connected.',
  rate_limited: 'Zoho rate limit reached. Try again shortly.',
  missing_scope:
    'Zoho did not allow Leads read access. Reconnect and grant the requested permission.',
  reconnect_required: 'The Zoho connection expired. Reconnect Zoho CRM.',
  provider_unavailable: 'Zoho could not be reached. No data was changed.',
  provider_error: 'Zoho could not complete the request.',
  server_error: 'The request could not be completed.',
} as const;

type PublicError = keyof typeof PUBLIC_MESSAGES;

export type LogFields = Record<string, string | number | boolean>;
export type Logger = (event: string, fields?: LogFields) => void;

export interface ServerDeps {
  config: AppConfig;
  store: TokenStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: Logger;
}

interface ActiveSession {
  session: SessionRecord;
  cookie: string | null;
}

export function createZohoServer(deps: ServerDeps): Server {
  return createServer((req, res) => {
    void handleRequest(req, res, deps).catch(() => {
      loggerOf(deps)('request_failed');
      if (!res.headersSent) {
        sendJson(res, 500, publicError('server_error'));
      }
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  if (!(await discardBody(req))) {
    sendJson(res, 413, publicError('server_error'));
    return;
  }

  const path = requestPath(req.url);
  const method = req.method ?? 'GET';

  if (path === '/api/integrations/zoho/connect' && method === 'GET') {
    await handleConnect(req, res, deps);
    return;
  }
  if (path === '/api/integrations/zoho/callback' && method === 'GET') {
    await handleCallback(req, res, deps);
    return;
  }
  if (path === '/api/integrations/zoho/status' && method === 'GET') {
    await handleStatus(req, res, deps);
    return;
  }
  if (path === '/api/integrations/zoho/leads' && method === 'GET') {
    await handleLeads(req, res, deps);
    return;
  }
  if (path === '/api/integrations/zoho/disconnect' && method === 'POST') {
    await handleDisconnect(req, res, deps);
    return;
  }
  if (path.startsWith('/api/integrations/zoho/')) {
    sendJson(res, 405, publicError('server_error'));
    return;
  }
  sendJson(res, 404, publicError('server_error'));
}

async function handleConnect(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const now = clock(deps);
  const existing = resolveSession(req, deps, false);
  let session = existing?.session ?? null;
  let cookie = existing?.cookie ?? null;
  if (!session) {
    session = newSession(now, null);
    deps.store.createSession(session);
    cookie = cookieFor(session, deps, now);
  }

  const state = createOauthState();
  deps.store.saveOauthState(state, session.id, now + OAUTH_STATE_TTL_MS);
  const location = buildAuthorizationUrl({
    clientId: deps.config.clientId,
    redirectUri: deps.config.redirectUri,
    state,
  });
  redirect(res, location, cookie);
}

async function handleCallback(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const params = requestParams(req.url);
  const errorParam = bounded(params.get('error'), 64);
  const state = bounded(params.get('state'), 128);
  const active = resolveSession(req, deps, false);

  if (errorParam) {
    consumeIfValid(deps, state, active?.session.id ?? null);
    redirect(
      res,
      errorLocation(errorParam === 'access_denied' ? 'access_denied' : 'provider_error'),
    );
    return;
  }

  if (!active) {
    redirect(res, errorLocation('invalid_state'));
    return;
  }
  if (!state || !STATE_PATTERN.test(state)) {
    redirect(res, errorLocation('invalid_state'));
    return;
  }

  const code = bounded(params.get('code'), 1024);
  if (!code || !CODE_PATTERN.test(code)) {
    consumeIfValid(deps, state, active.session.id);
    redirect(res, errorLocation('missing_code'));
    return;
  }

  const accountsServer = bounded(params.get('accounts-server'), 200);
  let accountsOrigin: string;
  try {
    accountsOrigin = accountsServer ? assertAccountsOrigin(accountsServer) : '';
  } catch {
    accountsOrigin = '';
  }
  if (!accountsOrigin) {
    consumeIfValid(deps, state, active.session.id);
    redirect(res, errorLocation('invalid_accounts_server'));
    return;
  }

  const consumed = deps.store.consumeOauthState(state, active.session.id, clock(deps));
  if (!consumed) {
    redirect(res, errorLocation('invalid_state'));
    return;
  }

  try {
    const tokens = await exchangeAuthorizationCode(
      {
        accountsServer: accountsOrigin,
        clientId: deps.config.clientId,
        clientSecret: deps.config.clientSecret,
        redirectUri: deps.config.redirectUri,
        code,
      },
      fetchOf(deps),
    );
    if (!tokens.refreshToken) {
      redirect(res, errorLocation('missing_refresh_token'));
      return;
    }
    const now = clock(deps);
    const next = newSession(now, active.session.userId);
    const rotated = deps.store.rotateSession(active.session.id, now, next);
    if (!rotated) {
      redirect(res, errorLocation('provider_error'));
      return;
    }

    const connectionId = randomUUID();
    const createdAt = now;
    deps.store.saveConnection({
      id: connectionId,
      sessionId: rotated.id,
      userId: rotated.userId,
      accountsOrigin,
      apiOrigin: tokens.apiOrigin,
      accessToken: encryptString(tokens.accessToken, deps.config.tokenEncryptionKey, connectionId),
      refreshToken: encryptString(
        tokens.refreshToken,
        deps.config.tokenEncryptionKey,
        connectionId,
      ),
      accessTokenExpiresAt: now + tokens.expiresIn * 1000,
      scope: ZOHO_SCOPE,
      createdAt,
      updatedAt: createdAt,
    });
    redirect(res, '/?zoho=connected', cookieFor(rotated, deps, now));
  } catch (error) {
    const reason = callbackReason(error);
    if (error instanceof ZohoRequestError && error.providerCode) {
      loggerOf(deps)('token_exchange_failed', { providerCode: error.providerCode });
    } else {
      loggerOf(deps)(reason);
    }
    redirect(res, errorLocation(reason));
  }
}

async function handleStatus(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const active = resolveSession(req, deps, true);
  if (!active) {
    sendJson(res, 200, { connected: false, identity: IDENTITY });
    return;
  }
  const connection = deps.store.getConnection(ownerOf(active.session));
  sendJson(res, 200, statusBody(connection), active.cookie);
}

async function handleLeads(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const active = resolveSession(req, deps, true);
  if (!active) {
    sendJson(res, 401, publicError('not_connected'));
    return;
  }

  const owner = ownerOf(active.session);
  let connection = deps.store.getConnection(owner);
  if (!connection) {
    sendJson(res, 401, publicError('not_connected'), active.cookie);
    return;
  }

  try {
    connection = await refreshIfDue(connection, deps, false);
    let accessToken = readSecret(connection, deps, 'access');
    if (!accessToken) {
      deps.store.deleteConnection(owner);
      sendJson(res, 401, publicError('reconnect_required'), active.cookie);
      return;
    }

    try {
      const leads = await fetchLeads(
        { apiOrigin: connection.apiOrigin, accessToken },
        fetchOf(deps),
      );
      sendJson(
        res,
        200,
        { leads, apiDomain: connection.apiOrigin },
        active.cookie,
      );
    } catch (error) {
      if (!(error instanceof ZohoRequestError) || error.kind !== 'invalid_token') {
        throw error;
      }
      connection = await refreshIfDue(connection, deps, true);
      accessToken = readSecret(connection, deps, 'access');
      if (!accessToken) {
        deps.store.deleteConnection(owner);
        sendJson(res, 401, publicError('reconnect_required'), active.cookie);
        return;
      }
      const leads = await fetchLeads(
        { apiOrigin: connection.apiOrigin, accessToken },
        fetchOf(deps),
      );
      sendJson(
        res,
        200,
        { leads, apiDomain: connection.apiOrigin },
        active.cookie,
      );
    }
  } catch (error) {
    if (error instanceof ZohoRequestError) {
      if (error.providerCode) {
        loggerOf(deps)(error.kind, { providerCode: error.providerCode });
      }
      const mapped = zohoHttpError(error);
      if (mapped.code === 'reconnect_required') {
        deps.store.deleteConnection(owner);
      }
      sendJson(res, mapped.status, publicError(mapped.code), active.cookie);
      return;
    }
    loggerOf(deps)('provider_error');
    sendJson(res, 502, publicError('provider_error'), active.cookie);
  }
}

async function handleDisconnect(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const active = resolveSession(req, deps, true);
  if (!active) {
    sendJson(res, 200, { disconnected: true, revoked: false });
    return;
  }

  const owner = ownerOf(active.session);
  const connection = deps.store.getConnection(owner);
  if (!connection) {
    sendJson(res, 200, { disconnected: true, revoked: false }, active.cookie);
    return;
  }

  let revoked = false;
  const refreshToken = readSecret(connection, deps, 'refresh');
  if (refreshToken) {
    revoked = await revokeRefreshToken(
      { accountsOrigin: connection.accountsOrigin, refreshToken },
      fetchOf(deps),
    );
  }
  deps.store.deleteConnection(owner);
  sendJson(res, 200, { disconnected: true, revoked }, active.cookie);
}

async function refreshIfDue(
  connection: StoredConnection,
  deps: ServerDeps,
  force: boolean,
): Promise<StoredConnection> {
  const now = clock(deps);
  const due = connection.accessTokenExpiresAt - ACCESS_REFRESH_SKEW_MS <= now;
  if (!force && !due) return connection;

  const refreshToken = readSecret(connection, deps, 'refresh');
  if (!refreshToken) {
    throw new ZohoRequestError('invalid_token');
  }

  const next = await refreshAccessToken(
    {
      accountsOrigin: connection.accountsOrigin,
      clientId: deps.config.clientId,
      clientSecret: deps.config.clientSecret,
      refreshToken,
    },
    fetchOf(deps),
  );

  const updated: StoredConnection = {
    ...connection,
    apiOrigin: next.apiOrigin,
    accessToken: encryptString(next.accessToken, deps.config.tokenEncryptionKey, connection.id),
    refreshToken: next.refreshToken
      ? encryptString(next.refreshToken, deps.config.tokenEncryptionKey, connection.id)
      : connection.refreshToken,
    accessTokenExpiresAt: now + next.expiresIn * 1000,
    updatedAt: now,
  };
  deps.store.updateConnectionSecrets(updated);
  return updated;
}

function resolveSession(
  req: IncomingMessage,
  deps: ServerDeps,
  rotate: boolean,
): ActiveSession | null {
  const now = clock(deps);
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  const payload = verifySessionToken(token, deps.config.sessionSecret, now);
  if (!payload) return null;
  const session = deps.store.getSession(payload.sid);
  if (!session || session.expiresAt <= now || session.id !== payload.sid) return null;

  if (rotate && now - session.createdAt >= SESSION_ROTATE_AFTER_MS) {
    const next = newSession(now, session.userId);
    const rotated = deps.store.rotateSession(session.id, now, next);
    if (!rotated) return null;
    return { session: rotated, cookie: cookieFor(rotated, deps, now) };
  }
  return { session, cookie: null };
}

function newSession(now: number, userId: string | null): SessionRecord {
  return {
    id: createSessionId(),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    userId,
  };
}

function cookieFor(session: SessionRecord, deps: ServerDeps, now: number): string {
  const token = signSession(
    { sid: session.id, iat: session.createdAt, exp: session.expiresAt },
    deps.config.sessionSecret,
  );
  return serializeSessionCookie(token, {
    production: deps.config.production,
    maxAgeSeconds: Math.max(0, Math.floor((session.expiresAt - now) / 1000)),
  });
}

function ownerOf(session: SessionRecord) {
  return { sessionId: session.id, userId: session.userId };
}

function readSecret(
  connection: StoredConnection,
  deps: ServerDeps,
  which: 'access' | 'refresh',
): string | null {
  try {
    const secret = which === 'access' ? connection.accessToken : connection.refreshToken;
    const value = decryptString(secret, deps.config.tokenEncryptionKey, connection.id);
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function statusBody(connection: StoredConnection | null) {
  if (!connection) {
    return { connected: false, identity: IDENTITY };
  }
  return {
    connected: true,
    apiDomain: connection.apiOrigin,
    scope: connection.scope,
    identity: IDENTITY,
  };
}

function consumeIfValid(
  deps: ServerDeps,
  state: string | null,
  sessionId: string | null,
): void {
  if (!state || !sessionId || !STATE_PATTERN.test(state)) return;
  deps.store.consumeOauthState(state, sessionId, clock(deps));
}

type CallbackReason =
  | 'access_denied'
  | 'invalid_state'
  | 'missing_code'
  | 'invalid_accounts_server'
  | 'token_exchange_failed'
  | 'invalid_api_domain'
  | 'missing_refresh_token'
  | 'provider_error';

function callbackReason(error: unknown): CallbackReason {
  if (error instanceof DomainError) {
    return error.kind === 'invalid_accounts_server'
      ? 'invalid_accounts_server'
      : 'invalid_api_domain';
  }
  if (error instanceof ZohoRequestError) {
    switch (error.kind) {
      case 'token_exchange_failed':
        return 'token_exchange_failed';
      case 'missing_refresh_token':
        return 'missing_refresh_token';
      case 'invalid_api_domain':
        return 'invalid_api_domain';
      case 'provider_unavailable':
      case 'rate_limited':
      case 'invalid_token':
      case 'missing_scope':
      case 'provider_error':
        return 'provider_error';
      default: {
        const neverKind: never = error.kind;
        return neverKind;
      }
    }
  }
  return 'provider_error';
}

function zohoHttpError(error: ZohoRequestError): { status: number; code: PublicError } {
  switch (error.kind) {
    case 'rate_limited':
      return { status: 429, code: 'rate_limited' };
    case 'missing_scope':
      return { status: 403, code: 'missing_scope' };
    case 'invalid_token':
      return { status: 401, code: 'reconnect_required' };
    case 'provider_unavailable':
      return { status: 503, code: 'provider_unavailable' };
    case 'token_exchange_failed':
      if (isDeadGrant(error)) return { status: 401, code: 'reconnect_required' };
      return { status: 502, code: 'provider_error' };
    case 'missing_refresh_token':
    case 'invalid_api_domain':
    case 'provider_error':
      return { status: 502, code: 'provider_error' };
    default: {
      const neverKind: never = error.kind;
      return neverKind;
    }
  }
}

function isDeadGrant(error: ZohoRequestError): boolean {
  return (
    error.providerCode === 'invalid_code' ||
    error.providerCode === 'invalid_grant' ||
    error.providerCode === 'invalid_token'
  );
}

function publicError(code: PublicError) {
  return { error: code, message: PUBLIC_MESSAGES[code] };
}

function errorLocation(reason: CallbackReason): string {
  return `/?${new URLSearchParams({ zoho: 'error', reason }).toString()}`;
}

function redirect(res: ServerResponse, location: string, cookie?: string | null): void {
  const headers: Record<string, string> = {
    Location: location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(302, headers);
  res.end();
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  cookie?: string | null,
): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string | number> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(payload),
  };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(status, headers);
  res.end(payload);
}

function requestPath(rawUrl: string | undefined): string {
  const path = (rawUrl ?? '/').split('?')[0] ?? '/';
  return path.length > 0 ? path : '/';
}

function requestParams(rawUrl: string | undefined): URLSearchParams {
  try {
    return new URL(rawUrl ?? '/', 'http://127.0.0.1').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function bounded(value: string | null, max: number): string | null {
  if (value === null || value.length === 0 || value.length > max) return null;
  return value;
}

async function discardBody(req: IncomingMessage): Promise<boolean> {
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024) {
      req.destroy();
      return false;
    }
  }
  return true;
}

function clock(deps: ServerDeps): number {
  return deps.now ? deps.now() : Date.now();
}

function fetchOf(deps: ServerDeps): typeof fetch {
  return deps.fetchImpl ?? fetch;
}

function loggerOf(deps: ServerDeps): Logger {
  return (
    deps.logger ??
    ((event, fields) => {
      const suffix = fields
        ? ` ${Object.entries(fields)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(' ')}`
        : '';
      console.info(`[zoho] ${event}${suffix}`);
    })
  );
}
