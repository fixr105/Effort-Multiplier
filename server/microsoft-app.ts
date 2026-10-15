import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ServerDeps } from './app.ts';
import { decryptString, encryptString } from './crypto.ts';
import type { MicrosoftConfigState, MicrosoftSettings } from './microsoft-config.ts';
import { MicrosoftApiError, previewMicrosoftProduct } from './microsoft-api.ts';
import {
  microsoftProductById,
  requestedScopes,
  visibleMicrosoftProducts,
  type MicrosoftProductDefinition,
} from './microsoft-products.ts';
import { createMicrosoftOAuth, type MicrosoftOAuth, type MicrosoftTokenSet } from './microsoft-oauth.ts';
import {
  createOauthState,
  createSessionId,
  OAUTH_STATE_TTL_MS,
  readCookie,
  serializeSessionCookie,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  signSession,
  verifySessionToken,
} from './session.ts';
import type { MicrosoftConnectionRecord, MicrosoftGrantRecord, SessionRecord } from './store.ts';

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_PATTERN = /^[A-Za-z0-9._~%-]{1,2048}$/;
const OID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
const ACCESS_REFRESH_SKEW_MS = 60_000;

const MESSAGES = {
  configuration: 'Microsoft sign-in is not configured.',
  unavailable: 'This Microsoft product is not available to connect.',
  not_connected: 'This Microsoft product is not connected.',
  rate_limited: 'Microsoft rate limit reached. Try again shortly.',
  missing_scope: 'Microsoft did not grant the requested access. Reconnect and allow that permission.',
  reconnect_required: 'The Microsoft connection expired. Reconnect this product.',
  provider_unavailable: 'Microsoft could not be reached. No data was changed.',
  provider_error: 'Microsoft could not complete the request.',
  server_error: 'The request could not be completed.',
  persistence_unavailable: 'Production token storage is not configured. Set DATABASE_URL before connecting Microsoft.',
  forbidden: 'The request was rejected.',
} as const;

type MicrosoftCode = keyof typeof MESSAGES;

export async function handleMicrosoftRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  const method = req.method ?? 'GET';
  const microsoftConfig = configOf(deps);

  if (path === '/api/integrations/microsoft/callback' && method === 'GET') {
    await callback(req, res, deps, microsoftConfig);
    return;
  }
  if (path === '/api/integrations/microsoft' && method === 'GET') {
    await sendCatalog(req, res, deps, microsoftConfig);
    return;
  }

  const route = path.match(/^\/api\/integrations\/microsoft\/([a-z0-9-]+)\/(connect|disconnect|preview)$/);
  if (!route) {
    sendJson(res, 404, 'server_error');
    return;
  }
  const productId = route[1] ?? '';
  const action = route[2];
  if (action === 'connect' && method === 'GET') {
    await startConnect(req, res, deps, microsoftConfig, productId);
    return;
  }
  if (action === 'disconnect' && method === 'POST') {
    await disconnect(req, res, deps, productId);
    return;
  }
  if (action === 'preview' && method === 'GET') {
    await preview(req, res, deps, productId);
    return;
  }
  sendJson(res, 405, 'server_error');
}

async function sendCatalog(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  microsoftConfig: MicrosoftConfigState,
): Promise<void> {
  const active = await resolveSession(req, deps);
  const connections = active ? await deps.store.listMicrosoftConnections(active.session.id) : [];
  const visible = microsoftConfig.status === 'ready'
    ? visibleMicrosoftProducts(microsoftConfig.settings.confirmedProducts)
    : [];
  const visibleIds = new Set(visible.map((product) => product.id));
  const products = visible.map((product) => publicProduct(product, connections, true));
  const retained = connections
    .filter((connection) => !visibleIds.has(connection.product as MicrosoftProductDefinition['id']))
    .flatMap((connection) => {
      const product = microsoftProductById(connection.product);
      if (!product) return [];
      return [publicProduct(product, connections, false)];
    });
  sendJson(res, 200, { products: [...products, ...retained] });
}

