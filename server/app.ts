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
import { listOrganizations, previewProduct } from './preview.ts';
import { zohoProductById, ZOHO_PRODUCTS } from '../src/data/zohoProducts.ts';
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  fetchLeads,
  refreshAccessToken,
  revokeRefreshToken,
  ZohoRequestError,
} from './zoho.ts';

const ACCESS_REFRESH_SKEW_MS = 60_000;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_PATTERN = /^[A-Za-z0-9._~-]{1,1024}$/;
export const IDENTITY = 'local-browser-session';

const PUBLIC_MESSAGES = {
  not_connected: 'This Zoho product is not connected.',
  rate_limited: 'Zoho rate limit reached. Try again shortly.',
  missing_scope:
    'Zoho did not allow the requested read access. Reconnect and grant that permission.',
  reconnect_required: 'The Zoho connection expired. Reconnect this product.',
  provider_unavailable: 'Zoho could not be reached. No data was changed.',
  provider_error: 'Zoho could not complete the request.',
  server_error: 'The request could not be completed.',
  planned: 'This Zoho product is not available to connect yet.',
  persistence_unavailable:
    'Production token storage is not configured. Set DATABASE_URL to a Postgres database before connecting Zoho.',
} as const;

const CRM_PRODUCT = 'crm';
const ORG_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const rateBuckets = new Map<string, number[]>();

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
    void handleZohoRequest(req, res, deps).catch(() => {
      loggerOf(deps)('request_failed');
      if (!res.headersSent) {
        sendJson(res, 500, publicError('server_error'));
      }
    });
  });
}

