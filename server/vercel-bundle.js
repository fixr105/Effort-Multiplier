var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/postgres-store.ts
var postgres_store_exports = {};
__export(postgres_store_exports, {
  openPostgresStore: () => openPostgresStore
});
import { Pool } from "pg";
async function openPostgresStore(databaseUrl) {
  const pool = new Pool(poolOptions(databaseUrl));
  await applySchema(pool);
  return {
    async createSession(session) {
      await pool.query(
        "INSERT INTO sessions (id, created_at, expires_at, user_id) VALUES ($1, $2, $3, $4)",
        [session.id, session.createdAt, session.expiresAt, session.userId]
      );
    },
    async getSession(id) {
      const result = await pool.query("SELECT id, created_at, expires_at, user_id FROM sessions WHERE id = $1", [id]);
      return mapSession(result.rows[0]);
    },
    async rotateSession(sessionId, now, next) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(
          "SELECT expires_at FROM sessions WHERE id = $1",
          [sessionId]
        );
        const row = current.rows[0];
        if (!row || Number(row.expires_at) <= now) {
          await client.query("ROLLBACK");
          return null;
        }
        await client.query(
          "INSERT INTO sessions (id, created_at, expires_at, user_id) VALUES ($1, $2, $3, $4)",
          [next.id, next.createdAt, next.expiresAt, next.userId]
        );
        await client.query(
          "UPDATE zoho_connections SET session_id = $1, user_id = $2 WHERE session_id = $3",
          [next.id, next.userId, sessionId]
        );
        await client.query("DELETE FROM oauth_states WHERE session_id = $1", [sessionId]);
        await client.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
        await client.query("COMMIT");
        return next;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async saveOauthState(state, sessionId, expiresAt, product) {
      await pool.query("DELETE FROM oauth_states WHERE expires_at <= $1 OR used_at IS NOT NULL", [expiresAt]);
      await pool.query(
        "INSERT INTO oauth_states (state, session_id, product, expires_at, used_at) VALUES ($1, $2, $3, $4, NULL)",
        [state, sessionId, product, expiresAt]
      );
    },
    async consumeOauthState(state, sessionId, now) {
      const result = await pool.query(
        `UPDATE oauth_states SET used_at = $1
         WHERE state = $2 AND session_id = $3 AND used_at IS NULL AND expires_at > $4
         RETURNING product`,
        [now, state, sessionId, now]
      );
      const product = result.rows[0]?.product;
      return typeof product === "string" ? product : null;
    },
    async saveConnection(connection) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM zoho_connections WHERE session_id = $1 AND product = $2", [
          connection.sessionId,
          connection.product
        ]);
        await client.query(
          `INSERT INTO zoho_connections (
            id, session_id, user_id, product, accounts_origin, api_origin,
            access_iv, access_tag, access_ciphertext,
            refresh_iv, refresh_tag, refresh_ciphertext,
            access_expires_at, scope, organization_id, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            connection.id,
            connection.sessionId,
            connection.userId,
            connection.product,
            connection.accountsOrigin,
            connection.apiOrigin,
            connection.accessToken.iv,
            connection.accessToken.tag,
            connection.accessToken.ciphertext,
            connection.refreshToken.iv,
            connection.refreshToken.tag,
            connection.refreshToken.ciphertext,
            connection.accessTokenExpiresAt,
            connection.scope,
            connection.organizationId,
            connection.createdAt,
            connection.updatedAt
          ]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async getConnection(owner) {
      if (owner.userId) {
        const byUser = await pool.query(
          `${connectionSelect()} WHERE user_id = $1 AND product = $2`,
          [owner.userId, owner.product]
        );
        const found = mapConnection(byUser.rows[0]);
        if (found) return found;
      }
      const bySession = await pool.query(
        `${connectionSelect()} WHERE session_id = $1 AND product = $2`,
        [owner.sessionId, owner.product]
      );
      return mapConnection(bySession.rows[0]);
    },
    async listConnections(owner) {
      const result = owner.userId ? await pool.query(`${connectionSelect()} WHERE user_id = $1`, [owner.userId]) : await pool.query(`${connectionSelect()} WHERE session_id = $1`, [owner.sessionId]);
      return result.rows.map((row) => mapConnection(row)).filter((row) => row !== null);
    },
    async deleteConnection(owner) {
      const byUser = owner.userId ? await pool.query(`${connectionSelect()} WHERE user_id = $1 AND product = $2`, [owner.userId, owner.product]) : null;
      const bySession = await pool.query(
        `${connectionSelect()} WHERE session_id = $1 AND product = $2`,
        [owner.sessionId, owner.product]
      );
      const existing = mapConnection(byUser?.rows[0]) ?? mapConnection(bySession.rows[0]);
      if (!existing) return null;
      await pool.query("DELETE FROM zoho_connections WHERE session_id = $1 AND product = $2", [
        existing.sessionId,
        existing.product
      ]);
      return existing;
    },
    async updateConnectionSecrets(connection) {
      await pool.query(
        `UPDATE zoho_connections
         SET access_iv = $1, access_tag = $2, access_ciphertext = $3,
             refresh_iv = $4, refresh_tag = $5, refresh_ciphertext = $6,
             access_expires_at = $7, api_origin = $8, updated_at = $9
         WHERE id = $10`,
        [
          connection.accessToken.iv,
          connection.accessToken.tag,
          connection.accessToken.ciphertext,
          connection.refreshToken.iv,
          connection.refreshToken.tag,
          connection.refreshToken.ciphertext,
          connection.accessTokenExpiresAt,
          connection.apiOrigin,
          connection.updatedAt,
          connection.id
        ]
      );
    },
    async setOrganization(owner, organizationId) {
      const result = await pool.query(
        "UPDATE zoho_connections SET organization_id = $1, updated_at = $2 WHERE session_id = $3 AND product = $4",
        [organizationId, Date.now(), owner.sessionId, owner.product]
      );
      return (result.rowCount ?? 0) === 1;
    },
    async ping() {
      const result = await pool.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])
         ORDER BY table_name`,
        [REQUIRED_TABLES2]
      );
      return {
        tables: result.rows.map((row) => String(row.table_name ?? "")).filter(Boolean)
      };
    },
    async close() {
      await pool.end();
    }
  };
}
async function applySchema(pool) {
  for (const statement of SCHEMA_STATEMENTS) {
    await pool.query(statement);
  }
}
function connectionSelect() {
  return `SELECT id, session_id, user_id, product, accounts_origin, api_origin,
            access_iv, access_tag, access_ciphertext,
            refresh_iv, refresh_tag, refresh_ciphertext,
            access_expires_at, scope, organization_id, created_at, updated_at
     FROM zoho_connections`;
}
function poolOptions(databaseUrl) {
  const options = {
    connectionString: databaseUrl,
    max: 2
  };
  const local = databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1");
  if (local) options.ssl = false;
  else if (!/sslmode=/i.test(databaseUrl)) options.ssl = { rejectUnauthorized: true };
  return options;
}
function mapSession(row) {
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    userId: typeof row.user_id === "string" ? row.user_id : null
  };
}
function mapConnection(row) {
  if (!row || typeof row.id !== "string" || typeof row.product !== "string") return null;
  return {
    id: row.id,
    sessionId: String(row.session_id),
    userId: typeof row.user_id === "string" ? row.user_id : null,
    product: row.product,
    accountsOrigin: String(row.accounts_origin),
    apiOrigin: String(row.api_origin),
    accessToken: {
      iv: String(row.access_iv),
      tag: String(row.access_tag),
      ciphertext: String(row.access_ciphertext)
    },
    refreshToken: {
      iv: String(row.refresh_iv),
      tag: String(row.refresh_tag),
      ciphertext: String(row.refresh_ciphertext)
    },
    accessTokenExpiresAt: Number(row.access_expires_at),
    scope: String(row.scope),
    organizationId: typeof row.organization_id === "string" ? row.organization_id : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}
var SCHEMA_STATEMENTS, REQUIRED_TABLES2;
var init_postgres_store = __esm({
  "server/postgres-store.ts"() {
    SCHEMA_STATEMENTS = [
      `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    user_id TEXT
  )`,
      `CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    product TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    used_at BIGINT
  )`,
      `CREATE TABLE IF NOT EXISTS zoho_connections (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    user_id TEXT,
    product TEXT NOT NULL,
    accounts_origin TEXT NOT NULL,
    api_origin TEXT NOT NULL,
    access_iv TEXT NOT NULL,
    access_tag TEXT NOT NULL,
    access_ciphertext TEXT NOT NULL,
    refresh_iv TEXT NOT NULL,
    refresh_tag TEXT NOT NULL,
    refresh_ciphertext TEXT NOT NULL,
    access_expires_at BIGINT NOT NULL,
    scope TEXT NOT NULL,
    organization_id TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    UNIQUE (session_id, product)
  )`,
      `ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS product TEXT`,
      `ALTER TABLE zoho_connections ADD COLUMN IF NOT EXISTS organization_id TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS zoho_connections_user_product
    ON zoho_connections(user_id, product)
    WHERE user_id IS NOT NULL`
    ];
    REQUIRED_TABLES2 = ["oauth_states", "sessions", "zoho_connections"];
  }
});

// server/config.ts
import { timingSafeEqual } from "node:crypto";
var LOCAL_REDIRECT_URI = "http://localhost:5173/api/integrations/zoho/callback";
var PRODUCTION_REDIRECT_URI = "https://em.multiplierclub.in/api/integrations/zoho/callback";
var API_PORT = 3001;
var HEX_KEY = /^[0-9a-fA-F]{64}$/;
function loadConfig(env) {
  const clientId = required(env, "ZOHO_CLIENT_ID");
  const clientSecret = required(env, "ZOHO_CLIENT_SECRET");
  const redirectUri = required(env, "ZOHO_REDIRECT_URI");
  const sessionSecret = decodeKey(required(env, "SESSION_SECRET"), "SESSION_SECRET");
  const tokenEncryptionKey = decodeKey(
    required(env, "TOKEN_ENCRYPTION_KEY"),
    "TOKEN_ENCRYPTION_KEY"
  );
  if (sessionSecret.length === tokenEncryptionKey.length && timingSafeEqual(sessionSecret, tokenEncryptionKey)) {
    throw new Error(
      "SESSION_SECRET and TOKEN_ENCRYPTION_KEY must be different 32-byte keys."
    );
  }
  const production = env.NODE_ENV === "production";
  assertRedirectUri(redirectUri, production);
  return {
    clientId,
    clientSecret,
    redirectUri,
    sessionSecret,
    tokenEncryptionKey,
    production,
    databasePath: env.ZOHO_DB_PATH?.trim() || "data/zoho.sqlite",
    databaseUrl: env.DATABASE_URL?.trim() || null,
    port: API_PORT
  };
}
function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `${name} is missing. Set it in the server environment. Zoho CRM will not fall back to demo mode.`
    );
  }
  return value.trim();
}
function decodeKey(value, name) {
  if (!HEX_KEY.test(value)) {
    throw new Error(
      `${name} must be a 64-character hex string encoding 32 bytes. Generate one with: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
    );
  }
  return Buffer.from(value, "hex");
}
function assertRedirectUri(value, production) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "ZOHO_REDIRECT_URI must be an absolute URL that matches the redirect URI registered in the Zoho API Console. The server will not substitute a different callback URL."
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "ZOHO_REDIRECT_URI must not contain credentials, a query string, or a fragment. Register the exact callback URL in the Zoho API Console."
    );
  }
  if (production) {
    if (value !== PRODUCTION_REDIRECT_URI) {
      throw new Error(
        `Production requires ZOHO_REDIRECT_URI to be ${PRODUCTION_REDIRECT_URI}. Register that exact URI in the Zoho API Console. The server will not substitute a different callback URL.`
      );
    }
    return;
  }
  if (value !== LOCAL_REDIRECT_URI) {
    throw new Error(
      `Local development requires ZOHO_REDIRECT_URI to be ${LOCAL_REDIRECT_URI}. Register that exact URI in the Zoho API Console. The server will not substitute a different callback URL.`
    );
  }
}

// server/app.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// server/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
var IV_BYTES = 12;
var KEY_BYTES = 32;
function encryptString(plaintext, key, aad) {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  return {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url")
  };
}
function decryptString(secret, key, aad) {
  assertKey(key);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(secret.iv, "base64url")
  );
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64url")),
    decipher.final()
  ]);
  return plaintext.toString("utf8");
}
function assertKey(key) {
  if (key.length !== KEY_BYTES) {
    throw new Error("Token encryption key must be 32 bytes.");
  }
}

// server/domains.ts
var ACCOUNTS_ORIGINS = /* @__PURE__ */ new Set([
  "https://accounts.zoho.com",
  "https://accounts.zoho.eu",
  "https://accounts.zoho.in",
  "https://accounts.zoho.com.au",
  "https://accounts.zoho.jp",
  "https://accounts.zoho.com.cn",
  "https://accounts.zoho.sa",
  "https://accounts.zohocloud.ca"
]);
var API_ORIGINS = /* @__PURE__ */ new Set([
  "https://www.zohoapis.com",
  "https://www.zohoapis.eu",
  "https://www.zohoapis.in",
  "https://www.zohoapis.com.au",
  "https://www.zohoapis.jp",
  "https://www.zohoapis.com.cn",
  "https://www.zohoapis.sa",
  "https://www.zohoapis.ca",
  "https://sandbox.zohoapis.com",
  "https://sandbox.zohoapis.eu",
  "https://sandbox.zohoapis.in",
  "https://sandbox.zohoapis.com.au",
  "https://sandbox.zohoapis.jp",
  "https://sandbox.zohoapis.com.cn",
  "https://sandbox.zohoapis.sa",
  "https://sandbox.zohoapis.ca",
  "https://developer.zohoapis.com",
  "https://developer.zohoapis.eu",
  "https://developer.zohoapis.in",
  "https://developer.zohoapis.com.au",
  "https://developer.zohoapis.jp",
  "https://developer.zohoapis.com.cn",
  "https://developer.zohoapis.sa",
  "https://developer.zohoapis.ca"
]);
var DomainError = class extends Error {
  kind;
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
};
function assertAccountsOrigin(value) {
  return assertOrigin(value, ACCOUNTS_ORIGINS, "invalid_accounts_server");
}
function assertApiOrigin(value) {
  return assertOrigin(value, API_ORIGINS, "invalid_api_domain");
}
var DESK_ORIGINS = {
  "https://www.zohoapis.com": "https://desk.zoho.com",
  "https://www.zohoapis.eu": "https://desk.zoho.eu",
  "https://www.zohoapis.in": "https://desk.zoho.in",
  "https://www.zohoapis.com.au": "https://desk.zoho.com.au",
  "https://www.zohoapis.jp": "https://desk.zoho.jp",
  "https://www.zohoapis.sa": "https://desk.zoho.sa",
  "https://www.zohoapis.ca": "https://desk.zohocloud.ca"
};
var PEOPLE_ORIGINS = {
  "https://www.zohoapis.com": "https://people.zoho.com",
  "https://www.zohoapis.eu": "https://people.zoho.eu",
  "https://www.zohoapis.in": "https://people.zoho.in",
  "https://www.zohoapis.com.au": "https://people.zoho.com.au",
  "https://www.zohoapis.jp": "https://people.zoho.jp",
  "https://www.zohoapis.sa": "https://people.zoho.sa",
  "https://www.zohoapis.ca": "https://people.zohocloud.ca"
};
function serviceOrigin(apiOrigin, service) {
  const origin = assertApiOrigin(apiOrigin);
  const mapped = service === "desk" ? DESK_ORIGINS[origin] : PEOPLE_ORIGINS[origin];
  if (!mapped) throw new DomainError("invalid_api_domain");
  return mapped;
}
function assertOrigin(value, allowlist, kind) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new DomainError(kind);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new DomainError(kind);
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new DomainError(kind);
  }
  if (!allowlist.has(url.origin)) {
    throw new DomainError(kind);
  }
  return url.origin;
}

// server/session.ts
import { createHmac, randomBytes as randomBytes2, randomUUID, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
var SESSION_COOKIE = "em_session";
var SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1e3;
var SESSION_ROTATE_AFTER_MS = 7 * 24 * 60 * 60 * 1e3;
var OAUTH_STATE_TTL_MS = 10 * 60 * 1e3;
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function createSessionId() {
  return randomUUID();
}
function createOauthState() {
  return randomBytes2(32).toString("base64url");
}
function signSession(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}
function verifySessionToken(token, secret, now) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual2(actualBuffer, expectedBuffer)) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isSessionPayload(parsed)) return null;
  if (parsed.exp <= now || parsed.iat > now) return null;
  return parsed;
}
function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}
function serializeSessionCookie(token, options) {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${options.maxAgeSeconds}`
  ];
  if (options.production) attributes.push("Secure");
  return attributes.join("; ");
}
function isSessionPayload(value) {
  if (!value || typeof value !== "object") return false;
  const payload = value;
  return typeof payload.sid === "string" && UUID_PATTERN.test(payload.sid) && typeof payload.iat === "number" && Number.isFinite(payload.iat) && typeof payload.exp === "number" && Number.isFinite(payload.exp);
}

// server/zoho.ts
var ZOHO_SCOPE = "ZohoCRM.modules.leads.READ";
var LEAD_FIELDS = [
  "First_Name",
  "Last_Name",
  "Email",
  "Company",
  "Lead_Status"
];
var LEAD_PAGE_SIZE = 5;
var REQUEST_TIMEOUT_MS = 15e3;
var ZohoRequestError = class extends Error {
  kind;
  providerCode;
  constructor(kind, providerCode = null) {
    super(kind);
    this.kind = kind;
    this.providerCode = providerCode;
  }
};
function buildAuthorizationUrl(input) {
  const url = new URL("https://accounts.zoho.com/oauth/v2/auth");
  url.searchParams.set("scope", input.scope ?? ZOHO_SCOPE);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}
async function exchangeAuthorizationCode(input, fetchImpl) {
  const accountsOrigin = assertAccountsOrigin(input.accountsServer);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code: input.code
  });
  const payload = await postToken(accountsOrigin, body, fetchImpl);
  if (!payload.refreshToken) {
    throw new ZohoRequestError("missing_refresh_token");
  }
  return payload;
}
async function refreshAccessToken(input, fetchImpl) {
  const accountsOrigin = assertAccountsOrigin(input.accountsOrigin);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken
  });
  return postToken(accountsOrigin, body, fetchImpl);
}
async function revokeRefreshToken(input, fetchImpl) {
  const accountsOrigin = assertAccountsOrigin(input.accountsOrigin);
  try {
    const response = await fetchImpl(`${accountsOrigin}/oauth/v2/token/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: input.refreshToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    return response.ok;
  } catch {
    return false;
  }
}
async function fetchLeads(input, fetchImpl) {
  const apiOrigin = assertApiOrigin(input.apiOrigin);
  const url = new URL("/crm/v8/Leads", apiOrigin);
  url.searchParams.set("fields", LEAD_FIELDS.join(","));
  url.searchParams.set("per_page", String(LEAD_PAGE_SIZE));
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${input.accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new ZohoRequestError("provider_unavailable");
  }
  if (response.status === 204) return [];
  const payload = await readJson(response);
  if (response.status === 429) {
    throw new ZohoRequestError("rate_limited", crmCode(payload));
  }
  if (!response.ok) {
    const code = crmCode(payload);
    if (code === "INVALID_TOKEN" || code === "AUTHENTICATION_FAILURE") {
      throw new ZohoRequestError("invalid_token", code);
    }
    if (code === "OAUTH_SCOPE_MISMATCH") {
      throw new ZohoRequestError("missing_scope", code);
    }
    throw new ZohoRequestError("provider_error", code);
  }
  const data = record(payload)?.data;
  if (!Array.isArray(data)) return [];
  const leads = [];
  for (const item of data) {
    const lead = toLead(item);
    if (lead) leads.push(lead);
    if (leads.length === LEAD_PAGE_SIZE) break;
  }
  return leads;
}
async function postToken(accountsOrigin, body, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${accountsOrigin}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new ZohoRequestError("provider_unavailable");
  }
  const payload = await readJson(response);
  const oauthError = oauthCode(payload);
  if (!response.ok || oauthError) {
    throw new ZohoRequestError("token_exchange_failed", oauthError);
  }
  const fields = record(payload);
  const accessToken = stringField(fields, "access_token");
  const apiDomain = stringField(fields, "api_domain");
  const expiresIn = numberField(fields, "expires_in");
  if (!accessToken || !apiDomain || expiresIn === null || expiresIn < 0) {
    throw new ZohoRequestError("token_exchange_failed");
  }
  let apiOrigin;
  try {
    apiOrigin = assertApiOrigin(apiDomain);
  } catch {
    throw new ZohoRequestError("invalid_api_domain");
  }
  return {
    accessToken,
    refreshToken: stringField(fields, "refresh_token"),
    apiOrigin,
    expiresIn
  };
}
async function readJson(response) {
  const text2 = await response.text();
  if (!text2) return null;
  try {
    return JSON.parse(text2);
  } catch {
    return null;
  }
}
function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}
function stringField(value, key) {
  const field = value?.[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}
function numberField(value, key) {
  const field = value?.[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}
function oauthCode(value) {
  return safeCode(stringField(record(value), "error"));
}
function crmCode(value) {
  return safeCode(stringField(record(value), "code"));
}
function safeCode(value) {
  if (!value || !/^[A-Za-z0-9_.-]{1,64}$/.test(value)) return null;
  return value;
}
function toLead(value) {
  const fields = record(value);
  const id = stringField(fields, "id");
  if (!fields || !id) return null;
  return {
    id,
    firstName: stringField(fields, "First_Name") ?? "",
    lastName: stringField(fields, "Last_Name") ?? "",
    email: stringField(fields, "Email") ?? "",
    company: stringField(fields, "Company") ?? "",
    status: stringField(fields, "Lead_Status") ?? ""
  };
}

// server/preview.ts
var PAGE_SIZE = 5;
async function previewProduct(product, input, fetchImpl) {
  switch (product) {
    case "crm":
      return { sections: [{ title: "Leads", records: (await fetchLeads(input, fetchImpl)).map(leadRecord) }], organizations: [] };
    case "books":
      return booksPreview(input, fetchImpl);
    case "inventory":
      return inventoryPreview(input, fetchImpl);
    case "people":
      return peoplePreview(input, fetchImpl);
    case "desk":
      return deskPreview(input, fetchImpl);
    default:
      throw new ZohoRequestError("provider_error");
  }
}
async function listOrganizations(product, input, fetchImpl) {
  switch (product) {
    case "books":
      return readOrganizations(
        await zohoGet(new URL("/books/v3/organizations", input.apiOrigin), input.accessToken, fetchImpl),
        "organizations",
        "organization_id",
        "name"
      );
    case "inventory":
      return readOrganizations(
        await zohoGet(new URL("/inventory/v1/organizations", input.apiOrigin), input.accessToken, fetchImpl),
        "organizations",
        "organization_id",
        "name"
      );
    case "desk": {
      const origin = serviceOrigin(input.apiOrigin, "desk");
      return readOrganizations(
        await zohoGet(new URL("/api/v1/organizations", origin), input.accessToken, fetchImpl),
        "data",
        "id",
        "companyName"
      );
    }
    default:
      return [];
  }
}
async function booksPreview(input, fetchImpl) {
  const organizations = await listOrganizations("books", input, fetchImpl);
  if (!input.organizationId) return { sections: [], organizations };
  const contactsUrl = new URL("/books/v3/contacts", input.apiOrigin);
  contactsUrl.searchParams.set("organization_id", input.organizationId);
  contactsUrl.searchParams.set("per_page", String(PAGE_SIZE));
  const invoicesUrl = new URL("/books/v3/invoices", input.apiOrigin);
  invoicesUrl.searchParams.set("organization_id", input.organizationId);
  invoicesUrl.searchParams.set("per_page", String(PAGE_SIZE));
  const [contacts, invoices] = await Promise.all([
    zohoGet(contactsUrl, input.accessToken, fetchImpl),
    zohoGet(invoicesUrl, input.accessToken, fetchImpl)
  ]);
  return {
    organizations,
    sections: [
      { title: "Contacts", records: mapRows(contacts, "contacts", "contact_id", "contact_name", "email") },
      { title: "Invoices", records: mapRows(invoices, "invoices", "invoice_id", "invoice_number", "status") }
    ]
  };
}
async function inventoryPreview(input, fetchImpl) {
  const organizations = await listOrganizations("inventory", input, fetchImpl);
  if (!input.organizationId) return { sections: [], organizations };
  const url = new URL("/inventory/v1/items", input.apiOrigin);
  url.searchParams.set("organization_id", input.organizationId);
  url.searchParams.set("per_page", String(PAGE_SIZE));
  const payload = await zohoGet(url, input.accessToken, fetchImpl);
  return {
    organizations,
    sections: [{ title: "Items", records: mapRows(payload, "items", "item_id", "name", "sku") }]
  };
}
async function peoplePreview(input, fetchImpl) {
  const origin = serviceOrigin(input.apiOrigin, "people");
  const url = new URL("/people/api/forms/employee/getRecords", origin);
  url.searchParams.set("sIndex", "1");
  url.searchParams.set("limit", String(PAGE_SIZE));
  const payload = await zohoGet(url, input.accessToken, fetchImpl);
  return { organizations: [], sections: [{ title: "Employees", records: peopleRecords(payload) }] };
}
async function deskPreview(input, fetchImpl) {
  const organizations = await listOrganizations("desk", input, fetchImpl);
  if (!input.organizationId) return { sections: [], organizations };
  const origin = serviceOrigin(input.apiOrigin, "desk");
  const url = new URL("/api/v1/tickets", origin);
  url.searchParams.set("limit", String(PAGE_SIZE));
  const payload = await zohoGet(url, input.accessToken, fetchImpl, { orgId: input.organizationId });
  return {
    organizations,
    sections: [{ title: "Tickets", records: mapRows(payload, "data", "id", "subject", "status") }]
  };
}
function leadRecord(lead) {
  const title = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unnamed lead";
  return {
    id: lead.id,
    title,
    detail: [lead.email, lead.company, lead.status].filter(Boolean).join(" \xB7 ")
  };
}
async function zohoGet(url, accessToken, fetchImpl, extraHeaders) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        ...extraHeaders
      },
      signal: AbortSignal.timeout(15e3)
    });
  } catch {
    throw new ZohoRequestError("provider_unavailable");
  }
  if (response.status === 204) return null;
  const text2 = await response.text();
  let payload = null;
  if (text2) {
    try {
      payload = JSON.parse(text2);
    } catch {
      payload = null;
    }
  }
  if (response.status === 429) throw new ZohoRequestError("rate_limited", codeOf(payload));
  if (!response.ok) {
    const code = codeOf(payload);
    if (code === "INVALID_TOKEN" || code === "AUTHENTICATION_FAILURE") {
      throw new ZohoRequestError("invalid_token", code);
    }
    if (code === "OAUTH_SCOPE_MISMATCH" || code === "INVALID_OAUTHSCOPE") {
      throw new ZohoRequestError("missing_scope", code);
    }
    throw new ZohoRequestError("provider_error", code);
  }
  return payload;
}
function readOrganizations(payload, listKey, idKey, nameKey) {
  const list = arrayField(payload, listKey);
  const organizations = [];
  for (const item of list) {
    const record2 = asRecord(item);
    const id = text(record2, idKey);
    if (!id) continue;
    organizations.push({ id, name: text(record2, nameKey) ?? id });
    if (organizations.length === 20) break;
  }
  return organizations;
}
function mapRows(payload, listKey, idKey, titleKey, detailKey) {
  const records = [];
  for (const item of arrayField(payload, listKey)) {
    const record2 = asRecord(item);
    const id = text(record2, idKey);
    if (!id) continue;
    records.push({
      id,
      title: text(record2, titleKey) ?? "Untitled",
      detail: text(record2, detailKey) ?? ""
    });
    if (records.length === PAGE_SIZE) break;
  }
  return records;
}
function peopleRecords(payload) {
  const response = asRecord(payload)?.response;
  const result = asRecord(response)?.result;
  const rows = Array.isArray(result) ? result : [];
  const records = [];
  for (const row of rows) {
    const record2 = asRecord(row);
    if (!record2) continue;
    const first = Object.values(record2)[0];
    const fields = Array.isArray(first) ? asRecord(first[0]) : asRecord(first);
    const id = text(fields, "Zoho_ID") ?? text(fields, "recordId") ?? text(record2, "recordId");
    if (!id) continue;
    const title = [text(fields, "FirstName"), text(fields, "LastName")].filter(Boolean).join(" ") || text(fields, "EmployeeID") || "Employee";
    records.push({ id, title, detail: text(fields, "EmailID") ?? "" });
    if (records.length === PAGE_SIZE) break;
  }
  return records;
}
function arrayField(payload, key) {
  const value = asRecord(payload)?.[key];
  return Array.isArray(value) ? value : [];
}
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}
function text(record2, key) {
  const value = record2?.[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
function codeOf(payload) {
  const code = asRecord(payload)?.code ?? asRecord(payload)?.error;
  if (typeof code !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(code)) return null;
  return code;
}

// src/data/zohoProducts.ts
var PLANNED_DOCS = "https://www.zoho.com/developer/";
function planned(id, name, description, category, initials, icon) {
  return {
    id,
    cardId: `zoho-${id}`,
    name,
    description,
    category,
    initials,
    icon,
    availability: "planned",
    scopes: [],
    docsUrl: PLANNED_DOCS,
    note: "This product is listed, but its API is not connected yet."
  };
}
var ZOHO_PRODUCTS = [
  {
    id: "crm",
    cardId: "zoho-crm",
    name: "Zoho CRM",
    description: "Manage leads, contacts and sales pipelines.",
    category: "crm",
    initials: "ZC",
    icon: "Users",
    availability: "available",
    scopes: ["ZohoCRM.modules.leads.READ"],
    docsUrl: "https://www.zoho.com/crm/developer/docs/api/v8/oauth-overview.html",
    note: "Read-only lead preview."
  },
  planned("bigin", "Zoho Bigin", "Pipeline for small sales teams.", "crm", "BG", "Target"),
  planned("salesiq", "Zoho SalesIQ", "Website visitor and chat information.", "support", "SQ", "MessageSquare"),
  {
    id: "books",
    cardId: "zoho-books",
    name: "Zoho Books",
    description: "Invoices, expenses and receivables.",
    category: "accounting",
    initials: "ZB",
    icon: "BookOpen",
    availability: "available",
    scopes: ["ZohoBooks.contacts.READ", "ZohoBooks.invoices.READ", "ZohoBooks.settings.READ"],
    docsUrl: "https://www.zoho.com/books/api/v3/oauth/",
    note: "Read-only contacts and invoices. Choose an organization when Zoho returns more than one."
  },
  {
    id: "inventory",
    cardId: "zoho-inventory",
    name: "Zoho Inventory",
    description: "Items and stock records.",
    category: "ecommerce",
    initials: "ZI",
    icon: "Package",
    availability: "available",
    scopes: ["ZohoInventory.items.READ", "ZohoInventory.settings.READ"],
    docsUrl: "https://www.zoho.com/inventory/api/v1/oauth/",
    note: "Read-only items. Choose an organization when Zoho returns more than one."
  },
  planned("invoice", "Zoho Invoice", "Customer invoices and estimates.", "accounting", "IV", "FileText"),
  planned("expense", "Zoho Expense", "Expense reports and receipts.", "accounting", "EX", "Calculator"),
  planned("billing", "Zoho Billing", "Subscriptions and recurring invoices.", "accounting", "BL", "CreditCard"),
  planned("checkout", "Zoho Checkout", "Payment pages and checkout records.", "payments", "CH", "CreditCard"),
  {
    id: "people",
    cardId: "zoho-people",
    name: "Zoho People",
    description: "Employee and HR information.",
    category: "hr",
    initials: "ZP",
    icon: "Users",
    availability: "available",
    scopes: ["ZOHOPEOPLE.forms.READ"],
    docsUrl: "https://www.zoho.com/people/api/v3/scopes.html",
    note: "Read-only employee form records."
  },
  planned("recruit", "Zoho Recruit", "Candidates and hiring pipelines.", "hr", "ZR", "Briefcase"),
  {
    id: "desk",
    cardId: "zoho-desk",
    name: "Zoho Desk",
    description: "Support tickets and customer queries.",
    category: "support",
    initials: "ZD",
    icon: "Ticket",
    availability: "available",
    scopes: ["Desk.tickets.READ", "Desk.basic.READ"],
    docsUrl: "https://desk.zoho.com/DeskAPIDocument",
    note: "Read-only tickets. Choose a Desk organization when Zoho returns more than one."
  },
  planned("assist", "Zoho Assist", "Remote support session information.", "support", "ZA", "Headset"),
  planned("mail", "Zoho Mail", "Business mailboxes.", "email", "ZM", "Mail"),
  planned("calendar", "Zoho Calendar", "Events and schedules.", "calendar", "CL", "Calendar"),
  planned("workdrive", "Zoho WorkDrive", "Team files and folders.", "files", "WD", "Folder"),
  planned("writer", "Zoho Writer", "Documents.", "files", "WR", "FileText"),
  planned("sheet", "Zoho Sheet", "Spreadsheets.", "files", "SH", "FileText"),
  planned("cliq", "Zoho Cliq", "Team conversations.", "email", "CQ", "MessageCircle"),
  planned("connect", "Zoho Connect", "Internal company network.", "email", "CN", "MessageSquare"),
  planned("meeting", "Zoho Meeting", "Meetings and webinars.", "calendar", "MT", "CalendarDays"),
  planned("projects", "Zoho Projects", "Projects and tasks.", "project", "PJ", "CheckSquare"),
  planned("sprints", "Zoho Sprints", "Agile sprints and work items.", "project", "SP", "ListTodo"),
  planned("sign", "Zoho Sign", "Signature requests.", "files", "SG", "PenTool"),
  planned("campaigns", "Zoho Campaigns", "Email campaigns.", "marketing", "CP", "Send"),
  planned(
    "marketing-automation",
    "Zoho Marketing Automation",
    "Journeys and campaign automation.",
    "marketing",
    "MA",
    "Megaphone"
  ),
  planned("commerce", "Zoho Commerce", "Store orders and catalog.", "ecommerce", "CO", "ShoppingBag"),
  planned("social", "Zoho Social", "Social media accounts.", "marketing", "SO", "MessageCircle"),
  planned("analytics", "Zoho Analytics", "Reports and dashboards.", "accounting", "AN", "BarChart3"),
  planned("creator", "Zoho Creator", "Custom apps and forms.", "project", "CR", "SquareDot"),
  planned("forms", "Zoho Forms", "Form submissions.", "files", "FM", "FileText"),
  planned("flow", "Zoho Flow", "Integration workflows.", "project", "FL", "TrendingUp"),
  planned("directory", "Zoho Directory", "Organization users and apps.", "hr", "DR", "BadgeCheck")
];
var BY_ID = new Map(ZOHO_PRODUCTS.map((product) => [product.id, product]));
var BY_CARD = new Map(ZOHO_PRODUCTS.map((product) => [product.cardId, product]));
function zohoProductById(id) {
  return BY_ID.get(id) ?? null;
}

// server/app.ts
var ACCESS_REFRESH_SKEW_MS = 6e4;
var STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
var CODE_PATTERN = /^[A-Za-z0-9._~-]{1,1024}$/;
var IDENTITY = "local-browser-session";
var PUBLIC_MESSAGES = {
  not_connected: "This Zoho product is not connected.",
  rate_limited: "Zoho rate limit reached. Try again shortly.",
  missing_scope: "Zoho did not allow the requested read access. Reconnect and grant that permission.",
  reconnect_required: "The Zoho connection expired. Reconnect this product.",
  provider_unavailable: "Zoho could not be reached. No data was changed.",
  provider_error: "Zoho could not complete the request.",
  server_error: "The request could not be completed.",
  planned: "This Zoho product is not available to connect yet.",
  persistence_unavailable: "Production token storage is not configured. Set DATABASE_URL to a Postgres database before connecting Zoho."
};
var CRM_PRODUCT = "crm";
var ORG_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
var rateBuckets = /* @__PURE__ */ new Map();
async function handleZohoRequest(req, res, deps) {
  const body = await readBody(req);
  if (body === null) {
    sendJson(res, 413, publicError("server_error"));
    return;
  }
  const path = requestPath(req.url);
  const method = req.method ?? "GET";
  if (path === "/api/health" && method === "GET") {
    await handleHealth(res, deps);
    return;
  }
  if (path === "/api/ready" && method === "GET") {
    await handleHealth(res, deps);
    return;
  }
  if (path === "/api/integrations" && method === "GET") {
    await handleCatalog(req, res, deps);
    return;
  }
  if (path === "/api/integrations/zoho/connect" && method === "GET") {
    await handleConnect(req, res, deps, CRM_PRODUCT);
    return;
  }
  if (path === "/api/integrations/zoho/callback" && method === "GET") {
    await handleCallback(req, res, deps);
    return;
  }
  if (path === "/api/integrations/zoho/status" && method === "GET") {
    await handleStatus(req, res, deps, CRM_PRODUCT);
    return;
  }
  if (path === "/api/integrations/zoho/leads" && method === "GET") {
    await handleLeads(req, res, deps);
    return;
  }
  if (path === "/api/integrations/zoho/disconnect" && method === "POST") {
    await handleDisconnect(req, res, deps, CRM_PRODUCT);
    return;
  }
  const productRoute = path.match(
    /^\/api\/integrations\/zoho\/([a-z0-9-]+)\/(connect|disconnect|preview|organization)$/
  );
  if (productRoute) {
    const product = productRoute[1] ?? "";
    const action = productRoute[2];
    if (action === "connect" && method === "GET") {
      await handleConnect(req, res, deps, product);
      return;
    }
    if (action === "disconnect" && method === "POST") {
      await handleDisconnect(req, res, deps, product);
      return;
    }
    if (action === "preview" && method === "GET") {
      await handlePreview(req, res, deps, product);
      return;
    }
    if (action === "organization" && method === "POST") {
      await handleOrganization(req, res, deps, product, body);
      return;
    }
    sendJson(res, 405, publicError("server_error"));
    return;
  }
  const statusRoute = path.match(/^\/api\/integrations\/([a-z0-9-]+)\/status$/);
  if (statusRoute && method === "GET") {
    await handleStatus(req, res, deps, statusRoute[1] ?? "");
    return;
  }
  if (path.startsWith("/api/integrations/zoho/")) {
    sendJson(res, 405, publicError("server_error"));
    return;
  }
  sendJson(res, 404, publicError("server_error"));
}
async function handleConnect(req, res, deps, productId) {
  const product = zohoProductById(productId);
  if (!product) {
    sendJson(res, 404, publicError("server_error"));
    return;
  }
  if (product.availability !== "available") {
    sendJson(res, 409, publicError("planned"));
    return;
  }
  if (!persistenceReady(deps)) {
    sendJson(res, 503, publicError("persistence_unavailable"));
    return;
  }
  if (limited(req, deps, "connect", 20, 10 * 6e4)) {
    sendJson(res, 429, publicError("rate_limited"));
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
    scope: product.scopes.join(",")
  });
  redirect(res, location, cookie);
}
async function handleCallback(req, res, deps) {
  const params = requestParams(req.url);
  const errorParam = bounded(params.get("error"), 64);
  const state = bounded(params.get("state"), 128);
  const active = await resolveSession(req, deps, false);
  if (errorParam) {
    await consumeIfValid(deps, state, active?.session.id ?? null);
    redirect(
      res,
      errorLocation(errorParam === "access_denied" ? "access_denied" : "provider_error")
    );
    return;
  }
  if (!active) {
    redirect(res, errorLocation("invalid_state"));
    return;
  }
  if (!state || !STATE_PATTERN.test(state)) {
    redirect(res, errorLocation("invalid_state"));
    return;
  }
  const code = bounded(params.get("code"), 1024);
  if (!code || !CODE_PATTERN.test(code)) {
    await consumeIfValid(deps, state, active.session.id);
    redirect(res, errorLocation("missing_code"));
    return;
  }
  const accountsServer = bounded(params.get("accounts-server"), 200);
  let accountsOrigin;
  try {
    accountsOrigin = accountsServer ? assertAccountsOrigin(accountsServer) : "";
  } catch {
    accountsOrigin = "";
  }
  if (!accountsOrigin) {
    await consumeIfValid(deps, state, active.session.id);
    redirect(res, errorLocation("invalid_accounts_server"));
    return;
  }
  const productId = await deps.store.consumeOauthState(state, active.session.id, clock(deps));
  const product = productId ? zohoProductById(productId) : null;
  if (!product || product.availability !== "available") {
    redirect(res, errorLocation("invalid_state"));
    return;
  }
  try {
    const tokens = await exchangeAuthorizationCode(
      {
        accountsServer: accountsOrigin,
        clientId: deps.config.clientId,
        clientSecret: deps.config.clientSecret,
        redirectUri: deps.config.redirectUri,
        code
      },
      fetchOf(deps)
    );
    if (!tokens.refreshToken) {
      redirect(res, errorLocation("missing_refresh_token"));
      return;
    }
    const now = clock(deps);
    const next = newSession(now, active.session.userId);
    const rotated = await deps.store.rotateSession(active.session.id, now, next);
    if (!rotated) {
      redirect(res, errorLocation("provider_error"));
      return;
    }
    const connectionId = randomUUID2();
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
        connectionId
      ),
      accessTokenExpiresAt: now + tokens.expiresIn * 1e3,
      scope: product.scopes.join(","),
      organizationId: null,
      createdAt,
      updatedAt: createdAt
    });
    redirect(
      res,
      `/?${new URLSearchParams({ zoho: "connected", product: product.id }).toString()}`,
      cookieFor(rotated, deps, now)
    );
  } catch (error) {
    const reason = callbackReason(error);
    if (error instanceof ZohoRequestError && error.providerCode) {
      loggerOf(deps)("token_exchange_failed", { providerCode: error.providerCode });
    } else {
      loggerOf(deps)(reason);
    }
    redirect(res, errorLocation(reason));
  }
}
async function handleCatalog(req, res, deps) {
  const active = await resolveSession(req, deps, true);
  const connections = active ? await deps.store.listConnections({ sessionId: active.session.id, userId: active.session.userId }) : [];
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
          scope: connection?.scope ?? null
        };
      })
    },
    active?.cookie
  );
}
async function handleStatus(req, res, deps, productId) {
  if (!zohoProductById(productId)) {
    sendJson(res, 404, publicError("server_error"));
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
async function handleLeads(req, res, deps) {
  const active = await resolveSession(req, deps, true);
  if (!active) {
    sendJson(res, 401, publicError("not_connected"));
    return;
  }
  const owner = ownerOf(active.session, CRM_PRODUCT);
  let connection = await deps.store.getConnection(owner);
  if (!connection) {
    sendJson(res, 401, publicError("not_connected"), active.cookie);
    return;
  }
  try {
    connection = await refreshIfDue(connection, deps, false);
    let accessToken = readSecret(connection, deps, "access");
    if (!accessToken) {
      await deps.store.deleteConnection(owner);
      sendJson(res, 401, publicError("reconnect_required"), active.cookie);
      return;
    }
    try {
      const leads = await fetchLeads(
        { apiOrigin: connection.apiOrigin, accessToken },
        fetchOf(deps)
      );
      sendJson(
        res,
        200,
        { leads, apiDomain: connection.apiOrigin },
        active.cookie
      );
    } catch (error) {
      if (!(error instanceof ZohoRequestError) || error.kind !== "invalid_token") {
        throw error;
      }
      connection = await refreshIfDue(connection, deps, true);
      accessToken = readSecret(connection, deps, "access");
      if (!accessToken) {
        await deps.store.deleteConnection(owner);
        sendJson(res, 401, publicError("reconnect_required"), active.cookie);
        return;
      }
      const leads = await fetchLeads(
        { apiOrigin: connection.apiOrigin, accessToken },
        fetchOf(deps)
      );
      sendJson(
        res,
        200,
        { leads, apiDomain: connection.apiOrigin },
        active.cookie
      );
    }
  } catch (error) {
    if (error instanceof ZohoRequestError) {
      if (error.providerCode) {
        loggerOf(deps)(error.kind, { providerCode: error.providerCode });
      }
      const mapped = zohoHttpError(error);
      if (mapped.code === "reconnect_required") {
        await deps.store.deleteConnection(owner);
      }
      sendJson(res, mapped.status, publicError(mapped.code), active.cookie);
      return;
    }
    loggerOf(deps)("provider_error");
    sendJson(res, 502, publicError("provider_error"), active.cookie);
  }
}
async function handlePreview(req, res, deps, productId) {
  const product = zohoProductById(productId);
  if (!product || product.availability !== "available") {
    sendJson(res, 404, publicError("server_error"));
    return;
  }
  const active = await resolveSession(req, deps, true);
  if (!active) {
    sendJson(res, 401, publicError("not_connected"));
    return;
  }
  if (limited(req, deps, "preview", 60, 6e4)) {
    sendJson(res, 429, publicError("rate_limited"), active.cookie);
    return;
  }
  const owner = ownerOf(active.session, product.id);
  let connection = await deps.store.getConnection(owner);
  if (!connection) {
    sendJson(res, 401, publicError("not_connected"), active.cookie);
    return;
  }
  try {
    connection = await refreshIfDue(connection, deps, false);
    const accessToken = readSecret(connection, deps, "access");
    if (!accessToken) {
      await deps.store.deleteConnection(owner);
      sendJson(res, 401, publicError("reconnect_required"), active.cookie);
      return;
    }
    let preview = await previewProduct(
      product.id,
      {
        apiOrigin: connection.apiOrigin,
        accessToken,
        organizationId: connection.organizationId
      },
      fetchOf(deps)
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
            organizationId: only.id
          },
          fetchOf(deps)
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
        needsOrganization: organizationProducts(product.id) && !connection.organizationId && preview.organizations.length > 1,
        organizations: preview.organizations,
        sections: preview.sections
      },
      active.cookie
    );
  } catch (error) {
    await sendZohoError(res, deps, owner, error, active.cookie);
  }
}
async function handleOrganization(req, res, deps, productId, body) {
  if (!hasCsrfHeader(req)) {
    sendJson(res, 403, publicError("server_error"));
    return;
  }
  const product = zohoProductById(productId);
  if (!product || !organizationProducts(product.id)) {
    sendJson(res, 404, publicError("server_error"));
    return;
  }
  const active = await resolveSession(req, deps, true);
  if (!active) {
    sendJson(res, 401, publicError("not_connected"));
    return;
  }
  let requested = null;
  try {
    const parsed = JSON.parse(body);
    const value = parsed && typeof parsed === "object" && "organizationId" in parsed ? parsed.organizationId : null;
    requested = typeof value === "string" ? value : null;
  } catch {
    requested = null;
  }
  if (!requested || !ORG_ID_PATTERN.test(requested)) {
    sendJson(res, 400, publicError("server_error"), active.cookie);
    return;
  }
  const owner = ownerOf(active.session, product.id);
  const connection = await deps.store.getConnection(owner);
  if (!connection) {
    sendJson(res, 401, publicError("not_connected"), active.cookie);
    return;
  }
  const accessToken = readSecret(connection, deps, "access");
  if (!accessToken) {
    sendJson(res, 401, publicError("reconnect_required"), active.cookie);
    return;
  }
  try {
    const organizations = await listOrganizations(
      product.id,
      { apiOrigin: connection.apiOrigin, accessToken },
      fetchOf(deps)
    );
    if (!organizations.some((organization) => organization.id === requested)) {
      sendJson(res, 400, publicError("server_error"), active.cookie);
      return;
    }
    await deps.store.setOrganization(owner, requested);
    sendJson(res, 200, { organizationId: requested }, active.cookie);
  } catch (error) {
    await sendZohoError(res, deps, owner, error, active.cookie);
  }
}
async function handleDisconnect(req, res, deps, productId) {
  if (!hasCsrfHeader(req)) {
    sendJson(res, 403, publicError("server_error"));
    return;
  }
  if (!zohoProductById(productId)) {
    sendJson(res, 404, publicError("server_error"));
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
  const refreshToken = readSecret(connection, deps, "refresh");
  if (refreshToken) {
    revoked = await revokeRefreshToken(
      { accountsOrigin: connection.accountsOrigin, refreshToken },
      fetchOf(deps)
    );
  }
  await deps.store.deleteConnection(owner);
  sendJson(res, 200, { disconnected: true, revoked }, active.cookie);
}
async function refreshIfDue(connection, deps, force) {
  const now = clock(deps);
  const due = connection.accessTokenExpiresAt - ACCESS_REFRESH_SKEW_MS <= now;
  if (!force && !due) return connection;
  const refreshToken = readSecret(connection, deps, "refresh");
  if (!refreshToken) {
    throw new ZohoRequestError("invalid_token");
  }
  const next = await refreshAccessToken(
    {
      accountsOrigin: connection.accountsOrigin,
      clientId: deps.config.clientId,
      clientSecret: deps.config.clientSecret,
      refreshToken
    },
    fetchOf(deps)
  );
  const updated = {
    ...connection,
    apiOrigin: next.apiOrigin,
    accessToken: encryptString(next.accessToken, deps.config.tokenEncryptionKey, connection.id),
    refreshToken: next.refreshToken ? encryptString(next.refreshToken, deps.config.tokenEncryptionKey, connection.id) : connection.refreshToken,
    accessTokenExpiresAt: now + next.expiresIn * 1e3,
    updatedAt: now
  };
  await deps.store.updateConnectionSecrets(updated);
  return updated;
}
async function resolveSession(req, deps, rotate) {
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
function newSession(now, userId) {
  return {
    id: createSessionId(),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    userId
  };
}
function cookieFor(session, deps, now) {
  const token = signSession(
    { sid: session.id, iat: session.createdAt, exp: session.expiresAt },
    deps.config.sessionSecret
  );
  return serializeSessionCookie(token, {
    production: deps.config.production,
    maxAgeSeconds: Math.max(0, Math.floor((session.expiresAt - now) / 1e3))
  });
}
function ownerOf(session, product) {
  return { sessionId: session.id, userId: session.userId, product };
}
function readSecret(connection, deps, which) {
  try {
    const secret = which === "access" ? connection.accessToken : connection.refreshToken;
    const value = decryptString(secret, deps.config.tokenEncryptionKey, connection.id);
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
function statusBody(connection, product) {
  if (!connection) {
    return { connected: false, product, identity: IDENTITY };
  }
  return {
    connected: true,
    product,
    apiDomain: connection.apiOrigin,
    scope: connection.scope,
    organizationId: connection.organizationId,
    identity: IDENTITY
  };
}
function organizationProducts(product) {
  return product === "books" || product === "inventory" || product === "desk";
}
function needsSingleOrganization(product, organizationId, organizations) {
  return organizationProducts(product) && !organizationId && organizations.length === 1;
}
function persistenceReady(deps) {
  if (process.env.VERCEL === "1" && !deps.config.databaseUrl) return false;
  return true;
}
function persistenceName(deps) {
  if (deps.config.databaseUrl) return "postgres";
  if (!persistenceReady(deps)) return "unavailable";
  return "sqlite";
}
var REQUIRED_TABLES = ["oauth_states", "sessions", "zoho_connections"];
async function handleHealth(res, deps) {
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
    loggerOf(deps)("database_check_failed");
    sendJson(res, 503, {
      ok: false,
      persistence,
      identity: IDENTITY,
      tables: [],
      message: safeDbMessage(error)
    });
  }
}
function safeDbMessage(error) {
  const message = error instanceof Error ? error.message : "Database check failed.";
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]").slice(0, 180);
}
function hasCsrfHeader(req) {
  return req.headers["x-em-request"] === "1";
}
function limited(req, deps, action, limit, windowMs) {
  if (!deps.config.production || deps.now) return false;
  const now = clock(deps);
  const session = readCookie(req.headers.cookie, SESSION_COOKIE) ?? "anonymous";
  const key = `${action}:${session.slice(0, 32)}`;
  const recent = (rateBuckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  recent.push(now);
  rateBuckets.set(key, recent);
  return recent.length > limit;
}
async function sendZohoError(res, deps, owner, error, cookie) {
  if (error instanceof ZohoRequestError) {
    if (error.providerCode) loggerOf(deps)(error.kind, { providerCode: error.providerCode });
    const mapped = zohoHttpError(error);
    if (mapped.code === "reconnect_required") await deps.store.deleteConnection(owner);
    sendJson(res, mapped.status, publicError(mapped.code), cookie);
    return;
  }
  loggerOf(deps)("provider_error");
  sendJson(res, 502, publicError("provider_error"), cookie);
}
async function consumeIfValid(deps, state, sessionId) {
  if (!state || !sessionId || !STATE_PATTERN.test(state)) return;
  await deps.store.consumeOauthState(state, sessionId, clock(deps));
}
function callbackReason(error) {
  if (error instanceof DomainError) {
    return error.kind === "invalid_accounts_server" ? "invalid_accounts_server" : "invalid_api_domain";
  }
  if (error instanceof ZohoRequestError) {
    switch (error.kind) {
      case "token_exchange_failed":
        return "token_exchange_failed";
      case "missing_refresh_token":
        return "missing_refresh_token";
      case "invalid_api_domain":
        return "invalid_api_domain";
      case "provider_unavailable":
      case "rate_limited":
      case "invalid_token":
      case "missing_scope":
      case "provider_error":
        return "provider_error";
      default: {
        const neverKind = error.kind;
        return neverKind;
      }
    }
  }
  return "provider_error";
}
function zohoHttpError(error) {
  switch (error.kind) {
    case "rate_limited":
      return { status: 429, code: "rate_limited" };
    case "missing_scope":
      return { status: 403, code: "missing_scope" };
    case "invalid_token":
      return { status: 401, code: "reconnect_required" };
    case "provider_unavailable":
      return { status: 503, code: "provider_unavailable" };
    case "token_exchange_failed":
      if (isDeadGrant(error)) return { status: 401, code: "reconnect_required" };
      return { status: 502, code: "provider_error" };
    case "missing_refresh_token":
    case "invalid_api_domain":
    case "provider_error":
      return { status: 502, code: "provider_error" };
    default: {
      const neverKind = error.kind;
      return neverKind;
    }
  }
}
function isDeadGrant(error) {
  return error.providerCode === "invalid_code" || error.providerCode === "invalid_grant" || error.providerCode === "invalid_token";
}
function publicError(code) {
  return { error: code, message: PUBLIC_MESSAGES[code] };
}
function errorLocation(reason) {
  return `/?${new URLSearchParams({ zoho: "error", reason }).toString()}`;
}
function redirect(res, location, cookie) {
  const headers = {
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
  if (cookie) headers["Set-Cookie"] = cookie;
  res.writeHead(302, headers);
  res.end();
}
function sendJson(res, status, body, cookie) {
  const payload = JSON.stringify(body);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(payload)
  };
  if (cookie) headers["Set-Cookie"] = cookie;
  res.writeHead(status, headers);
  res.end(payload);
}
function requestPath(rawUrl) {
  const path = (rawUrl ?? "/").split("?")[0] ?? "/";
  const normalized = path.length > 0 ? path : "/";
  if (normalized === "/health" || normalized.startsWith("/integrations/")) {
    return `/api${normalized}`;
  }
  return normalized;
}
function requestParams(rawUrl) {
  try {
    return new URL(rawUrl ?? "/", "http://127.0.0.1").searchParams;
  } catch {
    return new URLSearchParams();
  }
}
function bounded(value, max) {
  if (value === null || value.length === 0 || value.length > max) return null;
  return value;
}
async function readBody(req) {
  const chunks = [];
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
  return Buffer.concat(chunks).toString("utf8");
}
function clock(deps) {
  return deps.now ? deps.now() : Date.now();
}
function fetchOf(deps) {
  return deps.fetchImpl ?? fetch;
}
function loggerOf(deps) {
  return deps.logger ?? ((event, fields) => {
    const suffix = fields ? ` ${Object.entries(fields).map(([key, value]) => `${key}=${String(value)}`).join(" ")}` : "";
    console.info(`[zoho] ${event}${suffix}`);
  });
}

// server/open-store.ts
async function openConfiguredStore(config) {
  if (config.databaseUrl) {
    const { openPostgresStore: openPostgresStore2 } = await Promise.resolve().then(() => (init_postgres_store(), postgres_store_exports));
    return openPostgresStore2(config.databaseUrl);
  }
  if (process.env.VERCEL === "1") return unavailableStore();
  const sqliteEntry = "./store.ts";
  const { openTokenStore } = await import(sqliteEntry);
  return openTokenStore(config.databasePath);
}
function unavailableStore() {
  const refused = () => Promise.reject(new Error("DATABASE_URL is required in production."));
  return {
    createSession: refused,
    getSession: () => Promise.resolve(null),
    rotateSession: () => Promise.resolve(null),
    saveOauthState: refused,
    consumeOauthState: () => Promise.resolve(null),
    saveConnection: refused,
    getConnection: () => Promise.resolve(null),
    listConnections: () => Promise.resolve([]),
    deleteConnection: () => Promise.resolve(null),
    updateConnectionSecrets: refused,
    setOrganization: () => Promise.resolve(false),
    ping: () => Promise.resolve({ tables: [] }),
    close: () => Promise.resolve()
  };
}

// server/vercel-handler.ts
init_postgres_store();
var ready = null;
var REQUIRED_TABLES3 = ["oauth_states", "sessions", "zoho_connections"];
async function reportDatabaseHealth(res) {
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) {
    sendJson2(res, 503, { ok: false, persistence: "unavailable", identity: IDENTITY, tables: [] });
    return;
  }
  try {
    const store = await openPostgresStore(databaseUrl);
    const ping = await store.ping();
    await store.close();
    const tables = ping.tables.filter((name) => REQUIRED_TABLES3.includes(name)).sort();
    const ok = REQUIRED_TABLES3.every((name) => tables.includes(name));
    sendJson2(res, ok ? 200 : 503, { ok, persistence: "postgres", identity: IDENTITY, tables });
  } catch (error) {
    sendJson2(res, 503, {
      ok: false,
      persistence: "postgres",
      identity: IDENTITY,
      tables: [],
      message: safeMessage(error)
    });
  }
}
function sendJson2(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
function safeMessage(error) {
  const message = error instanceof Error ? error.message : "Database check failed.";
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]").slice(0, 180);
}
function restoreForwardedPath(req) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const forwarded = url.searchParams.get("em_path");
  if (forwarded === null) return;
  url.searchParams.delete("em_path");
  const suffix = forwarded.replace(/^\/+/, "");
  url.pathname = suffix ? `/api/${suffix}` : "/api";
  const query = url.searchParams.toString();
  req.url = query ? `${url.pathname}?${query}` : url.pathname;
}
function context() {
  if (!ready) {
    ready = (async () => {
      const config = loadConfig(process.env);
      const store = await openConfiguredStore(config);
      return { config, store };
    })();
  }
  return ready;
}
async function handler(req, res) {
  restoreForwardedPath(req);
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  if (path === "/api/health" || path === "/health") {
    await reportDatabaseHealth(res);
    return;
  }
  try {
    const deps = await context();
    await handleZohoRequest(req, res, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid server configuration.";
    const safe = message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]");
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ error: "server_error", message: safe }));
    }
  }
}
export {
  handler as default
};
