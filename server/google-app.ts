import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ServerDeps } from './app.ts';
import { decryptString, encryptString } from './crypto.ts';
import type { GoogleConfigState, GoogleSettings } from './google-config.ts';
import { GoogleApiError, previewGoogleProduct } from './google-api.ts';
import {
  googleProductById,
  requestedScopes,
  visibleGoogleProducts,
  type GoogleProductDefinition,
} from './google-products.ts';
import { createGoogleOAuth, type GoogleOAuth, type GoogleTokenSet } from './google-oauth.ts';
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
import type { GoogleConnectionRecord, GoogleGrantRecord, SessionRecord } from './store.ts';

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_PATTERN = /^[A-Za-z0-9._~/-]{1,1024}$/;
const SUB_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
const ACCESS_REFRESH_SKEW_MS = 60_000;

const MESSAGES = {
  configuration: 'Google sign-in is not configured.',
  unavailable: 'This Google product is not available to connect.',
  not_connected: 'This Google product is not connected.',
  rate_limited: 'Google rate limit reached. Try again shortly.',
  missing_scope: 'Google did not grant the requested access. Reconnect and allow that permission.',
  reconnect_required: 'The Google connection expired. Reconnect this product.',
  provider_unavailable: 'Google could not be reached. No data was changed.',
  provider_error: 'Google could not complete the request.',
  server_error: 'The request could not be completed.',
  persistence_unavailable: 'Production token storage is not configured. Set DATABASE_URL before connecting Google.',
  forbidden: 'The request was rejected.',
} as const;

type GoogleCode = keyof typeof MESSAGES;

export async function handleGoogleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  const method = req.method ?? 'GET';
  const googleConfig = configOf(deps);

  if (path === '/api/integrations/google/callback' && method === 'GET') {
    await callback(req, res, deps, googleConfig);
    return;
  }
  if (path === '/api/integrations/google' && method === 'GET') {
    await sendCatalog(req, res, deps, googleConfig);
    return;
  }

  const route = path.match(/^\/api\/integrations\/google\/([a-z0-9-]+)\/(connect|disconnect|preview)$/);
  if (!route) {
    sendJson(res, 404, 'server_error');
    return;
  }
  const productId = route[1] ?? '';
  const action = route[2];
  if (action === 'connect' && method === 'GET') {
    await startConnect(req, res, deps, googleConfig, productId);
    return;
  }
  if (action === 'disconnect' && method === 'POST') {
    await disconnect(req, res, deps, googleConfig, productId);
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
  googleConfig: GoogleConfigState,
): Promise<void> {
  const active = await resolveSession(req, deps);
  const connections = active ? await deps.store.listGoogleConnections(active.session.id) : [];
  const visible = googleConfig.status === 'ready'
    ? visibleGoogleProducts(googleConfig.settings.confirmedProducts)
    : [];
  const visibleIds = new Set(visible.map((product) => product.id));
  const products = visible.map((product) => publicProduct(product, connections, true));
  const retained = connections
    .filter((connection) => !visibleIds.has(connection.product as GoogleProductDefinition['id']))
    .flatMap((connection) => {
      const product = googleProductById(connection.product);
      if (!product) return [];
      return [publicProduct(product, connections, false)];
    });
  sendJson(res, 200, { products: [...products, ...retained] });
}