async function startConnect(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  microsoftConfig: MicrosoftConfigState,
  productId: string,
): Promise<void> {
  if (!persistenceReady(deps)) {
    sendJson(res, 503, 'persistence_unavailable');
    return;
  }
  if (microsoftConfig.status !== 'ready') {
    sendJson(res, 503, 'configuration', microsoftConfig.message);
    return;
  }
  const product = microsoftProductById(productId);
  const visible = visibleMicrosoftProducts(microsoftConfig.settings.confirmedProducts);
  if (!product || !visible.some((item) => item.id === product.id)) {
    sendJson(res, 409, 'unavailable');
    return;
  }
  if (limited(req, deps, `microsoft-connect:${product.id}`, 20, 10 * 60_000)) {
    sendJson(res, 429, 'rate_limited');
    return;
  }
  const now = clock(deps);
  const existing = await resolveSession(req, deps);
  let session = existing?.session ?? null;
  let cookie = existing?.cookie ?? null;
  if (!session) {
    session = newSession(now);
    await deps.store.createSession(session);
    cookie = cookieFor(session, deps, now);
  }
  const state = createOauthState();
  await deps.store.saveOauthState(state, session.id, now + OAUTH_STATE_TTL_MS, `microsoft:${product.id}`);
  const location = oauthFor(deps, microsoftConfig.settings).authorizationUrl({
    state,
    scopes: requestedScopes(product),
  });
  redirect(res, location, cookie);
}

async function callback(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  microsoftConfig: MicrosoftConfigState,
): Promise<void> {
  const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const errorParam = bounded(params.get('error'), 64);
  const state = bounded(params.get('state'), 128);
  const active = await resolveSession(req, deps);
  if (errorParam) {
    await consumeIfValid(deps, state, active?.session.id ?? null);
    redirect(res, errorLocation(errorParam === 'access_denied' ? 'access_denied' : 'provider_error'));
    return;
  }
  if (!active || !state || !STATE_PATTERN.test(state)) {
    redirect(res, errorLocation('invalid_state'));
    return;
  }
  const code = bounded(params.get('code'), 2048);
  if (!code || !CODE_PATTERN.test(code)) {
    await consumeIfValid(deps, state, active.session.id);
    redirect(res, errorLocation('missing_code'));
    return;
  }
  if (microsoftConfig.status !== 'ready') {
    await consumeIfValid(deps, state, active.session.id);
    redirect(res, errorLocation('provider_error'));
    return;
  }
  const productKey = await deps.store.consumeOauthState(state, active.session.id, clock(deps));
  const productId = productKey?.startsWith('microsoft:') ? productKey.slice('microsoft:'.length) : '';
  const product = microsoftProductById(productId);
  const visible = visibleMicrosoftProducts(microsoftConfig.settings.confirmedProducts);
  if (!product || !visible.some((item) => item.id === product.id)) {
    redirect(res, errorLocation('invalid_state'));
    return;
  }

  try {
    const oauth = oauthFor(deps, microsoftConfig.settings);
    const tokens = await oauth.exchange(code);
    if (!tokens.refreshToken) {
      redirect(res, errorLocation('missing_refresh_token'));
      return;
    }
    const identity = await oauth.identity(tokens.accessToken);
    if (!identity || !OID_PATTERN.test(identity.oid) || !validEmail(identity.email)) {
      redirect(res, errorLocation('invalid_account'));
      return;
    }
    if (!scopesGranted(tokens.scope, product.scopes.map((item) => item.scope))) {
      redirect(res, errorLocation('missing_scope'));
      return;
    }
    const now = clock(deps);
    const next = newSession(now);
    next.userId = active.session.userId;
    const rotated = await deps.store.rotateSession(active.session.id, now, next);
    if (!rotated) {
      redirect(res, errorLocation('provider_error'));
      return;
    }
    await storeGrant(deps, rotated, identity, tokens, product, now);
    redirect(
      res,
      `/?${new URLSearchParams({ microsoft: 'connected', product: product.id }).toString()}`,
      cookieFor(rotated, deps, now),
    );
  } catch (error) {
    logger(deps, error instanceof Error && error.message === 'token_exchange_failed' ? 'token_exchange_failed' : 'provider_error');
    redirect(res, errorLocation('token_exchange_failed'));
  }
}

async function preview(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  productId: string,
): Promise<void> {
  const product = microsoftProductById(productId);
  if (!product || product.availability !== 'confirmable') {
    sendJson(res, 404, 'server_error');
    return;
  }
  const active = await resolveSession(req, deps);
  if (!active) {
    sendJson(res, 200, { connected: false, sections: [] });
    return;
  }
  const connection = (await deps.store.listMicrosoftConnections(active.session.id))
    .find((item) => item.product === product.id);
  if (!connection) {
    sendJson(res, 409, 'not_connected');
    return;
  }
  if (!scopesGranted(connection.grantedScopes, product.scopes.map((item) => item.scope))) {
    sendJson(res, 403, 'missing_scope');
    return;
  }
  try {
    const accessToken = await freshAccessToken(deps, connection, product);
    const sections = await previewMicrosoftProduct(product, accessToken, deps.fetchImpl ?? fetch);
    sendJson(res, 200, { connected: true, sections });
  } catch (error) {
    const code = error instanceof MicrosoftApiError ? error.code : 'provider_error';
    if (code === 'reconnect_required') {
      await deps.store.deleteMicrosoftGrant(connection.sessionId, connection.grantId);
    }
    sendJson(res, code === 'rate_limited' ? 429 : code === 'missing_scope' ? 403 : 502, code);
  }
}

