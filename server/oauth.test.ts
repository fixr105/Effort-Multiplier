import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { LOCAL_REDIRECT_URI, PRODUCTION_REDIRECT_URI, loadConfig } from './config.ts';
import { decryptString, encryptString } from './crypto.ts';
import { assertAccountsOrigin, assertApiOrigin, DomainError } from './domains.ts';
import { createZohoServer } from './app.ts';
import { signSession, verifySessionToken } from './session.ts';
import { openTokenStore } from './store.ts';
import type { AppConfig } from './config.ts';

const CLIENT_SECRET = 'client-secret-sentinel';
const ACCESS_TOKEN = 'access-token-sentinel';
const REFRESH_TOKEN = 'refresh-token-sentinel';

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function hexKey(byte: number): string {
  return Buffer.alloc(32, byte).toString('hex');
}

function testConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    clientId: 'test-client-id',
    clientSecret: CLIENT_SECRET,
    redirectUri: LOCAL_REDIRECT_URI,
    sessionSecret: Buffer.alloc(32, 1),
    tokenEncryptionKey: Buffer.alloc(32, 2),
    production: false,
    databasePath: ':memory:',
    databaseUrl: null,
    port: 3001,
    ...overrides,
  };
}

function env(overrides?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return {
    ZOHO_CLIENT_ID: 'test-client-id',
    ZOHO_CLIENT_SECRET: CLIENT_SECRET,
    ZOHO_REDIRECT_URI: LOCAL_REDIRECT_URI,
    SESSION_SECRET: hexKey(3),
    TOKEN_ENCRYPTION_KEY: hexKey(4),
    ...overrides,
  };
}

interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function call(
  base: string,
  path: string,
  options?: { method?: string; cookie?: string; csrf?: boolean },
): Promise<HttpResult> {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: options?.method ?? 'GET',
        headers: {
          ...(options?.csrf === false ? {} : { 'x-em-request': '1' }),
          ...(options?.cookie ? { cookie: options.cookie } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function cookiePair(headers: IncomingHttpHeaders): string {
  const raw = headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(value, 'expected a session cookie');
  return value.split(';')[0] ?? '';
}

function assertNoSecrets(value: string): void {
  assert.equal(value.includes(CLIENT_SECRET), false);
  assert.equal(value.includes(ACCESS_TOKEN), false);
  assert.equal(value.includes(REFRESH_TOKEN), false);
}

function jsonResponse(status: number, body: unknown): globalThis.Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('configuration', () => {
  it('rejects missing Zoho credentials without echoing values', () => {
    assert.throws(
      () => loadConfig(env({ ZOHO_CLIENT_SECRET: ' ' })),
      /ZOHO_CLIENT_SECRET is missing/,
    );
  });

  it('rejects a short encryption key', () => {
    assert.throws(
      () => loadConfig(env({ TOKEN_ENCRYPTION_KEY: 'abcd' })),
      /TOKEN_ENCRYPTION_KEY must be a 64-character hex string/,
    );
  });

  it('rejects identical session and encryption keys', () => {
    const key = hexKey(9);
    assert.throws(
      () =>
        loadConfig(
          env({ SESSION_SECRET: key, TOKEN_ENCRYPTION_KEY: key }),
        ),
      /must be different/,
    );
  });

  it('refuses to rewrite a local callback URL', () => {
    assert.throws(
      () =>
        loadConfig(
          env({ ZOHO_REDIRECT_URI: 'http://127.0.0.1:5173/api/integrations/zoho/callback' }),
        ),
      new RegExp(LOCAL_REDIRECT_URI.replaceAll('.', '\\.')),
    );
    try {
      loadConfig(
        env({ ZOHO_REDIRECT_URI: 'http://127.0.0.1:5173/api/integrations/zoho/callback' }),
      );
    } catch (error) {
      assert.match(String(error), /will not substitute/);
    }
  });

  it('requires https when running in production', () => {
    assert.throws(
      () =>
        loadConfig(
          env({
            NODE_ENV: 'production',
            ZOHO_REDIRECT_URI: LOCAL_REDIRECT_URI,
          }),
        ),
      /https/,
    );
    const config = loadConfig(
      env({
        NODE_ENV: 'production',
        ZOHO_REDIRECT_URI: PRODUCTION_REDIRECT_URI,
      }),
    );
    assert.equal(config.production, true);
    assert.equal(config.redirectUri, PRODUCTION_REDIRECT_URI);
  });
});

describe('Zoho domains and token encryption', () => {
  it('allowlists regional Zoho hosts and rejects lookalikes', () => {
    assert.equal(assertAccountsOrigin('https://accounts.zoho.in'), 'https://accounts.zoho.in');
    assert.equal(assertApiOrigin('https://www.zohoapis.eu/'), 'https://www.zohoapis.eu');
    assert.throws(() => assertAccountsOrigin('https://accounts.zoho.com.evil.example'), DomainError);
    assert.throws(() => assertAccountsOrigin('https://evil.example'), DomainError);
    assert.throws(() => assertApiOrigin('https://www.zohoapis.in.evil.example'), DomainError);
    assert.throws(() => assertAccountsOrigin('https://accounts.zoho.in/oauth/v2/token'), DomainError);
  });

  it('detects tampered ciphertext', () => {
    const key = Buffer.alloc(32, 7);
    const secret = encryptString('refresh-token-sentinel', key, 'connection-id');
    assert.equal(decryptString(secret, key, 'connection-id'), 'refresh-token-sentinel');
    assert.throws(() =>
      decryptString(
        { ...secret, ciphertext: `${secret.ciphertext.slice(0, -2)}aa` },
        key,
        'connection-id',
      ),
    );
    assert.throws(() => decryptString(secret, key, 'other-connection'));
  });

  it('rejects a tampered session cookie', () => {
    const secret = Buffer.alloc(32, 5);
    const token = signSession(
      { sid: '11111111-1111-4111-8111-111111111111', iat: 10, exp: 100 },
      secret,
    );
    assert.ok(verifySessionToken(token, secret, 20));
    const [body, signature] = token.split('.');
    const flipped = `${body}.${signature?.slice(0, -1)}${signature?.endsWith('a') ? 'b' : 'a'}`;
    assert.equal(verifySessionToken(flipped, secret, 20), null);
    assert.equal(verifySessionToken(token, Buffer.alloc(32, 6), 20), null);
  });

  it('stores the database so only the owner can read it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoho-db-'));
    tempDirs.push(dir);
    const filename = join(dir, 'nested', 'zoho.sqlite');
    const store = openTokenStore(filename);
    store.close();
    assert.equal(statSync(filename).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'nested')).mode & 0o777, 0o700);
  });
});