export async function handleZohoRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const body = await readBody(req);
  if (body === null) {
    sendJson(res, 413, publicError('server_error'));
    return;
  }

  const path = requestPath(req.url);
  const method = req.method ?? 'GET';

  if (path === '/api/health' && method === 'GET') {
    await handleHealth(res, deps);
    return;
  }
  if (path === '/api/ready' && method === 'GET') {
    await handleHealth(res, deps);
    return;
  }
  if (path === '/api/integrations' && method === 'GET') {
    await handleCatalog(req, res, deps);
    return;
  }
  if (path === '/api/integrations/zoho/connect' && method === 'GET') {
    await handleConnect(req, res, deps, CRM_PRODUCT);
    return;
  }
  if (path === '/api/integrations/zoho/callback' && method === 'GET') {
    await handleCallback(req, res, deps);
    return;
  }
  if (path === '/api/integrations/zoho/status' && method === 'GET') {
    await handleStatus(req, res, deps, CRM_PRODUCT);
    return;
  }
  if (path === '/api/integrations/zoho/leads' && method === 'GET') {
    await handleLeads(req, res, deps);
    return;
  }
  if (path === '/api/integrations/zoho/disconnect' && method === 'POST') {
    await handleDisconnect(req, res, deps, CRM_PRODUCT);
    return;
  }

  const productRoute = path.match(
    /^\/api\/integrations\/zoho\/([a-z0-9-]+)\/(connect|disconnect|preview|organization)$/,
  );
  if (productRoute) {
    const product = productRoute[1] ?? '';
    const action = productRoute[2];
    if (action === 'connect' && method === 'GET') {
      await handleConnect(req, res, deps, product);
      return;
    }
    if (action === 'disconnect' && method === 'POST') {
      await handleDisconnect(req, res, deps, product);
      return;
    }
    if (action === 'preview' && method === 'GET') {
      await handlePreview(req, res, deps, product);
      return;
    }
    if (action === 'organization' && method === 'POST') {
      await handleOrganization(req, res, deps, product, body);
      return;
    }
    sendJson(res, 405, publicError('server_error'));
    return;
  }

  const statusRoute = path.match(/^\/api\/integrations\/([a-z0-9-]+)\/status$/);
  if (statusRoute && method === 'GET') {
    await handleStatus(req, res, deps, statusRoute[1] ?? '');
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
  productId: string,
): Promise<void> {
  const product = zohoProductById(productId);
  if (!product) {
    sendJson(res, 404, publicError('server_error'));
    return;
  }
  if (product.availability !== 'available') {
    sendJson(res, 409, publicError('planned'));
    return;
  }
  if (!persistenceReady(deps)) {
    sendJson(res, 503, publicError('persistence_unavailable'));
    return;
  }
  if (limited(req, deps, 'connect', 20, 10 * 60_000)) {
    sendJson(res, 429, publicError('rate_limited'));
    return;
  }

  const now = clock(deps);
  const existing = await resolveSession(req, deps, false);
  let session = existing?.session ?? null;
  let cookie = existing?.cookie ?? null;
  if (!session) {
    session = newSession(now, null);
    await deps.store.createSession(session);
    cookie = cookieFor(session, deps, now);
  }

  const state = createOauthState();
  await deps.store.saveOauthState(state, session.id, now + OAUTH_STATE_TTL_MS, product.id);
  const location = buildAuthorizationUrl({
    clientId: deps.config.clientId,
    redirectUri: deps.config.redirectUri,
    state,
    scope: product.scopes.join(','),
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
  const active = await resolveSession(req, deps, false);

  if (errorParam) {
    await consumeIfValid(deps, state, active?.session.id ?? null);
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
    await consumeIfValid(deps, state, active.session.id);
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
    await consumeIfValid(deps, state, active.session.id);
    redirect(res, errorLocation('invalid_accounts_server'));
    return;
  }

  const productId = await deps.store.consumeOauthState(state, active.session.id, clock(deps));
  const product = productId ? zohoProductById(productId) : null;
  if (!product || product.availability !== 'available') {
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
    const rotated = await deps.store.rotateSession(active.session.id, now, next);
    if (!rotated) {
      redirect(res, errorLocation('provider_error'));
      return;
    }

    const connectionId = randomUUID();
    const createdAt = now;
    await deps.store.saveConnection({
      id: connectionId,
      sessionId: rotated.id,
      userId: rotated.userId,
      product: product.id,
      accountsOrigin,
      apiOrigin: tokens.apiOrigin,
      accessToken: encryptString(tokens.accessToken, deps.config.tokenEncryptionKey, connectionId),
      refreshToken: encryptString(
        tokens.refreshToken,
        deps.config.tokenEncryptionKey,
        connectionId,
      ),
      accessTokenExpiresAt: now + tokens.expiresIn * 1000,
      scope: product.scopes.join(','),
      organizationId: null,
      createdAt,
      updatedAt: createdAt,
    });
    redirect(
      res,
      `/?${new URLSearchParams({ zoho: 'connected', product: product.id }).toString()}`,
      cookieFor(rotated, deps, now),
    );
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

async function handleCatalog(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const active = await resolveSession(req, deps, true);
  const connections = active
    ? await deps.store.listConnections({ sessionId: active.session.id, userId: active.session.userId })
    : [];
  const connected = new Map(connections.map((connection) => [connection.product, connection]));
  sendJson(
    res,
    200,
    {
      identity: IDENTITY,
      persistence: persistenceName(deps),
      products: ZOHO_PRODUCTS.map((product) => {
        const connection = connected.get(product.id) ?? null;
        return {
          id: product.id,
          cardId: product.cardId,
          name: product.name,
          description: product.description,
          category: product.category,
          initials: product.initials,
          icon: product.icon,
          availability: product.availability,
          docsUrl: product.docsUrl,
          note: product.note,
          connected: connection !== null,
          apiDomain: connection?.apiOrigin ?? null,
          organizationId: connection?.organizationId ?? null,
          scope: connection?.scope ?? null,
        };
      }),
    },
    active?.cookie,
  );
}

async function handleStatus(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  productId: string,
): Promise<void> {
  if (!zohoProductById(productId)) {
    sendJson(res, 404, publicError('server_error'));
    return;
  }
  const active = await resolveSession(req, deps, true);
  if (!active) {
    sendJson(res, 200, { connected: false, product: productId, identity: IDENTITY });
    return;
  }
  const connection = await deps.store.getConnection(ownerOf(active.session, productId));
  sendJson(res, 200, statusBody(connection, productId), active.cookie);
}

async function handleLeads(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const active = await resolveSession(req, deps, true);
  if (!active) {
    sendJson(res, 401, publicError('not_connected'));
    return;
  }

  const owner = ownerOf(active.session, CRM_PRODUCT);
  let connection = await deps.store.getConnection(owner);
  if (!connection) {
    sendJson(res, 401, publicError('not_connected'), active.cookie);
    return;
  }

  try {
    connection = await refreshIfDue(connection, deps, false);
    let accessToken = readSecret(connection, deps, 'access');
    if (!accessToken) {
      await deps.store.deleteConnection(owner);
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
        await deps.store.deleteConnection(owner);
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
        await deps.store.deleteConnection(owner);
      }
      sendJson(res, mapped.status, publicError(mapped.code), active.cookie);
      return;
    }
    loggerOf(deps)('provider_error');
    sendJson(res, 502, publicError('provider_error'), active.cookie);
  }
}

async function handlePreview(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  productId: string,
): Promise<void> {
  const product = zohoProductById(productId);
  if (!product || product.availability !== 'available') {
    sendJson(res, 404, publicError('server_error'));
    return;
  }
  const active = await resolveSession(req, deps, true);
  if (!active) {
    sendJson(res, 401, publicError('not_connected'));
    return;
  }
  if (limited(req, deps, 'preview', 60, 60_000)) {
    sendJson(res, 429, publicError('rate_limited'), active.cookie);
    return;
  }
  const owner = ownerOf(active.session, product.id);
  let connection = await deps.store.getConnection(owner);
  if (!connection) {
    sendJson(res, 401, publicError('not_connected'), active.cookie);
    return;
  }
  try {
    connection = await refreshIfDue(connection, deps, false);
    const accessToken = readSecret(connection, deps, 'access');
    if (!accessToken) {
      await deps.store.deleteConnection(owner);
      sendJson(res, 401, publicError('reconnect_required'), active.cookie);
      return;
    }
    let preview = await previewProduct(
      product.id,
      {
        apiOrigin: connection.apiOrigin,
        accessToken,
        organizationId: connection.organizationId,
      },
      fetchOf(deps),
    );
    if (needsSingleOrganization(product.id, connection.organizationId, preview.organizations)) {
      const only = preview.organizations[0];
      if (only && await deps.store.setOrganization(owner, only.id)) {
        connection = { ...connection, organizationId: only.id };
        preview = await previewProduct(
          product.id,
          {
            apiOrigin: connection.apiOrigin,
            accessToken,
            organizationId: only.id,
          },
          fetchOf(deps),
        );
      }
    }
    sendJson(
      res,
      200,
      {
        product: product.id,
        apiDomain: connection.apiOrigin,
        organizationId: connection.organizationId,
        needsOrganization:
          organizationProducts(product.id) &&
          !connection.organizationId &&
          preview.organizations.length > 1,
        organizations: preview.organizations,
        sections: preview.sections,
      },
      active.cookie,
    );
  } catch (error) {
    await sendZohoError(res, deps, owner, error, active.cookie);
  }
}

async function handleOrganization(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  productId: string,
  body: string,
): Promise<void> {
  if (!hasCsrfHeader(req)) {
    sendJson(res, 403, publicError('server_error'));
    return;
  }
  const product = zohoProductById(productId);
  if (!product || !organizationProducts(product.id)) {
    sendJson(res, 404, publicError('server_error'));
    return;
  }
  const active = await resolveSession(req, deps, true);
  if (!active) {
    sendJson(res, 401, publicError('not_connected'));
    return;
  }
  let requested: string | null = null;
  try {
    const parsed = JSON.parse(body) as unknown;
    const value =
      parsed && typeof parsed === 'object' && 'organizationId' in parsed
        ? (parsed as { organizationId?: unknown }).organizationId
        : null;
    requested = typeof value === 'string' ? value : null;
  } catch {
    requested = null;
  }
  if (!requested || !ORG_ID_PATTERN.test(requested)) {
    sendJson(res, 400, publicError('server_error'), active.cookie);
    return;
  }
  const owner = ownerOf(active.session, product.id);
  const connection = await deps.store.getConnection(owner);
  if (!connection) {
    sendJson(res, 401, publicError('not_connected'), active.cookie);
    return;
  }
  const accessToken = readSecret(connection, deps, 'access');
  if (!accessToken) {
    sendJson(res, 401, publicError('reconnect_required'), active.cookie);
    return;
  }
  try {
    const organizations = await listOrganizations(
      product.id,
      { apiOrigin: connection.apiOrigin, accessToken },
      fetchOf(deps),
    );
    if (!organizations.some((organization) => organization.id === requested)) {
      sendJson(res, 400, publicError('server_error'), active.cookie);
      return;
    }
    await deps.store.setOrganization(owner, requested);
    sendJson(res, 200, { organizationId: requested }, active.cookie);
  } catch (error) {
    await sendZohoError(res, deps, owner, error, active.cookie);
  }
}

async function handleDisconnect(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  productId: string,
): Promise<void> {
  if (!hasCsrfHeader(req)) {
    sendJson(res, 403, publicError('server_error'));
    return;
  }
  if (!zohoProductById(productId)) {
    sendJson(res, 404, publicError('server_error'));
    return;
  }
  const active = await resolveSession(req, deps, true);
  if (!active) {
    sendJson(res, 200, { disconnected: true, revoked: false });
    return;
  }

  const owner = ownerOf(active.session, productId);
  const connection = await deps.store.getConnection(owner);
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
  await deps.store.deleteConnection(owner);
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
  await deps.store.updateConnectionSecrets(updated);
  return updated;
}

async function resolveSession(
  req: IncomingMessage,
  deps: ServerDeps,
  rotate: boolean,
): Promise<ActiveSession | null> {
  const now = clock(deps);
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  const payload = verifySessionToken(token, deps.config.sessionSecret, now);
  if (!payload) return null;
  const session = await deps.store.getSession(payload.sid);
  if (!session || session.expiresAt <= now || session.id !== payload.sid) return null;

  if (rotate && now - session.createdAt >= SESSION_ROTATE_AFTER_MS) {
    const next = newSession(now, session.userId);
    const rotated = await deps.store.rotateSession(session.id, now, next);
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

function ownerOf(session: SessionRecord, product: string) {
  return { sessionId: session.id, userId: session.userId, product };
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

function statusBody(connection: StoredConnection | null, product: string) {
  if (!connection) {
    return { connected: false, product, identity: IDENTITY };
  }
  return {
    connected: true,
    product,
    apiDomain: connection.apiOrigin,
    scope: connection.scope,
    organizationId: connection.organizationId,
    identity: IDENTITY,
  };
}

function organizationProducts(product: string): boolean {
  return product === 'books' || product === 'inventory' || product === 'desk' || product === 'projects';
}

function needsSingleOrganization(
  product: string,
  organizationId: string | null,
  organizations: { id: string }[],
): boolean {
  return organizationProducts(product) && !organizationId && organizations.length === 1;
}

function persistenceReady(deps: ServerDeps): boolean {
  if (process.env.VERCEL === '1' && !deps.config.databaseUrl) return false;
  return true;
}

function persistenceName(deps: ServerDeps): 'postgres' | 'sqlite' | 'unavailable' {
  if (deps.config.databaseUrl) return 'postgres';
  if (!persistenceReady(deps)) return 'unavailable';
  return 'sqlite';
}

const REQUIRED_TABLES = ['oauth_states', 'sessions', 'zoho_connections'];

async function handleHealth(res: ServerResponse, deps: ServerDeps): Promise<void> {
  const persistence = persistenceName(deps);
  if (!persistenceReady(deps)) {
    sendJson(res, 503, { ok: false, persistence, identity: IDENTITY, tables: [] });
    return;
  }
  try {
    const ping = await deps.store.ping();
    const tables = ping.tables.filter((name) => REQUIRED_TABLES.includes(name)).sort();
    const ok = REQUIRED_TABLES.every((name) => tables.includes(name));
    sendJson(res, ok ? 200 : 503, { ok, persistence, identity: IDENTITY, tables });
  } catch (error) {
    loggerOf(deps)('database_check_failed');
    sendJson(res, 503, {
      ok: false,
      persistence,
      identity: IDENTITY,
      tables: [],
      message: safeDbMessage(error),
    });
  }
}

function safeDbMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Database check failed.';
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 180);
}

function hasCsrfHeader(req: IncomingMessage): boolean {
  return req.headers['x-em-request'] === '1';
}

function limited(
  req: IncomingMessage,
  deps: ServerDeps,
  action: string,
  limit: number,
  windowMs: number,
): boolean {
  if (!deps.config.production || deps.now) return false;
  const now = clock(deps);
  const session = readCookie(req.headers.cookie, SESSION_COOKIE) ?? 'anonymous';
  const key = `${action}:${session.slice(0, 32)}`;
  const recent = (rateBuckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  recent.push(now);
  rateBuckets.set(key, recent);
  return recent.length > limit;
}

async function sendZohoError(
  res: ServerResponse,
  deps: ServerDeps,
  owner: { sessionId: string; userId: string | null; product: string },
  error: unknown,
  cookie: string | null,
): Promise<void> {
  if (error instanceof ZohoRequestError) {
    if (error.providerCode) loggerOf(deps)(error.kind, { providerCode: error.providerCode });
    const mapped = zohoHttpError(error);
    if (mapped.code === 'reconnect_required') await deps.store.deleteConnection(owner);
    sendJson(res, mapped.status, publicError(mapped.code), cookie);
    return;
  }
  loggerOf(deps)('provider_error');
  sendJson(res, 502, publicError('provider_error'), cookie);
}

async function consumeIfValid(
  deps: ServerDeps,
  state: string | null,
  sessionId: string | null,
): Promise<void> {
  if (!state || !sessionId || !STATE_PATTERN.test(state)) return;
  await deps.store.consumeOauthState(state, sessionId, clock(deps));
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
  const normalized = path.length > 0 ? path : '/';
  if (normalized === '/health' || normalized.startsWith('/integrations/')) {
    return `/api${normalized}`;
  }
  return normalized;
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

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024) {
      req.destroy();
      return null;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
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