async function disconnect(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  productId: string,
): Promise<void> {
  if (req.headers['x-em-request'] !== '1') {
    sendJson(res, 403, 'forbidden');
    return;
  }
  const active = await resolveSession(req, deps);
  if (!active) {
    sendJson(res, 200, { disconnected: false, grantRevoked: false, sharedGrant: false });
    return;
  }
  const connections = await deps.store.listMicrosoftConnections(active.session.id);
  const connection = connections.find((item) => item.product === productId);
  if (!connection) {
    sendJson(res, 200, { disconnected: false, grantRevoked: false, sharedGrant: false });
    return;
  }
  const sharedGrant = connections.some((item) => item.grantId === connection.grantId && item.product !== productId);
  await deps.store.deleteMicrosoftConnection(active.session.id, productId);
  if (!sharedGrant) await deps.store.deleteMicrosoftGrant(active.session.id, connection.grantId);
  sendJson(res, 200, { disconnected: true, grantRevoked: false, sharedGrant });
}

async function storeGrant(
  deps: ServerDeps,
  session: SessionRecord,
  identity: { oid: string; email: string },
  tokens: MicrosoftTokenSet,
  product: MicrosoftProductDefinition,
  now: number,
): Promise<void> {
  const previous = (await deps.store.listMicrosoftConnections(session.id))
    .find((item) => item.product === product.id);
  const existing = await deps.store.getMicrosoftGrant(session.id, identity.oid);
  const grantId = existing?.id ?? randomUUID();
  const grant: MicrosoftGrantRecord = {
    id: grantId,
    sessionId: session.id,
    userId: session.userId,
    microsoftOid: identity.oid,
    email: identity.email,
    accessToken: encryptString(tokens.accessToken, deps.config.tokenEncryptionKey, grantId),
    refreshToken: encryptString(tokens.refreshToken ?? '', deps.config.tokenEncryptionKey, grantId),
    accessTokenExpiresAt: now + tokens.expiresIn * 1000,
    grantedScopes: tokens.scope,
    refreshedAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (existing) await deps.store.updateMicrosoftGrant(grant);
  else await deps.store.insertMicrosoftGrant(grant);
  await deps.store.upsertMicrosoftConnection({
    id: randomUUID(),
    grantId,
    sessionId: session.id,
    product: product.id,
    scopes: product.scopes.map((item) => item.scope).join(' '),
    createdAt: now,
    updatedAt: now,
  });
  if (!previous || previous.grantId === grantId) return;
  const stillUsed = (await deps.store.listMicrosoftConnections(session.id))
    .some((item) => item.grantId === previous.grantId);
  if (stillUsed) return;
  await deps.store.deleteMicrosoftGrant(session.id, previous.grantId);
}

async function freshAccessToken(
  deps: ServerDeps,
  connection: MicrosoftConnectionRecord,
  product: MicrosoftProductDefinition,
): Promise<string> {
  const current = decrypt(connection.accessToken, deps, connection.grantId);
  if (current && connection.accessTokenExpiresAt > clock(deps) + ACCESS_REFRESH_SKEW_MS) return current;
  const refreshToken = decrypt(connection.refreshToken, deps, connection.grantId);
  if (!refreshToken) throw new MicrosoftApiError('reconnect_required');
  const settings = readySettings(deps);
  if (!settings) throw new MicrosoftApiError('reconnect_required');
  try {
    const next = await oauthFor(deps, settings).refresh(refreshToken, requestedScopes(product));
    const now = clock(deps);
    await deps.store.updateMicrosoftGrant({
      id: connection.grantId,
      sessionId: connection.sessionId,
      userId: connection.userId,
      microsoftOid: connection.microsoftOid,
      email: connection.email,
      accessToken: encryptString(next.accessToken, deps.config.tokenEncryptionKey, connection.grantId),
      refreshToken: encryptString(next.refreshToken ?? refreshToken, deps.config.tokenEncryptionKey, connection.grantId),
      accessTokenExpiresAt: now + next.expiresIn * 1000,
      grantedScopes: next.scope || connection.grantedScopes,
      refreshedAt: now,
      createdAt: connection.createdAt,
      updatedAt: now,
    });
    return next.accessToken;
  } catch {
    throw new MicrosoftApiError('reconnect_required');
  }
}

function configOf(deps: ServerDeps): MicrosoftConfigState {
  return deps.microsoftConfig ?? {
    status: 'absent',
    message: 'MICROSOFT_CLIENT_ID is missing. Set the Microsoft Entra app in the server environment.',
  };
}

function readySettings(deps: ServerDeps): MicrosoftSettings | null {
  const microsoftConfig = configOf(deps);
  return microsoftConfig.status === 'ready' ? microsoftConfig.settings : null;
}

function oauthFor(deps: ServerDeps, settings: MicrosoftSettings): MicrosoftOAuth {
  return deps.microsoftOAuth ?? createMicrosoftOAuth(settings, deps.fetchImpl ?? fetch);
}

function publicProduct(
  product: MicrosoftProductDefinition,
  connections: MicrosoftConnectionRecord[],
  connectable: boolean,
) {
  const connection = connections.find((item) => item.product === product.id);
  return {
    id: product.id,
    cardId: `em-microsoft-${product.id}`,
    name: product.name,
    description: product.description,
    category: product.category,
    initials: product.initials,
    icon: product.icon,
    docsUrl: product.docsUrl,
    connected: Boolean(connection),
    connectable,
    email: connection?.email ?? null,
    scopes: product.scopes.map((item) => item.scope),
    adminConsent: product.adminConsent,
  };
}

export function scopesGranted(granted: string, required: readonly string[]): boolean {
  const have = new Set<string>();
  for (const part of granted.split(/\s+/)) {
    if (!part) continue;
    have.add(part);
    const name = part.split('/').pop();
    if (name) have.add(name);
  }
  return required.every((scope) => have.has(scope) || have.has(scope.split('/').pop() ?? scope));
}

function validEmail(email: string): boolean {
  return email.length <= 320 && EMAIL_PATTERN.test(email);
}

async function consumeIfValid(deps: ServerDeps, state: string | null, sessionId: string | null): Promise<void> {
  if (!state || !sessionId || !STATE_PATTERN.test(state)) return;
  await deps.store.consumeOauthState(state, sessionId, clock(deps));
}

async function resolveSession(
  req: IncomingMessage,
  deps: ServerDeps,
): Promise<{ session: SessionRecord; cookie: string | null } | null> {
  const now = clock(deps);
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  const payload = verifySessionToken(token, deps.config.sessionSecret, now);
  if (!payload) return null;
  const session = await deps.store.getSession(payload.sid);
  if (!session || session.expiresAt <= now || session.id !== payload.sid) return null;
  return { session, cookie: null };
}

function newSession(now: number): SessionRecord {
  return {
    id: createSessionId(),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    userId: null,
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

function persistenceReady(deps: ServerDeps): boolean {
  if (process.env.VERCEL === '1' && !deps.config.databaseUrl) return false;
  return true;
}

function decrypt(
  secret: MicrosoftGrantRecord['accessToken'],
  deps: ServerDeps,
  aad: string,
): string | null {
  try {
    const value = decryptString(secret, deps.config.tokenEncryptionKey, aad);
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function clock(deps: ServerDeps): number {
  return deps.now ? deps.now() : Date.now();
}

function logger(deps: ServerDeps, event: string): void {
  deps.logger?.(event);
}

const buckets = new Map<string, number[]>();

function limited(req: IncomingMessage, deps: ServerDeps, name: string, max: number, windowMs: number): boolean {
  const now = clock(deps);
  const key = `${name}:${req.socket?.remoteAddress ?? 'local'}`;
  const recent = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  recent.push(now);
  buckets.set(key, recent);
  return recent.length > max;
}

function bounded(value: string | null, max: number): string | null {
  if (!value || value.length > max) return null;
  return value;
}

function errorLocation(reason: string): string {
  return `/?${new URLSearchParams({ microsoft: 'error', reason }).toString()}`;
}

function redirect(res: ServerResponse, location: string, cookie?: string | null): void {
  res.statusCode = 302;
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function sendJson(res: ServerResponse, status: number, code: MicrosoftCode | 'server_error', message?: string): void;
function sendJson(res: ServerResponse, status: number, body: unknown): void;
function sendJson(res: ServerResponse, status: number, codeOrBody: MicrosoftCode | unknown, message?: string): void {
  const body = typeof codeOrBody === 'string'
    ? { error: codeOrBody, message: message ?? MESSAGES[codeOrBody as MicrosoftCode] }
    : codeOrBody;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