async function startConnect(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  googleConfig: GoogleConfigState,
  productId: string,
): Promise<void> {
  if (!persistenceReady(deps)) {
    sendJson(res, 503, 'persistence_unavailable');
    return;
  }
  if (googleConfig.status !== 'ready') {
    sendJson(res, 503, 'configuration', googleConfig.message);
    return;
  }
  const product = googleProductById(productId);
  const visible = visibleGoogleProducts(googleConfig.settings.confirmedProducts);
  if (!product || !visible.some((item) => item.id === product.id)) {
    sendJson(res, 409, 'unavailable');
    return;
  }
  if (limited(req, deps, `google-connect:${product.id}`, 20, 10 * 60_000)) {
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
  await deps.store.saveOauthState(state, session.id, now + OAUTH_STATE_TTL_MS, `google:${product.id}`);
  const location = oauthFor(deps, googleConfig.settings).authorizationUrl({
    state,
    scopes: requestedScopes(product),
  });
  redirect(res, location, cookie);
}

async function callback(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  googleConfig: GoogleConfigState,
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
  const code = bounded(params.get('code'), 1024);
  if (!code || !CODE_PATTERN.test(code)) {
    await consumeIfValid(deps, state, active.session.id);
    redirect(res, errorLocation('missing_code'));
    return;
  }
  if (googleConfig.status !== 'ready') {
    await consumeIfValid(deps, state, active.session.id);
    redirect(res, errorLocation('provider_error'));
    return;
  }
  const productKey = await deps.store.consumeOauthState(state, active.session.id, clock(deps));
  const productId = productKey?.startsWith('google:') ? productKey.slice('google:'.length) : '';
  const product = googleProductById(productId);
  const visible = visibleGoogleProducts(googleConfig.settings.confirmedProducts);
  if (!product || !visible.some((item) => item.id === product.id)) {
    redirect(res, errorLocation('invalid_state'));
    return;
  }

  try {
    const oauth = oauthFor(deps, googleConfig.settings);
    const tokens = await oauth.exchange(code);
    if (!tokens.refreshToken || !tokens.idToken) {
      redirect(res, errorLocation('missing_refresh_token'));
      return;
    }
    const identity = await oauth.identity(tokens.idToken);
    if (!identity || !identity.emailVerified || !SUB_PATTERN.test(identity.sub) || !validEmail(identity.email)) {
      redirect(res, errorLocation('invalid_account'));
      return;
    }
    if (!scopesGranted(tokens.scope, requestedScopes(product))) {
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
      `/?${new URLSearchParams({ google: 'connected', product: product.id }).toString()}`,
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
  const product = googleProductById(productId);
  if (!product) {
    sendJson(res, 404, 'server_error');
    return;
  }
  const active = await resolveSession(req, deps);
  if (!active) {
    sendJson(res, 200, { connected: false, sections: [] });
    return;
  }
  const connection = (await deps.store.listGoogleConnections(active.session.id))
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
    const accessToken = await freshAccessToken(deps, connection);
    const sections = await previewGoogleProduct(product, accessToken, deps.fetchImpl ?? fetch, clock(deps));
    sendJson(res, 200, { connected: true, sections });
  } catch (error) {
    const code = error instanceof GoogleApiError ? error.code : 'provider_error';
    if (code === 'reconnect_required') {
      await deps.store.deleteGoogleGrant(connection.sessionId, connection.grantId);
    }
    sendJson(res, code === 'rate_limited' ? 429 : code === 'missing_scope' ? 403 : 502, code);
  }
}

async function disconnect(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  googleConfig: GoogleConfigState,
  productId: string,
): Promise<void> {
  if (req.headers['x-em-request'] !== '1') {
    sendJson(res, 403, 'forbidden');
    return;
  }
  const active = await resolveSession(req, deps);
  if (!active) {
    sendJson(res, 200, { disconnected: false, grantRevoked: false });
    return;
  }
  const connections = await deps.store.listGoogleConnections(active.session.id);
  const connection = connections.find((item) => item.product === productId);
  if (!connection) {
    sendJson(res, 200, { disconnected: false, grantRevoked: false });
    return;
  }
  const remaining = connections.filter((item) => item.grantId === connection.grantId && item.product !== productId);
  await deps.store.deleteGoogleConnection(active.session.id, productId);
  let grantRevoked = false;
  if (remaining.length === 0) {
    const refreshToken = decrypt(connection.refreshToken, deps, connection.grantId);
    if (refreshToken && googleConfig.status === 'ready') {
      try {
        await oauthFor(deps, googleConfig.settings).revoke(refreshToken);
        grantRevoked = true;
      } catch {
        logger(deps, 'revoke_failed');
      }
    }
    await deps.store.deleteGoogleGrant(active.session.id, connection.grantId);
  }
  sendJson(res, 200, { disconnected: true, grantRevoked });
}

async function storeGrant(
  deps: ServerDeps,
  session: SessionRecord,
  identity: { sub: string; email: string },
  tokens: GoogleTokenSet,
  product: GoogleProductDefinition,
  now: number,
): Promise<void> {
  const previous = (await deps.store.listGoogleConnections(session.id))
    .find((item) => item.product === product.id);
  const existing = await deps.store.getGoogleGrant(session.id, identity.sub);
  const grantId = existing?.id ?? randomUUID();
  const grant: GoogleGrantRecord = {
    id: grantId,
    sessionId: session.id,
    userId: session.userId,
    googleSub: identity.sub,
    email: identity.email,
    accessToken: encryptString(tokens.accessToken, deps.config.tokenEncryptionKey, grantId),
    refreshToken: encryptString(tokens.refreshToken ?? '', deps.config.tokenEncryptionKey, grantId),
    accessTokenExpiresAt: now + tokens.expiresIn * 1000,
    grantedScopes: tokens.scope,
    refreshedAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (existing) await deps.store.updateGoogleGrant(grant);
  else await deps.store.insertGoogleGrant(grant);
  await deps.store.upsertGoogleConnection({
    id: randomUUID(),
    grantId,
    sessionId: session.id,
    product: product.id,
    scopes: product.scopes.map((item) => item.scope).join(' '),
    createdAt: now,
    updatedAt: now,
  });
  if (!previous || previous.grantId === grantId) return;
  const stillUsed = (await deps.store.listGoogleConnections(session.id))
    .some((item) => item.grantId === previous.grantId);
  if (stillUsed) return;
  const refreshToken = decrypt(previous.refreshToken, deps, previous.grantId);
  const settings = readySettings(deps);
  if (refreshToken && settings) {
    try {
      await oauthFor(deps, settings).revoke(refreshToken);
    } catch {
      logger(deps, 'revoke_failed');
    }
  }
  await deps.store.deleteGoogleGrant(session.id, previous.grantId);
}

async function freshAccessToken(deps: ServerDeps, connection: GoogleConnectionRecord): Promise<string> {
  const current = decrypt(connection.accessToken, deps, connection.grantId);
  if (current && connection.accessTokenExpiresAt > clock(deps) + ACCESS_REFRESH_SKEW_MS) return current;
  const refreshToken = decrypt(connection.refreshToken, deps, connection.grantId);
  if (!refreshToken) throw new GoogleApiError('reconnect_required');
  const settings = readySettings(deps);
  if (!settings) throw new GoogleApiError('reconnect_required');
  try {
    const next = await oauthFor(deps, settings).refresh(refreshToken);
    const now = clock(deps);
    await deps.store.updateGoogleGrant({
      id: connection.grantId,
      sessionId: connection.sessionId,
      userId: connection.userId,
      googleSub: connection.googleSub,
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
    throw new GoogleApiError('reconnect_required');
  }
}

function configOf(deps: ServerDeps): GoogleConfigState {
  return deps.googleConfig ?? {
    status: 'absent',
    message: 'GOOGLE_CLIENT_ID is missing. Set the Google OAuth client in the server environment.',
  };
}

function readySettings(deps: ServerDeps): GoogleSettings | null {
  const googleConfig = configOf(deps);
  return googleConfig.status === 'ready' ? googleConfig.settings : null;
}

function oauthFor(deps: ServerDeps, settings: GoogleSettings): GoogleOAuth {
  return deps.googleOAuth ?? createGoogleOAuth(settings);
}

function publicProduct(
  product: GoogleProductDefinition,
  connections: GoogleConnectionRecord[],
  connectable: boolean,
) {
  const connection = connections.find((item) => item.product === product.id);
  return {
    id: product.id,
    cardId: `em-google-${product.id}`,
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
  };
}

function scopesGranted(granted: string, required: readonly string[]): boolean {
  const have = new Set(granted.split(/\s+/).filter(Boolean));
  return required.every((scope) => have.has(scope));
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
  secret: GoogleGrantRecord['accessToken'],
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
  return `/?${new URLSearchParams({ google: 'error', reason }).toString()}`;
}

function redirect(res: ServerResponse, location: string, cookie?: string | null): void {
  res.statusCode = 302;
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function sendJson(res: ServerResponse, status: number, code: GoogleCode | 'server_error', message?: string): void;
function sendJson(res: ServerResponse, status: number, body: unknown): void;
function sendJson(res: ServerResponse, status: number, codeOrBody: GoogleCode | unknown, message?: string): void {
  const body = typeof codeOrBody === 'string'
    ? { error: codeOrBody, message: message ?? MESSAGES[codeOrBody as GoogleCode] }
    : codeOrBody;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
