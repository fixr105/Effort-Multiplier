import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createZohoServer, type ServerDeps } from './app.ts';
import { encryptString, decryptString } from './crypto.ts';
import { LOCAL_GOOGLE_REDIRECT_URI, loadGoogleConfig } from './google-config.ts';
import { handleMicrosoftRequest } from './microsoft-app.ts';
import { LOCAL_MICROSOFT_REDIRECT_URI, PRODUCTION_MICROSOFT_REDIRECT_URI, loadMicrosoftConfig } from './microsoft-config.ts';
import { previewMicrosoftProduct } from './microsoft-api.ts';
import { MICROSOFT_PRODUCTS, microsoftProductById } from './microsoft-products.ts';
import { createMicrosoftOAuth, type MicrosoftOAuth } from './microsoft-oauth.ts';
import { LOCAL_REDIRECT_URI } from './config.ts';
import type { AppConfig } from './config.ts';
import { createSessionId, verifySessionToken } from './session.ts';
import { openTokenStore, type TokenStore } from './store.ts';

const ACCESS_TOKEN = 'microsoft-access-sentinel';
const REFRESH_TOKEN = 'microsoft-refresh-sentinel';
const CLIENT_SECRET = 'microsoft-client-secret-sentinel';
const OID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const BLOCKED = ['teams-meetings', 'bookings', 'forms', 'power-bi', 'dynamics', 'arm', 'devops', 'power-platform'];

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

function readyMicrosoft(confirmed: string) {
  return loadMicrosoftConfig({
    MICROSOFT_CLIENT_ID: 'microsoft-client',
    MICROSOFT_CLIENT_SECRET: CLIENT_SECRET,
    MICROSOFT_REDIRECT_URI: LOCAL_MICROSOFT_REDIRECT_URI,
    MICROSOFT_TENANT: 'common',
    MICROSOFT_CONFIRMED_PRODUCTS: confirmed,
  }, false);
}