describe('Zoho OAuth routes', () => {
  it('starts authorization with the exact local callback and no client secret', async () => {
    await withServer(async ({ base }) => {
      const response = await call(base, '/api/integrations/zoho/connect');
      assert.equal(response.status, 302);
      const location = new URL(response.headers.location ?? '');
      assert.equal(location.origin + location.pathname, 'https://accounts.zoho.com/oauth/v2/auth');
      assert.equal(location.searchParams.get('scope'), 'ZohoCRM.modules.leads.READ');
      assert.equal(location.searchParams.get('response_type'), 'code');
      assert.equal(location.searchParams.get('access_type'), 'offline');
      assert.equal(location.searchParams.get('redirect_uri'), LOCAL_REDIRECT_URI);
      assert.equal(location.searchParams.get('client_id'), 'test-client-id');
      assert.equal(location.searchParams.has('client_secret'), false);
      assert.match(location.searchParams.get('state') ?? '', /^[A-Za-z0-9_-]{43}$/);
      const cookie = headersCookie(response.headers);
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Lax/);
      assert.doesNotMatch(cookie, /Secure/);
      assertNoSecrets(`${response.headers.location} ${cookie}`);
    });
  });

  it('sets a Secure cookie in production', async () => {
    await withServer(
      async ({ base }) => {
        const response = await call(base, '/api/integrations/zoho/connect');
        assert.match(headersCookie(response.headers), /;\s*Secure/);
      },
      { config: testConfig({ production: true }) },
    );
  });

  it('rejects a callback whose state belongs to another session', async () => {
    const calls: string[] = [];
    await withServer(
      async ({ base }) => {
        const first = await call(base, '/api/integrations/zoho/connect');
        const second = await call(base, '/api/integrations/zoho/connect');
        const state = new URL(first.headers.location ?? '').searchParams.get('state');
        const response = await call(
          base,
          callbackPath(state ?? '', 'https://accounts.zoho.in'),
          { cookie: cookiePair(second.headers) },
        );
        assert.equal(response.status, 302);
        assert.match(response.headers.location ?? '', /reason=invalid_state/);
        assert.equal(calls.length, 0);
        assertNoSecrets(response.headers.location ?? '');
      },
      { fetchImpl: trackingFetch(calls) },
    );
  });

  it('rejects a reused or expired state and an authorization denial', async () => {
    const calls: string[] = [];
    const clock = { current: 1_700_000_000_000 };
    await withServer(
      async ({ base, logs }) => {
        const started = await call(base, '/api/integrations/zoho/connect');
        const cookie = cookiePair(started.headers);
        const state = new URL(started.headers.location ?? '').searchParams.get('state') ?? '';

        const denied = await call(
          base,
          `/api/integrations/zoho/callback?${new URLSearchParams({
            error: 'access_denied',
            state,
          }).toString()}`,
          { cookie },
        );
        assert.match(denied.headers.location ?? '', /reason=access_denied/);
        assert.equal(calls.length, 0);

        const restarted = await call(base, '/api/integrations/zoho/connect', { cookie });
        const nextState = new URL(restarted.headers.location ?? '').searchParams.get('state') ?? '';
        const failed = await call(base, callbackPath(nextState, 'https://accounts.zoho.in'), { cookie });
        assert.match(failed.headers.location ?? '', /reason=token_exchange_failed/);
        const replay = await call(base, callbackPath(nextState, 'https://accounts.zoho.in'), { cookie });
        assert.match(replay.headers.location ?? '', /reason=invalid_state/);
        assert.equal(calls.length, 1);

        clock.current += 11 * 60 * 1000;
        const later = await call(base, '/api/integrations/zoho/connect', { cookie });
        const expiredState = new URL(later.headers.location ?? '').searchParams.get('state') ?? '';
        clock.current += 11 * 60 * 1000;
        const expired = await call(base, callbackPath(expiredState, 'https://accounts.zoho.in'), {
          cookie,
        });
        assert.match(expired.headers.location ?? '', /reason=invalid_state/);
        assert.equal(calls.length, 1);
        assertNoSecrets(logs.join('\n'));
      },
      {
        now: () => clock.current,
        fetchImpl: async (input) => {
          calls.push(String(input));
          return jsonResponse(400, { error: 'invalid_code' });
        },
      },
    );
  });

  it('stores an India connection and reads leads from that API domain', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const clock = { current: 1_700_000_000_000 };
    await withServer(
      async ({ base, logs }) => {
        const started = await call(base, '/api/integrations/zoho/connect');
        const cookie = cookiePair(started.headers);
        const state = new URL(started.headers.location ?? '').searchParams.get('state') ?? '';
        const callback = await call(base, callbackPath(state, 'https://accounts.zoho.in'), { cookie });
        assert.match(callback.headers.location ?? '', /zoho=connected/);
        assertNoSecrets(callback.headers.location ?? '');
        const session = cookiePair(callback.headers);

        const status = await call(base, '/api/integrations/zoho/status', { cookie: session });
        assert.equal(status.status, 200);
        assert.deepEqual(JSON.parse(status.body), {
          connected: true,
          product: 'crm',
          apiDomain: 'https://www.zohoapis.in',
          scope: 'ZohoCRM.modules.leads.READ',
          organizationId: null,
          identity: 'local-browser-session',
        });
        assertNoSecrets(status.body);

        const leads = await call(base, '/api/integrations/zoho/leads', { cookie: session });
        assert.equal(leads.status, 200);
        assert.deepEqual(JSON.parse(leads.body), {
          apiDomain: 'https://www.zohoapis.in',
          leads: [
            {
              id: '1001',
              firstName: 'Asha',
              lastName: 'Menon',
              email: 'asha@example.com',
              company: 'Northwind',
              status: 'Contacted',
            },
          ],
        });
        assertNoSecrets(leads.body);
        assert.equal(calls[0]?.url, 'https://accounts.zoho.in/oauth/v2/token');
        const tokenBody = new URLSearchParams(String(calls[0]?.init?.body));
        assert.equal(tokenBody.get('grant_type'), 'authorization_code');
        assert.equal(tokenBody.get('redirect_uri'), LOCAL_REDIRECT_URI);
        assert.equal(tokenBody.get('client_secret'), CLIENT_SECRET);
        assert.equal(calls[1]?.url.startsWith('https://www.zohoapis.in/crm/v8/Leads?'), true);
        assert.match(calls[1]?.url ?? '', /per_page=5/);
        assert.match(calls[1]?.url ?? '', /fields=First_Name%2CLast_Name%2CEmail%2CCompany%2CLead_Status|fields=First_Name,Last_Name,Email,Company,Lead_Status/);
        assert.equal(header(calls[1]?.init, 'authorization'), `Zoho-oauthtoken ${ACCESS_TOKEN}`);
        assertNoSecrets(logs.join('\n'));

        clock.current += 60 * 60 * 1000;
        const refreshed = await call(base, '/api/integrations/zoho/leads', { cookie: session });
        assert.equal(refreshed.status, 200);
        assert.equal(JSON.parse(refreshed.body).apiDomain, 'https://www.zohoapis.eu');
        assert.equal(calls[2]?.url, 'https://accounts.zoho.in/oauth/v2/token');
        assert.match(String(calls[2]?.init?.body), /grant_type=refresh_token/);
        assert.equal(calls[3]?.url.startsWith('https://www.zohoapis.eu/crm/v8/Leads?'), true);

        const empty = await call(base, '/api/integrations/zoho/leads', { cookie: session });
        assert.deepEqual(JSON.parse(empty.body).leads, []);

        const disconnected = await call(base, '/api/integrations/zoho/disconnect', {
          method: 'POST',
          cookie: session,
        });
        assert.deepEqual(JSON.parse(disconnected.body), { disconnected: true, revoked: true });
        assertNoSecrets(disconnected.body);
        assert.equal(calls.at(-1)?.url, 'https://accounts.zoho.in/oauth/v2/token/revoke');
        const afterwards = await call(base, '/api/integrations/zoho/status', { cookie: session });
        assert.equal(JSON.parse(afterwards.body).connected, false);
      },
      {
        now: () => clock.current,
        fetchImpl: async (input, init) => {
          const url = String(input);
          calls.push({ url, init });
          if (url.endsWith('/oauth/v2/token') && String(init?.body).includes('authorization_code')) {
            return jsonResponse(200, {
              access_token: ACCESS_TOKEN,
              refresh_token: REFRESH_TOKEN,
              api_domain: 'https://www.zohoapis.in',
              expires_in: 3600,
              token_type: 'Bearer',
            });
          }
          if (url.endsWith('/oauth/v2/token') && String(init?.body).includes('refresh_token')) {
            return jsonResponse(200, {
              access_token: 'second-access-token',
              api_domain: 'https://www.zohoapis.eu',
              expires_in: 3600,
              token_type: 'Bearer',
            });
          }
          if (url.includes('/crm/v8/Leads') && calls.filter((item) => item.url.includes('/crm/v8/Leads')).length === 1) {
            return jsonResponse(200, {
              data: [
                {
                  id: '1001',
                  First_Name: 'Asha',
                  Last_Name: 'Menon',
                  Email: 'asha@example.com',
                  Company: 'Northwind',
                  Lead_Status: 'Contacted',
                  Phone: 'should-not-leak',
                },
              ],
            });
          }
          if (url.includes('/crm/v8/Leads')) {
            return new Response(null, { status: 204 });
          }
          if (url.endsWith('/oauth/v2/token/revoke')) {
            assert.match(String(init?.body), new RegExp(`token=${REFRESH_TOKEN}`));
            return jsonResponse(200, { status: 'success' });
          }
          throw new Error(`unexpected fetch ${url}`);
        },
      },
    );
  });

  it('does not call Zoho when the accounts server is not official', async () => {
    const calls: string[] = [];
    await withServer(
      async ({ base }) => {
        const started = await call(base, '/api/integrations/zoho/connect');
        const cookie = cookiePair(started.headers);
        const state = new URL(started.headers.location ?? '').searchParams.get('state') ?? '';
        const response = await call(
          base,
          callbackPath(state, 'https://accounts.zoho.com.evil.example'),
          { cookie },
        );
        assert.match(response.headers.location ?? '', /reason=invalid_accounts_server/);
        assert.equal(calls.length, 0);
        const status = await call(base, '/api/integrations/zoho/status', { cookie });
        assert.equal(JSON.parse(status.body).connected, false);
      },
      { fetchImpl: trackingFetch(calls) },
    );
  });

  it('rotates the session and keeps the connection on the new cookie', async () => {
    const clock = { current: 1_700_000_000_000 };
    await withServer(
      async ({ base }) => {
        const cookie = await connectAccount(base);
        clock.current += 8 * 24 * 60 * 60 * 1000;
        const status = await call(base, '/api/integrations/zoho/status', { cookie });
        assert.equal(JSON.parse(status.body).connected, true);
        const rotated = cookiePair(status.headers);
        assert.notEqual(rotated, cookie);
        const oldSession = await call(base, '/api/integrations/zoho/status', { cookie });
        assert.equal(JSON.parse(oldSession.body).connected, false);
        const newSession = await call(base, '/api/integrations/zoho/status', { cookie: rotated });
        assert.equal(JSON.parse(newSession.body).connected, true);
      },
      {
        now: () => clock.current,
        fetchImpl: successfulTokenFetch,
      },
    );
  });

  it('asks for a reconnect when Zoho rejects the refresh token', async () => {
    const clock = { current: 1_700_000_000_000 };
    await withServer(
      async ({ base }) => {
        const cookie = await connectAccount(base);
        clock.current += 2 * 60 * 60 * 1000;
        const leads = await call(base, '/api/integrations/zoho/leads', { cookie });
        assert.equal(leads.status, 401);
        assert.equal(JSON.parse(leads.body).error, 'reconnect_required');
        assertNoSecrets(leads.body);
        const status = await call(base, '/api/integrations/zoho/status', { cookie });
        assert.equal(JSON.parse(status.body).connected, false);
      },
      {
        now: () => clock.current,
        fetchImpl: async (input, init) => {
          const url = String(input);
          if (String(init?.body).includes('authorization_code')) {
            return jsonResponse(200, {
              access_token: ACCESS_TOKEN,
              refresh_token: REFRESH_TOKEN,
              api_domain: 'https://www.zohoapis.com',
              expires_in: 3600,
              token_type: 'Bearer',
            });
          }
          if (url.endsWith('/oauth/v2/token')) {
            return jsonResponse(400, { error: 'invalid_grant' });
          }
          throw new Error(`unexpected fetch ${url}`);
        },
      },
    );
  });

  it('keeps Zoho products independent and refuses a planned product', async () => {
    await withServer(async ({ base }) => {
      const planned = await call(base, '/api/integrations/zoho/bigin/connect');
      assert.equal(planned.status, 409);
      const started = await call(base, '/api/integrations/zoho/books/connect');
      const location = new URL(started.headers.location ?? '');
      assert.equal(
        location.searchParams.get('scope'),
        'ZohoBooks.contacts.READ,ZohoBooks.invoices.READ,ZohoBooks.settings.READ',
      );
      const state = location.searchParams.get('state') ?? '';
      const callback = await call(base, callbackPath(state, 'https://accounts.zoho.in'), {
        cookie: cookiePair(started.headers),
      });
      const session = cookiePair(callback.headers);
      const books = await call(base, '/api/integrations/books/status', { cookie: session });
      const crm = await call(base, '/api/integrations/crm/status', { cookie: session });
      assert.equal(JSON.parse(books.body).connected, true);
      assert.equal(JSON.parse(crm.body).connected, false);
      const blocked = await call(base, '/api/integrations/zoho/books/disconnect', {
        method: 'POST',
        cookie: session,
        csrf: false,
      });
      assert.equal(blocked.status, 403);
    }, { fetchImpl: successfulTokenFetch });
  });
});

