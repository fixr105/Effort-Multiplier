import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createZohoServer, type ServerDeps } from './app.ts';
import { handleGoogleRequest } from './google-app.ts';
import { encryptString } from './crypto.ts';
import { createSessionId } from './session.ts';
import { verifySessionToken } from './session.ts';
import { decryptString } from './crypto.ts';
import { LOCAL_GOOGLE_REDIRECT_URI, PRODUCTION_GOOGLE_REDIRECT_URI, loadGoogleConfig } from './google-config.ts';
import { createGoogleOAuth, type GoogleOAuth } from './google-oauth.ts';
import { LOCAL_REDIRECT_URI } from './config.ts';
import type { AppConfig } from './config.ts';
import { openTokenStore, type TokenStore } from './store.ts';

const ACCESS_TOKEN = 'google-access-sentinel';
const REFRESH_TOKEN = 'google-refresh-sentinel';
const CLIENT_SECRET = 'google-client-secret-sentinel';

function testConfig(): AppConfig {
  return {
    clientId: 'zoho-client',
    clientSecret: 'zoho-secret',
    redirectUri: LOCAL_REDIRECT_URI,
    sessionSecret: Buffer.alloc(32, 1),
    tokenEncryptionKey: Buffer.alloc(32, 2),
    production: false,
    databasePath: ':memory:',
    databaseUrl: null,
    port: 3001,
  };
}

function readyGoogle(confirmed: string) {
  return loadGoogleConfig({
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: LOCAL_GOOGLE_REDIRECT_URI,
    GOOGLE_CONFIRMED_PRODUCTS: confirmed,
  }, false);
}

function fakeOAuth(state: { revoked: string[]; failRefresh?: boolean; scope?: string; refreshToken?: string | null; verified?: boolean }): GoogleOAuth {
  return {
    authorizationUrl(input) {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('scope', input.scopes.join(' '));
      url.searchParams.set('state', input.state);
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('include_granted_scopes', 'true');
      url.searchParams.set('redirect_uri', LOCAL_GOOGLE_REDIRECT_URI);
      return url.toString();
    },
    async exchange() {
      return {
        accessToken: ACCESS_TOKEN,
        refreshToken: state.refreshToken === undefined ? REFRESH_TOKEN : state.refreshToken,
        expiresIn: 3600,
        scope: state.scope ?? 'https://www.googleapis.com/auth/gmail.metadata openid https://www.googleapis.com/auth/userinfo.email',
        idToken: 'header.payload.signature',
      };
    },
    async refresh() {
      if (state.failRefresh) throw new Error('invalid_grant');
      return {
        accessToken: 'refreshed-access-sentinel',
        refreshToken: REFRESH_TOKEN,
        expiresIn: 3600,
        scope: state.scope ?? '',
        idToken: null,
      };
    },
    async revoke(token) {
      state.revoked.push(token);
    },
    async identity() {
      if (state.verified === false) return { sub: '123', email: 'person@example.com', emailVerified: false };
      return { sub: '123456789', email: 'person@example.com', emailVerified: true };
    },
  };
}

interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function call(base: string, path: string, options?: { method?: string; cookie?: string; csrf?: boolean }): Promise<HttpResult> {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, {
      method: options?.method ?? 'GET',
      headers: {
        ...(options?.csrf === false ? {} : { 'x-em-request': '1' }),
        ...(options?.cookie ? { cookie: options.cookie } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(
  run: (context: { base: string; store: TokenStore; logs: string[] }) => Promise<void>,
  google?: Partial<ServerDeps>,
): Promise<void> {
  const logs: string[] = [];
  const store = openTokenStore(':memory:');
  const server = createZohoServer({
    config: testConfig(),
    store,
    logger: (event, fields) => logs.push(`${event} ${JSON.stringify(fields ?? {})}`),
    ...google,
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  try {
    await run({ base: `http://127.0.0.1:${address.port}`, store, logs });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    store.close();
  }
}

function cookiePair(headers: IncomingHttpHeaders): string {
  const raw = headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? '').split(';')[0] ?? '';
}

function sessionIdFromCookie(cookie: string): string {
  const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  const payload = verifySessionToken(token, Buffer.alloc(32, 1), Date.now());
  assert.ok(payload);
  return payload.sid;
}

describe('Google persistence ownership', () => {
  it('refuses to attach a grant that belongs to another session', async () => {
    const store = openTokenStore(':memory:');
    const now = Date.now();
    const owner = { id: createSessionId(), createdAt: now, expiresAt: now + 60_000, userId: null };
    const other = { id: createSessionId(), createdAt: now, expiresAt: now + 60_000, userId: null };
    await store.createSession(owner);
    await store.createSession(other);
    const grantId = '11111111-1111-4111-8111-111111111111';
    await store.insertGoogleGrant({
      id: grantId,
      sessionId: owner.id,
      userId: null,
      googleSub: '123456789',
      email: 'person@example.com',
      accessToken: encryptString(ACCESS_TOKEN, Buffer.alloc(32, 2), grantId),
      refreshToken: encryptString(REFRESH_TOKEN, Buffer.alloc(32, 2), grantId),
      accessTokenExpiresAt: now + 3_600_000,
      grantedScopes: 'https://www.googleapis.com/auth/gmail.metadata',
      refreshedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await assert.rejects(
      () => store.upsertGoogleConnection({
        id: '22222222-2222-4222-8222-222222222222',
        grantId,
        sessionId: other.id,
        product: 'gmail',
        scopes: 'https://www.googleapis.com/auth/gmail.metadata',
        createdAt: now,
        updatedAt: now,
      }),
      /google_grant_session_mismatch/,
    );
    assert.equal((await store.listGoogleConnections(other.id)).length, 0);
    await store.upsertGoogleConnection({
      id: '33333333-3333-4333-8333-333333333333',
      grantId,
      sessionId: owner.id,
      product: 'gmail',
      scopes: 'https://www.googleapis.com/auth/gmail.metadata',
      createdAt: now,
      updatedAt: now,
    });
    const visible = await store.listGoogleConnections(owner.id);
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.grantId, grantId);
    assert.equal((await store.listGoogleConnections(other.id)).length, 0);
    store.close();
  });
});

describe('Google connect transport', () => {
  it('starts Gmail authorization when the request socket is missing', async () => {
    const store = openTokenStore(':memory:');
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 0,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      end() {
        return;
      },
    };
    await handleGoogleRequest(
      { method: 'GET', url: '/api/integrations/google/gmail/connect', headers: {}, socket: null } as never,
      res as never,
      {
        config: testConfig(),
        store,
        googleConfig: readyGoogle('gmail'),
        googleOAuth: fakeOAuth({ revoked: [] }),
        now: () => Date.now(),
      },
    );
    assert.equal(res.statusCode, 302);
    const location = new URL(headers.location ?? '');
    assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.match(location.searchParams.get('scope') ?? '', /gmail\.metadata/);
    assert.equal(location.searchParams.get('redirect_uri'), LOCAL_GOOGLE_REDIRECT_URI);
    assert.equal(location.searchParams.has('client_secret'), false);
    store.close();
  });
});

describe('Google availability', () => {
  it('hides every product until an administrator confirms API enablement', async () => {
    await withServer(async ({ base }) => {
      const hidden = await call(base, '/api/integrations/google');
      assert.equal(hidden.status, 200);
      assert.deepEqual(JSON.parse(hidden.body), { products: [] });
      const connect = await call(base, '/api/integrations/google/gmail/connect');
      assert.equal(connect.status, 503);
      assert.match(connect.body, /GOOGLE_CLIENT_ID/);
      assert.doesNotMatch(connect.body, /sentinel/);
    });
  });

  it('rejects a redirect URI that is not the configured callback', () => {
    const result = loadGoogleConfig({
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: 'https://example.com/callback',
    }, false);
    assert.equal(result.status, 'invalid');
    if (result.status === 'invalid') {
      assert.match(result.message, new RegExp(LOCAL_GOOGLE_REDIRECT_URI.replaceAll('.', '\\.')));
      assert.doesNotMatch(result.message, /sentinel/);
    }
  });

  it('requires the production callback exactly', () => {
    const result = loadGoogleConfig({
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: PRODUCTION_GOOGLE_REDIRECT_URI,
    }, true);
    assert.equal(result.status, 'ready');
  });

  it('shows only confirmed connectable products and keeps blocked products hidden', async () => {
    const oauth = fakeOAuth({ revoked: [] });
    await withServer(async ({ base }) => {
      const catalog = await call(base, '/api/integrations/google');
      const body = JSON.parse(catalog.body) as { products: { id: string; connectable: boolean }[] };
      assert.deepEqual(body.products.map((product) => product.id), ['gmail', 'calendar']);
      assert.equal(body.products.every((product) => product.connectable), true);
      const chat = await call(base, '/api/integrations/google/chat/connect');
      assert.equal(chat.status, 409);
      const zoho = await call(base, '/api/integrations/zoho/crm/connect');
      assert.equal(zoho.status, 302);
      assert.match(zoho.headers.location ?? '', /ZohoCRM\.modules\.leads\.READ/);
    }, { googleConfig: readyGoogle('gmail,calendar,chat,admin,workspace-events'), googleOAuth: oauth });
  });
});

describe('Google OAuth', () => {
  it('builds the official authorization URL with offline consent', () => {
    const settings = readyGoogle('gmail');
    assert.equal(settings.status, 'ready');
    if (settings.status !== 'ready') return;
    const url = new URL(createGoogleOAuth(settings.settings).authorizationUrl({
      state: 'a'.repeat(43),
      scopes: ['https://www.googleapis.com/auth/gmail.metadata', 'openid', 'https://www.googleapis.com/auth/userinfo.email'],
    }));
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
    assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
    assert.equal(url.searchParams.get('redirect_uri'), LOCAL_GOOGLE_REDIRECT_URI);
    assert.equal(url.searchParams.has('client_secret'), false);
    assert.match(url.searchParams.get('scope') ?? '', /gmail\.metadata/);
  });

  it('stores an encrypted grant only after a verified account and the requested scopes', async () => {
    const oauthState = { revoked: [] as string[] };
    await withServer(async ({ base, store, logs }) => {
      const started = await call(base, '/api/integrations/google/gmail/connect');
      assert.equal(started.status, 302);
      const location = new URL(started.headers.location ?? '');
      assert.equal(location.searchParams.get('prompt'), 'consent');
      assert.equal(location.searchParams.has('client_secret'), false);
      const cookie = cookiePair(started.headers);
      const state = location.searchParams.get('state') ?? '';
      const denied = await call(base, `/api/integrations/google/callback?error=access_denied&state=${state}`, { cookie });
      assert.equal(denied.status, 302);
      assert.match(denied.headers.location ?? '', /reason=access_denied/);

      const restarted = await call(base, '/api/integrations/google/gmail/connect', { cookie });
      const nextState = new URL(restarted.headers.location ?? '').searchParams.get('state') ?? '';
      const nextCookie = cookiePair(restarted.headers) || cookie;
      const connected = await call(
        base,
        `/api/integrations/google/callback?code=4/0Avalid-code&state=${nextState}`,
        { cookie: nextCookie },
      );
      assert.match(connected.headers.location ?? '', /google=connected&product=gmail/);
      const savedCookie = cookiePair(connected.headers);
      const catalog = await call(base, '/api/integrations/google', { cookie: savedCookie });
      const products = JSON.parse(catalog.body).products as { id: string; connected: boolean }[];
      assert.equal(products.find((product) => product.id === 'gmail')?.connected, true);
      const other = await call(base, '/api/integrations/google');
      assert.equal(JSON.parse(other.body).products.find((product: { id: string }) => product.id === 'gmail').connected, false);

      const grant = await store.getGoogleGrant(sessionIdFromCookie(savedCookie), '123456789');
      assert.ok(grant);
      assert.notEqual(grant?.accessToken.ciphertext, ACCESS_TOKEN);
      assert.equal(decryptString(grant!.accessToken, Buffer.alloc(32, 2), grant!.id), ACCESS_TOKEN);
      assert.equal(logs.some((line) => line.includes(ACCESS_TOKEN) || line.includes(REFRESH_TOKEN) || line.includes(CLIENT_SECRET)), false);

      const reused = await call(base, `/api/integrations/google/callback?code=4/0Avalid-code&state=${nextState}`, { cookie: savedCookie });
      assert.match(reused.headers.location ?? '', /reason=invalid_state/);
    }, { googleConfig: readyGoogle('gmail,calendar'), googleOAuth: fakeOAuth(oauthState) });
  });

  it('does not store a connection when consent, identity, or scopes are incomplete', async () => {
    await withServer(async ({ base, store }) => {
      const start = async () => {
        const started = await call(base, '/api/integrations/google/gmail/connect');
        return {
          cookie: cookiePair(started.headers),
          state: new URL(started.headers.location ?? '').searchParams.get('state') ?? '',
        };
      };
      const missing = await start();
      const noRefresh = await call(base, `/api/integrations/google/callback?code=4/0Avalid-code&state=${missing.state}`, { cookie: missing.cookie });
      assert.match(noRefresh.headers.location ?? '', /missing_refresh_token/);
      const catalog = await call(base, '/api/integrations/google', { cookie: missing.cookie });
      assert.equal(JSON.parse(catalog.body).products[0].connected, false);
      assert.equal((await store.listGoogleConnections(sessionIdFromCookie(missing.cookie))).length, 0);
    }, {
      googleConfig: readyGoogle('gmail'),
      googleOAuth: fakeOAuth({ revoked: [], refreshToken: null }),
    });
  });

  it('rejects an unverified account and a token missing the product scope', async () => {
    const cases = [
      fakeOAuth({ revoked: [], verified: false }),
      fakeOAuth({ revoked: [], scope: 'openid https://www.googleapis.com/auth/userinfo.email' }),
    ];
    for (const oauth of cases) {
      await withServer(async ({ base }) => {
        const started = await call(base, '/api/integrations/google/gmail/connect');
        const cookie = cookiePair(started.headers);
        const state = new URL(started.headers.location ?? '').searchParams.get('state') ?? '';
        const result = await call(base, `/api/integrations/google/callback?code=4/0Avalid-code&state=${state}`, { cookie });
        assert.match(result.headers.location ?? '', /google=error/);
        const catalog = await call(base, '/api/integrations/google', { cookie: cookiePair(result.headers) || cookie });
        const gmail = JSON.parse(catalog.body).products.find((product: { id: string; connected: boolean }) => product.id === 'gmail');
        assert.equal(gmail.connected, false);
      }, { googleConfig: readyGoogle('gmail'), googleOAuth: oauth });
    }
  });

  it('revokes the shared grant only after the last product is disconnected', async () => {
    const oauthState = {
      revoked: [] as string[],
      scope: 'https://www.googleapis.com/auth/gmail.metadata https://www.googleapis.com/auth/calendar.readonly openid https://www.googleapis.com/auth/userinfo.email',
    };
    await withServer(async ({ base }) => {
      const connect = async (cookie: string, product: string) => {
        const started = await call(base, `/api/integrations/google/${product}/connect`, { cookie });
        const nextCookie = cookiePair(started.headers) || cookie;
        const state = new URL(started.headers.location ?? '').searchParams.get('state') ?? '';
        const done = await call(base, `/api/integrations/google/callback?code=4/0Avalid-code&state=${state}`, { cookie: nextCookie });
        return cookiePair(done.headers);
      };
      let cookie = cookiePair((await call(base, '/api/integrations/google/gmail/connect')).headers);
      cookie = await connect(cookie, 'gmail');
      cookie = await connect(cookie, 'calendar');
      const first = await call(base, '/api/integrations/google/gmail/disconnect', { method: 'POST', cookie });
      assert.equal(JSON.parse(first.body).grantRevoked, false);
      assert.deepEqual(oauthState.revoked, []);
      const csrf = await call(base, '/api/integrations/google/calendar/disconnect', { method: 'POST', cookie, csrf: false });
      assert.equal(csrf.status, 403);
      const second = await call(base, '/api/integrations/google/calendar/disconnect', { method: 'POST', cookie });
      assert.equal(JSON.parse(second.body).grantRevoked, true);
      assert.deepEqual(oauthState.revoked, [REFRESH_TOKEN]);
    }, { googleConfig: readyGoogle('gmail,calendar'), googleOAuth: fakeOAuth(oauthState) });
  });

  it('refreshes an expired token and clears the grant when Google revokes it', async () => {
    const oauthState = { revoked: [] as string[], failRefresh: false };
    let now = 1_700_000_000_000;
    await withServer(async ({ base }) => {
      const started = await call(base, '/api/integrations/google/gmail/connect');
      const cookie = cookiePair(started.headers);
      const state = new URL(started.headers.location ?? '').searchParams.get('state') ?? '';
      const connected = await call(base, `/api/integrations/google/callback?code=4/0Avalid-code&state=${state}`, { cookie });
      const saved = cookiePair(connected.headers);
      now += 4_000_000;
      const preview = await call(base, '/api/integrations/google/gmail/preview', { cookie: saved });
      assert.equal(preview.status, 200);
      assert.match(preview.body, /Hello/);
      oauthState.failRefresh = true;
      now += 4_000_000;
      const revoked = await call(base, '/api/integrations/google/gmail/preview', { cookie: saved });
      assert.equal(revoked.status, 502);
      const catalog = await call(base, '/api/integrations/google', { cookie: saved });
      assert.equal(JSON.parse(catalog.body).products.find((product: { id: string }) => product.id === 'gmail').connected, false);
    }, {
      googleConfig: readyGoogle('gmail'),
      googleOAuth: fakeOAuth(oauthState),
      now: () => now,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('/messages?')) {
          return new Response(JSON.stringify({ messages: [{ id: 'm1' }] }), { status: 200 });
        }
        if (url.includes('/messages/m1')) {
          return new Response(JSON.stringify({
            payload: { headers: [{ name: 'Subject', value: 'Hello' }, { name: 'From', value: 'a@example.com' }] },
          }), { status: 200 });
        }
        if (url.includes('fail-scope')) {
          return new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', errors: [{ reason: 'insufficientPermissions' }] } }), { status: 403 });
        }
        return new Response('{}', { status: 200 });
      },
    });
  });

  it('follows one extra Drive page and surfaces rate limits and missing scopes', async () => {
    const pages = [
      { status: 200, body: { files: [{ id: 'f1', name: 'One', mimeType: 'text/plain' }], nextPageToken: 'next-page' } },
      { status: 200, body: { files: [{ id: 'f2', name: 'Two', mimeType: 'text/plain' }] } },
    ];
    let mode: 'pages' | 'limited' | 'forbidden' = 'pages';
    await withServer(async ({ base }) => {
      const started = await call(base, '/api/integrations/google/drive/connect');
      const cookie = cookiePair(started.headers);
      const state = new URL(started.headers.location ?? '').searchParams.get('state') ?? '';
      const connected = await call(base, `/api/integrations/google/callback?code=4/0Avalid-code&state=${state}`, { cookie });
      const saved = cookiePair(connected.headers);
      const preview = await call(base, '/api/integrations/google/drive/preview', { cookie: saved });
      assert.equal(preview.status, 200);
      assert.match(preview.body, /One/);
      assert.match(preview.body, /Two/);
      mode = 'limited';
      const limited = await call(base, '/api/integrations/google/drive/preview', { cookie: saved });
      assert.equal(limited.status, 429);
      mode = 'forbidden';
      const forbidden = await call(base, '/api/integrations/google/drive/preview', { cookie: saved });
      assert.equal(forbidden.status, 403);
    }, {
      googleConfig: readyGoogle('drive'),
      googleOAuth: fakeOAuth({
        revoked: [],
        scope: 'https://www.googleapis.com/auth/drive.metadata.readonly openid https://www.googleapis.com/auth/userinfo.email',
      }),
      fetchImpl: async () => {
        if (mode === 'pages') {
          const page = pages.shift();
          return new Response(JSON.stringify(page?.body ?? {}), { status: page?.status ?? 200 });
        }
        if (mode === 'limited') {
          return new Response(JSON.stringify({ error: { code: 429 } }), { status: 429 });
        }
        return new Response(JSON.stringify({ error: { errors: [{ reason: 'insufficientPermissions' }] } }), { status: 403 });
      },
    });
  });
});