function fakeOAuth(state: { scope?: string; refreshToken?: string | null; identity?: boolean }): MicrosoftOAuth {
  return {
    authorizationUrl(input) {
      const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      url.searchParams.set('client_id', 'microsoft-client');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', LOCAL_MICROSOFT_REDIRECT_URI);
      url.searchParams.set('scope', input.scopes.join(' '));
      url.searchParams.set('state', input.state);
      url.searchParams.set('prompt', 'consent');
      return url.toString();
    },
    async exchange() {
      return {
        accessToken: ACCESS_TOKEN,
        refreshToken: state.refreshToken === undefined ? REFRESH_TOKEN : state.refreshToken,
        expiresIn: 3600,
        scope: state.scope ?? 'Mail.ReadBasic User.Read',
      };
    },
    async refresh() {
      return {
        accessToken: 'refreshed-access-sentinel',
        refreshToken: REFRESH_TOKEN,
        expiresIn: 3600,
        scope: state.scope ?? 'Mail.ReadBasic User.Read',
      };
    },
    async identity() {
      if (state.identity === false) return null;
      return { oid: OID, email: 'person@example.com' };
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
  run: (context: { base: string; store: TokenStore }) => Promise<void>,
  extra?: Partial<ServerDeps>,
): Promise<void> {
  const store = openTokenStore(':memory:');
  const server = createZohoServer({
    config: testConfig(),
    store,
    ...extra,
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  try {
    await run({ base: `http://127.0.0.1:${address.port}`, store });
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

describe('Microsoft catalog', () => {
  it('hides every product until confirmed ids are configured', async () => {
    await withServer(async ({ base }) => {
      const hidden = await call(base, '/api/integrations/microsoft');
      assert.deepEqual(JSON.parse(hidden.body).products, []);
      assert.equal((await call(base, '/api/integrations/microsoft/outlook-mail/connect')).status, 503);
    });
  });

  it('lists only confirmed Graph products and leaves blocked products hidden', async () => {
    const ready = MICROSOFT_PRODUCTS.filter((product) => product.availability === 'confirmable');
    assert.deepEqual(ready.map((product) => product.id), [
      'outlook-mail', 'outlook-calendar', 'contacts', 'teams', 'onedrive', 'sharepoint',
      'word', 'excel', 'powerpoint', 'onenote', 'todo', 'planner',
    ]);
    await withServer(async ({ base }) => {
      const catalog = JSON.parse((await call(base, '/api/integrations/microsoft')).body) as {
        products: { id: string; cardId: string; connectable: boolean; connected: boolean }[];
      };
      assert.deepEqual(catalog.products.map((product) => product.id), ready.map((product) => product.id));
      assert.ok(catalog.products.every((product) => product.cardId === `em-microsoft-${product.id}` && product.connectable && !product.connected));
      assert.equal(JSON.stringify(catalog).includes(CLIENT_SECRET), false);
      for (const product of ready) {
        const started = await call(base, `/api/integrations/microsoft/${product.id}/connect`);
        assert.equal(started.status, 302);
        const location = new URL(started.headers.location ?? '');
        assert.equal(location.origin + location.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
        assert.equal(location.searchParams.get('prompt'), 'consent');
        assert.equal(location.searchParams.get('redirect_uri'), LOCAL_MICROSOFT_REDIRECT_URI);
        assert.equal(location.searchParams.has('client_secret'), false);
        const scope = location.searchParams.get('scope') ?? '';
        for (const item of product.scopes) assert.ok(scope.includes(item.scope), product.id);
        assert.ok(scope.includes('offline_access'));
      }
      for (const id of BLOCKED) {
        assert.equal((await call(base, `/api/integrations/microsoft/${id}/connect`)).status, 409);
      }
      const zoho = await call(base, '/api/integrations');
      const zohoIds = (JSON.parse(zoho.body).products as { id: string }[]).map((product) => product.id);
      assert.deepEqual(zohoIds, ['crm', 'books', 'inventory', 'people', 'desk', 'calendar', 'projects', 'sign']);
      const google = await call(base, '/api/integrations/google');
      assert.deepEqual(JSON.parse(google.body).products.map((product: { id: string }) => product.id), ['gmail']);
    }, {
      microsoftConfig: readyMicrosoft([...ready.map((product) => product.id), ...BLOCKED].join(',')),
      microsoftOAuth: fakeOAuth({}),
      googleConfig: loadGoogleConfig({
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        GOOGLE_REDIRECT_URI: LOCAL_GOOGLE_REDIRECT_URI,
        GOOGLE_CONFIRMED_PRODUCTS: 'gmail',
      }, false),
    });
  });

  it('accepts only the production callback when production is set', () => {
    const ready = loadMicrosoftConfig({
      MICROSOFT_CLIENT_ID: 'microsoft-client',
      MICROSOFT_CLIENT_SECRET: CLIENT_SECRET,
      MICROSOFT_REDIRECT_URI: PRODUCTION_MICROSOFT_REDIRECT_URI,
      MICROSOFT_TENANT: 'common',
    }, true);
    assert.equal(ready.status, 'ready');
    const wrong = loadMicrosoftConfig({
      MICROSOFT_CLIENT_ID: 'microsoft-client',
      MICROSOFT_CLIENT_SECRET: CLIENT_SECRET,
      MICROSOFT_REDIRECT_URI: LOCAL_MICROSOFT_REDIRECT_URI,
      MICROSOFT_TENANT: 'common',
    }, true);
    assert.equal(wrong.status, 'invalid');
  });
});

describe('Microsoft OAuth and persistence', () => {
  it('refuses to attach a grant that belongs to another session', async () => {
    const store = openTokenStore(':memory:');
    const now = Date.now();
    const owner = { id: createSessionId(), createdAt: now, expiresAt: now + 60_000, userId: null };
    const other = { id: createSessionId(), createdAt: now, expiresAt: now + 60_000, userId: null };
    await store.createSession(owner);
    await store.createSession(other);
    const grantId = '11111111-1111-4111-8111-111111111111';
    await store.insertMicrosoftGrant({
      id: grantId,
      sessionId: owner.id,
      userId: null,
      microsoftOid: OID,
      email: 'person@example.com',
      accessToken: encryptString(ACCESS_TOKEN, Buffer.alloc(32, 2), grantId),
      refreshToken: encryptString(REFRESH_TOKEN, Buffer.alloc(32, 2), grantId),
      accessTokenExpiresAt: now + 3_600_000,
      grantedScopes: 'Mail.ReadBasic',
      refreshedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await assert.rejects(
      () => store.upsertMicrosoftConnection({
        id: '22222222-2222-4222-8222-222222222222',
        grantId,
        sessionId: other.id,
        product: 'outlook-mail',
        scopes: 'https://graph.microsoft.com/Mail.ReadBasic',
        createdAt: now,
        updatedAt: now,
      }),
      /microsoft_grant_session_mismatch/,
    );
    assert.equal((await store.listMicrosoftConnections(other.id)).length, 0);
    store.close();
  });

  it('starts authorization when the request socket is missing', async () => {
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
    await handleMicrosoftRequest(
      { method: 'GET', url: '/api/integrations/microsoft/outlook-mail/connect', headers: {}, socket: null } as never,
      res as never,
      { config: testConfig(), store, microsoftConfig: readyMicrosoft('outlook-mail'), microsoftOAuth: fakeOAuth({}) },
    );
    assert.equal(res.statusCode, 302);
    assert.match(headers.location ?? '', /login\.microsoftonline\.com/);
    assert.equal(new URL(headers.location ?? '').searchParams.has('client_secret'), false);
    store.close();
  });

  it('stores an encrypted grant and rejects a reused state', async () => {
    await withServer(async ({ base, store }) => {
      const started = await call(base, '/api/integrations/microsoft/outlook-mail/connect');
      const cookie = cookiePair(started.headers);
      const state = new URL(started.headers.location ?? '').searchParams.get('state') ?? '';
      assert.equal(state.length, 43);
      const missing = await call(base, '/api/integrations/microsoft/callback', { cookie });
      assert.match(missing.headers.location ?? '', /reason=invalid_state/);
      const connected = await call(base, `/api/integrations/microsoft/callback?code=auth-code&state=${state}`, { cookie });
      assert.match(connected.headers.location ?? '', /microsoft=connected&product=outlook-mail/);
      const saved = cookiePair(connected.headers);
      const catalog = JSON.parse((await call(base, '/api/integrations/microsoft', { cookie: saved })).body) as {
        products: { id: string; connected: boolean }[];
      };
      assert.equal(catalog.products.find((product) => product.id === 'outlook-mail')?.connected, true);
      const grant = await store.getMicrosoftGrant(sessionIdFromCookie(saved), OID);
      assert.ok(grant);
      assert.notEqual(grant?.accessToken.ciphertext, ACCESS_TOKEN);
      assert.equal(decryptString(grant!.accessToken, Buffer.alloc(32, 2), grant!.id), ACCESS_TOKEN);
      const reused = await call(base, `/api/integrations/microsoft/callback?code=auth-code&state=${state}`, { cookie: saved });
      assert.match(reused.headers.location ?? '', /reason=invalid_state/);
    }, {
      microsoftConfig: readyMicrosoft('outlook-mail,outlook-calendar'),
      microsoftOAuth: fakeOAuth({ scope: 'Mail.ReadBasic User.Read' }),
    });
  });

  it('does not store a connection when consent, identity, refresh, or scopes are incomplete', async () => {
    const cases: Array<{ oauth: MicrosoftOAuth; reason: string }> = [
      { oauth: fakeOAuth({ refreshToken: null }), reason: 'missing_refresh_token' },
      { oauth: fakeOAuth({ identity: false }), reason: 'invalid_account' },
      { oauth: fakeOAuth({ scope: 'User.Read' }), reason: 'missing_scope' },
    ];
    for (const item of cases) {
      await withServer(async ({ base, store }) => {
        const started = await call(base, '/api/integrations/microsoft/outlook-mail/connect');
        const cookie = cookiePair(started.headers);
        const state = new URL(started.headers.location ?? '').searchParams.get('state') ?? '';
        const result = await call(base, `/api/integrations/microsoft/callback?code=auth-code&state=${state}`, { cookie });
        assert.match(result.headers.location ?? '', new RegExp(item.reason));
        assert.equal((await store.listMicrosoftConnections(sessionIdFromCookie(cookie))).length, 0);
      }, { microsoftConfig: readyMicrosoft('outlook-mail'), microsoftOAuth: item.oauth });
    }
  });

  it('previews mail only after the product scope is present', async () => {
    let fetches = 0;
    await withServer(async ({ base, store }) => {
      const started = await call(base, '/api/integrations/microsoft/outlook-mail/connect');
      const cookie = cookiePair(started.headers);
      const state = new URL(started.headers.location ?? '').searchParams.get('state') ?? '';
      const connected = await call(base, `/api/integrations/microsoft/callback?code=auth-code&state=${state}`, { cookie });
      const saved = cookiePair(connected.headers);
      const sessionId = sessionIdFromCookie(saved);
      const grant = await store.getMicrosoftGrant(sessionId, OID);
      assert.ok(grant);
      grant!.grantedScopes = 'User.Read';
      await store.updateMicrosoftGrant(grant!);
      const blocked = await call(base, '/api/integrations/microsoft/outlook-mail/preview', { cookie: saved });
      assert.equal(blocked.status, 403);
      assert.equal(fetches, 0);
      grant!.grantedScopes = 'Mail.ReadBasic';
      await store.updateMicrosoftGrant(grant!);
      const preview = await call(base, '/api/integrations/microsoft/outlook-mail/preview', { cookie: saved });
      assert.equal(preview.status, 200);
      assert.match(preview.body, /Hello/);
      assert.equal(JSON.parse(preview.body).sections[0].records[0].detail.includes('a@example.com'), true);
    }, {
      microsoftConfig: readyMicrosoft('outlook-mail'),
      microsoftOAuth: fakeOAuth({ scope: 'Mail.ReadBasic' }),
      fetchImpl: async (input) => {
        fetches += 1;
        const url = String(input);
        assert.match(url, /graph\.microsoft\.com\/v1\.0\/me\/messages/);
        return new Response(JSON.stringify({
          value: [{
            id: 'm1',
            subject: 'Hello',
            from: { emailAddress: { address: 'a@example.com' } },
            receivedDateTime: '2026-01-01T00:00:00Z',
          }],
        }), { status: 200 });
      },
    });
  });

  it('keeps a shared grant when one product is disconnected', async () => {
    const scope = 'Mail.ReadBasic Calendars.Read User.Read';
    await withServer(async ({ base, store }) => {
      const connect = async (cookie: string, product: string) => {
        const started = await call(base, `/api/integrations/microsoft/${product}/connect`, { cookie });
        const nextCookie = cookiePair(started.headers) || cookie;
        const state = new URL(started.headers.location ?? '').searchParams.get('state') ?? '';
        const done = await call(base, `/api/integrations/microsoft/callback?code=auth-code&state=${state}`, { cookie: nextCookie });
        return cookiePair(done.headers);
      };
      let cookie = cookiePair((await call(base, '/api/integrations/microsoft/outlook-mail/connect')).headers);
      cookie = await connect(cookie, 'outlook-mail');
      cookie = await connect(cookie, 'outlook-calendar');
      const sessionId = sessionIdFromCookie(cookie);
      const first = await call(base, '/api/integrations/microsoft/outlook-mail/disconnect', { method: 'POST', cookie });
      const firstBody = JSON.parse(first.body) as { grantRevoked: boolean; sharedGrant: boolean };
      assert.equal(firstBody.grantRevoked, false);
      assert.equal(firstBody.sharedGrant, true);
      assert.ok(await store.getMicrosoftGrant(sessionId, OID));
      const catalog = JSON.parse((await call(base, '/api/integrations/microsoft', { cookie })).body) as {
        products: { id: string; connected: boolean }[];
      };
      assert.equal(catalog.products.find((product) => product.id === 'outlook-mail')?.connected, false);
      assert.equal(catalog.products.find((product) => product.id === 'outlook-calendar')?.connected, true);
      const csrf = await call(base, '/api/integrations/microsoft/outlook-calendar/disconnect', { method: 'POST', cookie, csrf: false });
      assert.equal(csrf.status, 403);
      const second = await call(base, '/api/integrations/microsoft/outlook-calendar/disconnect', { method: 'POST', cookie });
      const secondBody = JSON.parse(second.body) as { grantRevoked: boolean; sharedGrant: boolean };
      assert.equal(secondBody.grantRevoked, false);
      assert.equal(secondBody.sharedGrant, false);
      assert.equal(await store.getMicrosoftGrant(sessionId, OID), null);
    }, {
      microsoftConfig: readyMicrosoft('outlook-mail,outlook-calendar'),
      microsoftOAuth: fakeOAuth({ scope }),
    });
  });
});

describe('Microsoft Graph previews', () => {
  it('calls the product endpoint without encoding the search function', async () => {
    const word = microsoftProductById('word');
    const excel = microsoftProductById('excel');
    assert.ok(word && excel);
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("search(q='docx')")) {
        return new Response(JSON.stringify({ value: [{ id: 'doc1', name: 'Notes.docx' }] }), { status: 200 });
      }
      if (url.includes("search(q='xlsx')")) {
        return new Response(JSON.stringify({ value: [{ id: 'book1', name: 'Book.xlsx' }] }), { status: 200 });
      }
      if (url.includes('/workbook/worksheets?')) {
        return new Response(JSON.stringify({ value: [{ name: 'Sheet1' }] }), { status: 200 });
      }
      if (url.includes("/range(address='A1:E5')")) {
        return new Response(JSON.stringify({ values: [['A', 1]] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), { status: 403 });
    };
    const documents = await previewMicrosoftProduct(word, 'token', fetchImpl);
    assert.equal(documents[0]?.records[0]?.title, 'Notes.docx');
    assert.ok(urls.some((url) => url.includes("search(q='docx')")));
    const workbook = await previewMicrosoftProduct(excel, 'token', fetchImpl);
    assert.match(workbook[0]?.records[0]?.detail ?? '', /A \| 1/);
    const denied = fetchImpl;
    await assert.rejects(
      () => previewMicrosoftProduct(microsoftProductById('teams')!, 'token', denied),
      (error: { code?: string }) => error.code === 'missing_scope',
    );
  });

  it('builds the authorize URL without the client secret', () => {
    const settings = readyMicrosoft('outlook-mail');
    assert.equal(settings.status, 'ready');
    if (settings.status !== 'ready') return;
    const url = new URL(createMicrosoftOAuth(settings.settings).authorizationUrl({
      state: 'a'.repeat(43),
      scopes: ['https://graph.microsoft.com/Mail.ReadBasic', 'offline_access'],
    }));
    assert.equal(url.searchParams.has('client_secret'), false);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('redirect_uri'), LOCAL_MICROSOFT_REDIRECT_URI);
  });
});