function callbackPath(state: string, accountsServer: string): string {
  return `/api/integrations/zoho/callback?${new URLSearchParams({
    code: 'grant-code',
    state,
    'accounts-server': accountsServer,
    location: 'in',
  }).toString()}`;
}

function headersCookie(headers: IncomingHttpHeaders): string {
  const raw = headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(value);
  return value;
}

function header(init: RequestInit | undefined, name: string): string | null {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) return null;
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name);
  if (!key) return null;
  const value = headers[key];
  return typeof value === 'string' ? value : null;
}

function trackingFetch(calls: string[]): typeof fetch {
  return (async (input) => {
    calls.push(String(input));
    return jsonResponse(500, { error: 'unexpected' });
  }) as typeof fetch;
}

const successfulTokenFetch: typeof fetch = async (input, init) => {
  if (String(init?.body).includes('authorization_code')) {
    return jsonResponse(200, {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      api_domain: 'https://www.zohoapis.in',
      expires_in: 3600,
      token_type: 'Bearer',
    });
  }
  throw new Error(`unexpected fetch ${String(input)}`);
};

async function connectAccount(base: string): Promise<string> {
  const started = await call(base, '/api/integrations/zoho/connect');
  const cookie = cookiePair(started.headers);
  const state = new URL(started.headers.location ?? '').searchParams.get('state') ?? '';
  const callback = await call(base, callbackPath(state, 'https://accounts.zoho.in'), { cookie });
  return cookiePair(callback.headers);
}

async function withServer(
  run: (context: { base: string; logs: string[] }) => Promise<void>,
  options?: {
    config?: AppConfig;
    fetchImpl?: typeof fetch;
    now?: () => number;
  },
): Promise<void> {
  const logs: string[] = [];
  const store = openTokenStore(':memory:');
  const server = createZohoServer({
    config: options?.config ?? testConfig(),
    store,
    fetchImpl: options?.fetchImpl,
    now: options?.now,
    logger: (event, fields) => {
      logs.push(`${event} ${fields ? JSON.stringify(fields) : ''}`);
    },
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  try {
    await run({ base: `http://127.0.0.1:${address.port}`, logs });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    store.close();
  }
}
