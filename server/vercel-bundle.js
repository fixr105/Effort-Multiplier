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
        await client.query(
          "UPDATE google_grants SET session_id = $1, user_id = $2 WHERE session_id = $3",
          [next.id, next.userId, sessionId]
        );
        await client.query(
          "UPDATE google_connections SET session_id = $1 WHERE session_id = $2",
          [next.id, sessionId]
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
    async getGoogleGrant(sessionId, googleSub) {
      const result = await pool.query(
        `${googleGrantSelect()} WHERE session_id = $1 AND google_sub = $2`,
        [sessionId, googleSub]
      );
      return mapGoogleGrant(result.rows[0]);
    },
    async insertGoogleGrant(grant) {
      await pool.query(
        `INSERT INTO google_grants (
          id, session_id, user_id, google_sub, email,
          access_iv, access_tag, access_ciphertext,
          refresh_iv, refresh_tag, refresh_ciphertext,
          access_expires_at, granted_scopes, refreshed_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        googleGrantValues(grant)
      );
    },
    async updateGoogleGrant(grant) {
      await pool.query(
        `UPDATE google_grants
         SET email = $1, access_iv = $2, access_tag = $3, access_ciphertext = $4,
             refresh_iv = $5, refresh_tag = $6, refresh_ciphertext = $7,
             access_expires_at = $8, granted_scopes = $9, refreshed_at = $10, updated_at = $11
         WHERE id = $12 AND session_id = $13`,
        [
          grant.email,
          grant.accessToken.iv,
          grant.accessToken.tag,
          grant.accessToken.ciphertext,
          grant.refreshToken.iv,
          grant.refreshToken.tag,
          grant.refreshToken.ciphertext,
          grant.accessTokenExpiresAt,
          grant.grantedScopes,
          grant.refreshedAt,
          grant.updatedAt,
          grant.id,
          grant.sessionId
        ]
      );
    },
    async listGoogleConnections(sessionId) {
      const result = await pool.query(
        `SELECT c.id AS connection_id, c.grant_id, c.product, c.scopes,
                c.created_at AS connection_created_at, c.updated_at AS connection_updated_at,
                g.id, g.session_id, g.user_id, g.google_sub, g.email,
                g.access_iv, g.access_tag, g.access_ciphertext,
                g.refresh_iv, g.refresh_tag, g.refresh_ciphertext,
                g.access_expires_at, g.granted_scopes, g.refreshed_at, g.created_at, g.updated_at
         FROM google_connections c
         JOIN google_grants g ON g.id = c.grant_id AND g.session_id = c.session_id
         WHERE c.session_id = $1`,
        [sessionId]
      );
      return result.rows.map((row) => mapGoogleConnection(row)).filter((row) => row !== null);
    },
    async upsertGoogleConnection(input) {
      const result = await pool.query(
        `INSERT INTO google_connections (id, grant_id, session_id, product, scopes, created_at, updated_at)
         SELECT $1, id, session_id, $2, $3, $4, $5
         FROM google_grants
         WHERE id = $6 AND session_id = $7
         ON CONFLICT (session_id, product) DO UPDATE SET
           grant_id = EXCLUDED.grant_id,
           scopes = EXCLUDED.scopes,
           updated_at = EXCLUDED.updated_at`,
        [input.id, input.product, input.scopes, input.createdAt, input.updatedAt, input.grantId, input.sessionId]
      );
      if ((result.rowCount ?? 0) !== 1) {
        throw new Error("google_grant_session_mismatch");
      }
    },
    async deleteGoogleConnection(sessionId, product) {
      const result = await pool.query(
        "DELETE FROM google_connections WHERE session_id = $1 AND product = $2",
        [sessionId, product]
      );
      return (result.rowCount ?? 0) === 1;
    },
    async deleteGoogleGrant(sessionId, grantId) {
      await pool.query(
        "DELETE FROM google_connections WHERE grant_id = $1 AND session_id = $2",
        [grantId, sessionId]
      );
      await pool.query(
        "DELETE FROM google_grants WHERE id = $1 AND session_id = $2",
        [grantId, sessionId]
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
function googleGrantSelect() {
  return `SELECT id, session_id, user_id, google_sub, email,
            access_iv, access_tag, access_ciphertext,
            refresh_iv, refresh_tag, refresh_ciphertext,
            access_expires_at, granted_scopes, refreshed_at, created_at, updated_at
     FROM google_grants`;
}
function googleGrantValues(grant) {
  return [
    grant.id,
    grant.sessionId,
    grant.userId,
    grant.googleSub,
    grant.email,
    grant.accessToken.iv,
    grant.accessToken.tag,
    grant.accessToken.ciphertext,
    grant.refreshToken.iv,
    grant.refreshToken.tag,
    grant.refreshToken.ciphertext,
    grant.accessTokenExpiresAt,
    grant.grantedScopes,
    grant.refreshedAt,
    grant.createdAt,
    grant.updatedAt
  ];
}
function mapGoogleGrant(row) {
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    sessionId: String(row.session_id),
    userId: typeof row.user_id === "string" ? row.user_id : null,
    googleSub: String(row.google_sub),
    email: String(row.email),
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
    grantedScopes: String(row.granted_scopes),
    refreshedAt: row.refreshed_at === null || row.refreshed_at === void 0 ? null : Number(row.refreshed_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}
function mapGoogleConnection(row) {
  const grant = mapGoogleGrant(row);
  if (!grant || !row || typeof row.product !== "string" || typeof row.connection_id !== "string") return null;
  return {
    ...grant,
    id: row.connection_id,
    grantId: String(row.grant_id),
    product: row.product,
    scopes: String(row.scopes),
    createdAt: Number(row.connection_created_at),
    updatedAt: Number(row.connection_updated_at)
  };
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
    WHERE user_id IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS google_grants (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    user_id TEXT,
    google_sub TEXT NOT NULL,
    email TEXT NOT NULL,
    access_iv TEXT NOT NULL,
    access_tag TEXT NOT NULL,
    access_ciphertext TEXT NOT NULL,
    refresh_iv TEXT NOT NULL,
    refresh_tag TEXT NOT NULL,
    refresh_ciphertext TEXT NOT NULL,
    access_expires_at BIGINT NOT NULL,
    granted_scopes TEXT NOT NULL,
    refreshed_at BIGINT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    UNIQUE (session_id, google_sub)
  )`,
      `CREATE TABLE IF NOT EXISTS google_connections (
    id TEXT PRIMARY KEY,
    grant_id TEXT NOT NULL REFERENCES google_grants(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    product TEXT NOT NULL,
    scopes TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    UNIQUE (session_id, product)
  )`
    ];
    REQUIRED_TABLES2 = [
      "oauth_states",
      "sessions",
      "zoho_connections",
      "google_grants",
      "google_connections"
    ];
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

// server/google-products.ts
var GOOGLE_IDENTITY_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email"
];
var CONFIRMABLE_REASON = "Shown after an administrator sets this id in GOOGLE_CONFIRMED_PRODUCTS. That value is the trusted confirmation that the named Google Cloud API is enabled. This app cannot see Cloud API enablement without administrator credentials, and it does not ask for those credentials.";
var GOOGLE_PRODUCTS = [
  {
    id: "gmail",
    name: "Gmail",
    description: "Search and read metadata for messages you authorize.",
    category: "email",
    initials: "GM",
    icon: "Mail",
    docsUrl: "https://developers.google.com/workspace/gmail/api/auth/scopes",
    service: "Gmail API",
    version: "v1",
    cloudApi: "gmail.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/gmail.metadata",
        classification: "restricted",
        purpose: "List messages and read headers such as Subject, From, and Date. Message bodies are not requested."
      }
    ],
    operation: "List recent messages and read their metadata.",
    availability: "confirmable",
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: "Gmail API has no separate billing charge for this read.",
    verification: "Restricted scope. Google verification and a security assessment are required before unverified users can grant it. This app has not completed that review. In testing mode only listed test users can consent."
  },
  {
    id: "calendar",
    name: "Google Calendar",
    description: "Read calendars and upcoming events you can access.",
    category: "calendar",
    initials: "GC",
    icon: "Calendar",
    docsUrl: "https://developers.google.com/workspace/calendar/api/auth",
    service: "Google Calendar API",
    version: "v3",
    cloudApi: "calendar-json.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/calendar.readonly",
        classification: "sensitive",
        purpose: "List calendars and upcoming events."
      }
    ],
    operation: "List calendars and upcoming events.",
    availability: "confirmable",
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: "Calendar API has no separate billing charge for this read.",
    verification: "Sensitive scope. Google verification is required for a public app. This review is not complete. Testing mode limits consent to test users."
  },
  {
    id: "drive",
    name: "Google Drive",
    description: "Search files and read their metadata.",
    category: "files",
    initials: "GD",
    icon: "Folder",
    docsUrl: "https://developers.google.com/workspace/drive/api/guides/api-specific-auth",
    service: "Google Drive API",
    version: "v3",
    cloudApi: "drive.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
        classification: "restricted",
        purpose: "List accessible files and read metadata. File contents are not downloaded."
      }
    ],
    operation: "List accessible file names and types.",
    availability: "confirmable",
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: "Drive API has no separate billing charge for this metadata read.",
    verification: "Restricted scope. Verification and a security assessment are required for public use and are not complete."
  },
  {
    id: "docs",
    name: "Google Docs",
    description: "Find a document and read its title.",
    category: "files",
    initials: "DO",
    icon: "FileText",
    docsUrl: "https://developers.google.com/docs/api/reference/rest/v1/documents/get",
    service: "Google Docs API",
    version: "v1",
    cloudApi: "docs.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/documents.readonly",
        classification: "sensitive",
        purpose: "Read a document the account can open."
      },
      {
        scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
        classification: "restricted",
        purpose: "Find a document. The Docs API does not list a user's files."
      }
    ],
    operation: "Find one document and read its title.",
    availability: "confirmable",
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: "Docs API has no separate billing charge for this read.",
    verification: "Includes a restricted Drive scope. Verification and a security assessment are not complete. Editing is not requested."
  },
  {
    id: "sheets",
    name: "Google Sheets",
    description: "Find a spreadsheet and read a small range.",
    category: "files",
    initials: "SH",
    icon: "FileText",
    docsUrl: "https://developers.google.com/sheets/api/guides/concepts",
    service: "Google Sheets API",
    version: "v4",
    cloudApi: "sheets.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
        classification: "sensitive",
        purpose: "Read values from a spreadsheet."
      },
      {
        scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
        classification: "restricted",
        purpose: "Find a spreadsheet. The Sheets API does not list a user's files."
      }
    ],
    operation: "Find one spreadsheet and read A1:E5.",
    availability: "confirmable",
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: "Sheets API has no separate billing charge for this read.",
    verification: "Includes a restricted Drive scope. Verification and a security assessment are not complete. Cell edits are not requested."
  },
  {
    id: "slides",
    name: "Google Slides",
    description: "Find a presentation and read its title.",
    category: "files",
    initials: "SL",
    icon: "FileText",
    docsUrl: "https://developers.google.com/slides/api/reference/rest/v1/presentations/get",
    service: "Google Slides API",
    version: "v1",
    cloudApi: "slides.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/presentations.readonly",
        classification: "sensitive",
        purpose: "Read presentation metadata."
      },
      {
        scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
        classification: "restricted",
        purpose: "Find a presentation. The Slides API does not list a user's files."
      }
    ],
    operation: "Find one presentation and read its title.",
    availability: "confirmable",
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: "Slides API has no separate billing charge for this read.",
    verification: "Includes a restricted Drive scope. Verification and a security assessment are not complete. Slide edits are not requested."
  },
  {
    id: "forms",
    name: "Google Forms",
    description: "Find a form and read its title and response count.",
    category: "files",
    initials: "FO",
    icon: "FileText",
    docsUrl: "https://developers.google.com/forms/api/reference/rest/v1/forms/get",
    service: "Google Forms API",
    version: "v1",
    cloudApi: "forms.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/forms.body.readonly",
        classification: "sensitive",
        purpose: "Read a form title."
      },
      {
        scope: "https://www.googleapis.com/auth/forms.responses.readonly",
        classification: "sensitive",
        purpose: "Read a short list of form responses."
      },
      {
        scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
        classification: "restricted",
        purpose: "Find a form. The Forms API does not list a user's forms."
      }
    ],
    operation: "Find one form and list up to five responses.",
    availability: "confirmable",
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: "Forms API has no separate billing charge for this read.",
    verification: "Includes a restricted Drive scope. Verification and a security assessment are not complete."
  },
  {
    id: "tasks",
    name: "Google Tasks",
    description: "Read task lists and tasks.",
    category: "project",
    initials: "GT",
    icon: "CheckSquare",
    docsUrl: "https://developers.google.com/tasks/reference/rest/v1/tasks/list",
    service: "Google Tasks API",
    version: "v1",
    cloudApi: "tasks.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/tasks.readonly",
        classification: "sensitive",
        purpose: "List task lists and tasks. Completion and edits are not requested."
      }
    ],
    operation: "List task lists and tasks.",
    availability: "confirmable",
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: "Tasks API has no separate billing charge for this read.",
    verification: "Reads personal task content. Treat it as sensitive on the consent screen. Public verification is not complete."
  },
  {
    id: "people",
    name: "Google Contacts",
    description: "Read names and email addresses from contacts you allow.",
    category: "crm",
    initials: "GP",
    icon: "Users",
    docsUrl: "https://developers.google.com/people/api/rest/v1/people.connections/list",
    service: "People API",
    version: "v1",
    cloudApi: "people.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/contacts.readonly",
        classification: "sensitive",
        purpose: "Read contact names and email addresses."
      }
    ],
    operation: "List contact names and email addresses.",
    availability: "confirmable",
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: "People API has no separate billing charge for this read.",
    verification: "Sensitive scope. Public verification is not complete. Contact creation is not requested."
  },
  {
    id: "chat",
    name: "Google Chat",
    description: "Read Chat spaces the app has joined.",
    category: "email",
    initials: "CH",
    icon: "MessageSquare",
    docsUrl: "https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces/list",
    service: "Google Chat API",
    version: "v1",
    cloudApi: "chat.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/chat.spaces.readonly",
        classification: "sensitive",
        purpose: "List spaces. This deployment has no Chat app installed in any space."
      }
    ],
    operation: "Not available. Chat only returns spaces that contain this app.",
    availability: "blocked",
    reason: "Google Chat requires a configured Chat app and membership in each space. This deployment has neither, so the connector stays hidden.",
    workspaceAdmin: true,
    billing: "No billing configuration is present.",
    verification: "Workspace app configuration is required. It is not set up."
  },
  {
    id: "meet",
    name: "Google Meet",
    description: "Read conference records for meetings you organized.",
    category: "calendar",
    initials: "MT",
    icon: "Calendar",
    docsUrl: "https://developers.google.com/workspace/meet/api/guides/overview",
    service: "Google Meet API",
    version: "v2",
    cloudApi: "meet.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/meetings.space.readonly",
        classification: "sensitive",
        purpose: "List conference records. Recordings, transcripts, and arbitrary meeting content are not requested."
      }
    ],
    operation: "List recent conference records.",
    availability: "confirmable",
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: "Meet API has no separate billing charge for listing conference records.",
    verification: "Sensitive scope. The API does not provide recordings or transcripts through this scope. Public verification is not complete."
  },
  {
    id: "admin",
    name: "Google Admin SDK",
    description: "Read directory users for a Workspace domain.",
    category: "hr",
    initials: "AD",
    icon: "Users",
    docsUrl: "https://developers.google.com/admin-sdk/directory/v1/guides",
    service: "Admin SDK Directory API",
    version: "directory_v1",
    cloudApi: "admin.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/admin.directory.user.readonly",
        classification: "sensitive",
        purpose: "List domain users. Consumer accounts cannot call this API."
      }
    ],
    operation: "Not available. Administrator access is not configured.",
    availability: "blocked",
    reason: "Directory reads require a Workspace administrator. Domain-wide delegation is not configured, and ordinary Google accounts cannot use this API.",
    workspaceAdmin: true,
    billing: "No billing configuration is present.",
    verification: "Administrator consent is required. It is not configured."
  },
  {
    id: "analytics",
    name: "Google Analytics",
    description: "List Analytics accounts and properties you can access.",
    category: "marketing",
    initials: "AN",
    icon: "BarChart3",
    docsUrl: "https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list",
    service: "Google Analytics Admin API",
    version: "v1beta",
    cloudApi: "analyticsadmin.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/analytics.readonly",
        classification: "sensitive",
        purpose: "List account summaries for properties the user can access."
      }
    ],
    operation: "List Analytics account summaries.",
    availability: "confirmable",
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: "Analytics Admin API has no separate billing charge for listing properties. A property the user can access is still required.",
    verification: "Sensitive scope. Public verification is not complete. An empty list means the account has no accessible property."
  },
  {
    id: "search-console",
    name: "Google Search Console",
    description: "List Search Console sites you can access.",
    category: "marketing",
    initials: "SC",
    icon: "BarChart3",
    docsUrl: "https://developers.google.com/webmaster-tools/v1/sites/list",
    service: "Search Console API",
    version: "v3",
    cloudApi: "searchconsole.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/webmasters.readonly",
        classification: "sensitive",
        purpose: "List sites. Performance queries are not requested."
      }
    ],
    operation: "List verified sites.",
    availability: "confirmable",
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: "Search Console API has no separate billing charge for listing sites.",
    verification: "Sensitive scope. Public verification is not complete."
  },
  {
    id: "apps-script",
    name: "Google Apps Script",
    description: "List Apps Script projects you own.",
    category: "project",
    initials: "AS",
    icon: "FileText",
    docsUrl: "https://developers.google.com/apps-script/api/reference/rest/v1/projects/list",
    service: "Apps Script API",
    version: "v1",
    cloudApi: "script.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/script.projects.readonly",
        classification: "sensitive",
        purpose: "List script projects. Script execution is not requested."
      }
    ],
    operation: "List Apps Script projects.",
    availability: "confirmable",
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: "Apps Script API has no separate billing charge for listing projects.",
    verification: "Sensitive scope. Execution would need a separate script authorization and is not implemented. Public verification is not complete."
  },
  {
    id: "workspace-events",
    name: "Google Workspace Events",
    description: "Subscribe to Workspace event notifications.",
    category: "project",
    initials: "WE",
    icon: "Calendar",
    docsUrl: "https://developers.google.com/workspace/events/guides/overview",
    service: "Google Workspace Events API",
    version: "v1",
    cloudApi: "workspaceevents.googleapis.com",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/workspace.events.subscriptions",
        classification: "sensitive",
        purpose: "Manage event subscriptions. A Pub/Sub topic and renewal job are required and are not configured."
      }
    ],
    operation: "Not available. Subscription infrastructure is not configured.",
    availability: "blocked",
    reason: "Workspace Events needs a Cloud Pub/Sub topic, a subscription, and renewal handling. None of that is configured, so the connector stays hidden.",
    workspaceAdmin: true,
    billing: "Pub/Sub billing is not configured.",
    verification: "Workspace and Cloud prerequisites are not met."
  }
];
function googleProductById(id) {
  return GOOGLE_PRODUCTS.find((product) => product.id === id) ?? null;
}
function requestedScopes(product) {
  return [...product.scopes.map((item) => item.scope), ...GOOGLE_IDENTITY_SCOPES];
}
function visibleGoogleProducts(confirmed) {
  const allowed = new Set(confirmed);
  return GOOGLE_PRODUCTS.filter((product) => product.availability === "confirmable" && allowed.has(product.id));
}

// server/google-config.ts
var LOCAL_GOOGLE_REDIRECT_URI = "http://localhost:5173/api/integrations/google/callback";
var PRODUCTION_GOOGLE_REDIRECT_URI = "https://em.multiplierclub.in/api/integrations/google/callback";
var PRODUCT_ID = /^[a-z0-9-]{1,40}$/;
function loadGoogleConfig(env, production) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim() ?? "";
  if (!clientId && !clientSecret && !redirectUri) {
    return {
      status: "absent",
      message: "GOOGLE_CLIENT_ID is missing. Set the Google OAuth client in the server environment."
    };
  }
  if (!clientId) {
    return { status: "invalid", message: "GOOGLE_CLIENT_ID is missing. Set it in the server environment." };
  }
  if (!clientSecret) {
    return { status: "invalid", message: "GOOGLE_CLIENT_SECRET is missing. Set it in the server environment." };
  }
  if (!redirectUri) {
    return { status: "invalid", message: "GOOGLE_REDIRECT_URI is missing. Set it in the server environment." };
  }
  const expected = production ? PRODUCTION_GOOGLE_REDIRECT_URI : LOCAL_GOOGLE_REDIRECT_URI;
  let url;
  try {
    url = new URL(redirectUri);
  } catch {
    return {
      status: "invalid",
      message: `GOOGLE_REDIRECT_URI must be ${expected}. The server will not substitute a different callback URL.`
    };
  }
  if (url.username || url.password || url.search || url.hash || redirectUri !== expected) {
    return {
      status: "invalid",
      message: `GOOGLE_REDIRECT_URI must be ${expected}. The server will not substitute a different callback URL.`
    };
  }
  return {
    status: "ready",
    settings: {
      clientId,
      clientSecret,
      redirectUri,
      confirmedProducts: confirmedProducts(env.GOOGLE_CONFIRMED_PRODUCTS)
    }
  };
}
function confirmedProducts(value) {
  if (!value) return [];
  const known = new Set(
    GOOGLE_PRODUCTS.filter((product) => product.availability === "confirmable").map((product) => product.id)
  );
  const selected = [];
  for (const part of value.split(",")) {
    const id = part.trim();
    if (!PRODUCT_ID.test(id) || !known.has(id) || selected.includes(id)) continue;
    selected.push(id);
  }
  return selected;
}

// server/app.ts
import { randomUUID as randomUUID3 } from "node:crypto";

// server/google-app.ts
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

// server/google-api.ts
var GoogleApiError = class extends Error {
  code;
  constructor(code) {
    super(code);
    this.code = code;
  }
};
var PAGE_TOKEN = /^[^&#?\s]{1,1024}$/;
var RESOURCE_ID = /^[A-Za-z0-9_.:@-]{1,200}$/;
async function previewGoogleProduct(product, accessToken, fetchImpl, now) {
  switch (product.id) {
    case "gmail":
      return previewGmail(accessToken, fetchImpl);
    case "calendar":
      return previewCalendar(accessToken, fetchImpl, now);
    case "drive":
      return previewDrive(accessToken, fetchImpl);
    case "docs":
      return previewWorkspaceFile(
        accessToken,
        fetchImpl,
        "application/vnd.google-apps.document",
        "Documents",
        (id) => readDocument(accessToken, fetchImpl, id)
      );
    case "sheets":
      return previewWorkspaceFile(
        accessToken,
        fetchImpl,
        "application/vnd.google-apps.spreadsheet",
        "Spreadsheets",
        (id) => readSheet(accessToken, fetchImpl, id)
      );
    case "slides":
      return previewWorkspaceFile(
        accessToken,
        fetchImpl,
        "application/vnd.google-apps.presentation",
        "Presentations",
        (id) => readSlides(accessToken, fetchImpl, id)
      );
    case "forms":
      return previewWorkspaceFile(
        accessToken,
        fetchImpl,
        "application/vnd.google-apps.form",
        "Forms",
        (id) => readForm(accessToken, fetchImpl, id)
      );
    case "tasks":
      return previewTasks(accessToken, fetchImpl);
    case "people":
      return previewPeople(accessToken, fetchImpl);
    case "meet":
      return previewMeet(accessToken, fetchImpl);
    case "analytics":
      return previewAnalytics(accessToken, fetchImpl);
    case "search-console":
      return previewSearchConsole(accessToken, fetchImpl);
    case "apps-script":
      return previewScripts(accessToken, fetchImpl);
    case "chat":
    case "admin":
    case "workspace-events":
      throw new GoogleApiError("provider_error");
    default: {
      const unknown = product.id;
      return unknown;
    }
  }
}
async function previewGmail(token, fetchImpl) {
  const listed = await googleGet(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5",
    token,
    fetchImpl
  );
  const ids = arrayOf(record(listed)?.messages).flatMap((item) => {
    const id = text(record(item)?.id);
    return id && RESOURCE_ID.test(id) ? [id] : [];
  });
  const records = [];
  for (const id of ids) {
    const message = await googleGet(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      token,
      fetchImpl
    );
    const headers = arrayOf(record(record(message)?.payload)?.headers);
    records.push({
      id,
      title: headerValue(headers, "Subject") || "Message",
      detail: [headerValue(headers, "From"), headerValue(headers, "Date")].filter(Boolean).join(" \xB7 ")
    });
  }
  return [{ title: "Messages", records }];
}
async function previewCalendar(token, fetchImpl, now) {
  const calendars = await googleGet(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=5",
    token,
    fetchImpl
  );
  const items = arrayOf(record(calendars)?.items);
  const records = [];
  const first = record(items[0]);
  const calendarId = text(first?.id);
  for (const item of items) {
    const row = record(item);
    const id = text(row?.id);
    if (!id) continue;
    records.push({ id, title: text(row?.summary) || "Calendar", detail: text(row?.accessRole) || "" });
  }
  const sections = [{ title: "Calendars", records }];
  if (calendarId && RESOURCE_ID.test(calendarId)) {
    const start = new Date(now).toISOString();
    const events = await googleGet(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=5&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(start)}`,
      token,
      fetchImpl
    );
    sections.push({
      title: "Upcoming events",
      records: arrayOf(record(events)?.items).flatMap((item) => {
        const row = record(item);
        const id = text(row?.id);
        if (!id) return [];
        const startValue = text(record(row?.start)?.dateTime) || text(record(row?.start)?.date);
        return [{ id, title: text(row?.summary) || "Event", detail: startValue || "" }];
      })
    });
  }
  return sections;
}
async function previewDrive(token, fetchImpl) {
  const files = await listFiles(token, fetchImpl, "trashed=false");
  return [{ title: "Files", records: files }];
}
async function previewWorkspaceFile(token, fetchImpl, mimeType, title, read) {
  const files = await listFiles(token, fetchImpl, `mimeType='${mimeType}' and trashed=false`);
  const first = files[0];
  if (!first || !RESOURCE_ID.test(first.id)) return [{ title, records: files }];
  const detailed = await read(first.id);
  return [{ title, records: detailed ? [detailed, ...files.filter((file) => file.id !== first.id)] : files }];
}
async function readDocument(token, fetchImpl, id) {
  const body = await googleGet(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}?fields=documentId,title`,
    token,
    fetchImpl
  );
  const row = record(body);
  const documentId = text(row?.documentId);
  if (!documentId) return null;
  return { id: documentId, title: text(row?.title) || "Document", detail: "Document" };
}
async function readSheet(token, fetchImpl, id) {
  const body = await googleGet(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/A1:E5`,
    token,
    fetchImpl
  );
  const values = arrayOf(record(body)?.values);
  const firstRow = arrayOf(values[0]).map((cell) => typeof cell === "string" ? cell : "").filter(Boolean);
  return { id, title: firstRow[0] || "Spreadsheet", detail: `${values.length} row${values.length === 1 ? "" : "s"} read` };
}
async function readSlides(token, fetchImpl, id) {
  const body = await googleGet(
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(id)}?fields=presentationId,title`,
    token,
    fetchImpl
  );
  const row = record(body);
  return { id: text(row?.presentationId) || id, title: text(row?.title) || "Presentation", detail: "Presentation" };
}
async function readForm(token, fetchImpl, id) {
  const form = await googleGet(`https://forms.googleapis.com/v1/forms/${encodeURIComponent(id)}`, token, fetchImpl);
  const responses = await googleGet(
    `https://forms.googleapis.com/v1/forms/${encodeURIComponent(id)}/responses?pageSize=5`,
    token,
    fetchImpl
  );
  const title = text(record(record(form)?.info)?.title) || "Form";
  const count = arrayOf(record(responses)?.responses).length;
  return { id, title, detail: `${count} response${count === 1 ? "" : "s"}` };
}
async function previewTasks(token, fetchImpl) {
  const lists = await googleGet("https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=5", token, fetchImpl);
  const items = arrayOf(record(lists)?.items);
  const records = items.flatMap((item) => {
    const row = record(item);
    const id = text(row?.id);
    return id ? [{ id, title: text(row?.title) || "Task list", detail: "Task list" }] : [];
  });
  const first = text(record(items[0])?.id);
  const sections = [{ title: "Task lists", records }];
  if (first && RESOURCE_ID.test(first)) {
    const tasks = await googleGet(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(first)}/tasks?maxResults=5&showCompleted=false`,
      token,
      fetchImpl
    );
    sections.push({
      title: "Tasks",
      records: arrayOf(record(tasks)?.items).flatMap((item) => {
        const row = record(item);
        const id = text(row?.id);
        return id ? [{ id, title: text(row?.title) || "Task", detail: text(row?.status) || "" }] : [];
      })
    });
  }
  return sections;
}
async function previewPeople(token, fetchImpl) {
  const body = await googleGet(
    "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=5",
    token,
    fetchImpl
  );
  return [{
    title: "Contacts",
    records: arrayOf(record(body)?.connections).flatMap((item) => {
      const row = record(item);
      const id = text(row?.resourceName);
      if (!id) return [];
      const name = text(record(arrayOf(row?.names)[0])?.displayName) || "Contact";
      const email = text(record(arrayOf(row?.emailAddresses)[0])?.value);
      return [{ id, title: name, detail: email || "" }];
    })
  }];
}
async function previewMeet(token, fetchImpl) {
  const body = await googleGet("https://meet.googleapis.com/v2/conferenceRecords?pageSize=5", token, fetchImpl);
  return [{
    title: "Conference records",
    records: arrayOf(record(body)?.conferenceRecords).flatMap((item) => {
      const row = record(item);
      const name = text(row?.name);
      if (!name) return [];
      return [{ id: name, title: name, detail: text(row?.startTime) || "" }];
    })
  }];
}
async function previewAnalytics(token, fetchImpl) {
  const body = await googleGet("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=5", token, fetchImpl);
  return [{
    title: "Analytics accounts",
    records: arrayOf(record(body)?.accountSummaries).flatMap((item) => {
      const row = record(item);
      const name = text(row?.name);
      if (!name) return [];
      return [{ id: name, title: text(row?.displayName) || "Analytics account", detail: name }];
    })
  }];
}
async function previewSearchConsole(token, fetchImpl) {
  const body = await googleGet("https://www.googleapis.com/webmasters/v3/sites", token, fetchImpl);
  return [{
    title: "Sites",
    records: arrayOf(record(body)?.siteEntry).flatMap((item) => {
      const row = record(item);
      const site = text(row?.siteUrl);
      if (!site) return [];
      return [{ id: site, title: site, detail: text(row?.permissionLevel) || "" }];
    })
  }];
}
async function previewScripts(token, fetchImpl) {
  const body = await googleGet("https://script.googleapis.com/v1/projects?pageSize=5", token, fetchImpl);
  return [{
    title: "Script projects",
    records: arrayOf(record(body)?.projects).flatMap((item) => {
      const row = record(item);
      const id = text(row?.scriptId);
      if (!id) return [];
      return [{ id, title: text(row?.title) || "Script", detail: text(row?.updateTime) || "" }];
    })
  }];
}
async function listFiles(token, fetchImpl, query) {
  const collected = [];
  let pageToken = "";
  for (let page = 0; page < 2 && collected.length < 5; page += 1) {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("pageSize", "5");
    url.searchParams.set("fields", "files(id,name,mimeType),nextPageToken");
    url.searchParams.set("q", query);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = await googleGet(url.toString(), token, fetchImpl);
    for (const item of arrayOf(record(body)?.files)) {
      const row = record(item);
      const id = text(row?.id);
      if (!id || collected.length >= 5) continue;
      collected.push({ id, title: text(row?.name) || "File", detail: text(row?.mimeType) || "" });
    }
    const next = text(record(body)?.nextPageToken);
    if (!next || !PAGE_TOKEN.test(next)) break;
    pageToken = next;
  }
  return collected;
}
async function googleGet(url, token, fetchImpl) {
  let attempt = 0;
  while (attempt < 2) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15e3);
    try {
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: controller.signal
      });
      if ((response.status === 429 || response.status === 503) && attempt === 0) {
        attempt += 1;
        await delay(200);
        continue;
      }
      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      throw mappedError(response.status, body);
    } catch (error) {
      if (error instanceof GoogleApiError) throw error;
      if (attempt === 0) {
        attempt += 1;
        continue;
      }
      throw new GoogleApiError("provider_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
  throw new GoogleApiError("provider_unavailable");
}
function mappedError(status, body) {
  const reason = text(record(record(body)?.error)?.status) || text(record(arrayOf(record(record(body)?.error)?.errors)[0])?.reason) || "";
  if (status === 401 || reason === "authError" || reason === "invalid_grant") {
    return new GoogleApiError("reconnect_required");
  }
  if (status === 403 || reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" || reason === "insufficientPermissions") {
    return new GoogleApiError("missing_scope");
  }
  if (status === 429) return new GoogleApiError("rate_limited");
  if (status === 503) return new GoogleApiError("provider_unavailable");
  return new GoogleApiError("provider_error");
}
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
function record(value) {
  return value && typeof value === "object" ? value : null;
}
function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}
function text(value) {
  return typeof value === "string" ? value : "";
}
function headerValue(headers, name) {
  const match = headers.find((header) => text(record(header)?.name).toLowerCase() === name.toLowerCase());
  return text(record(match)?.value);
}

// server/google-oauth.ts
import { OAuth2Client } from "google-auth-library";
function createGoogleOAuth(settings) {
  const client = new OAuth2Client({
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    redirectUri: settings.redirectUri
  });
  return {
    authorizationUrl(input) {
      return client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: true,
        scope: [...input.scopes],
        state: input.state,
        redirect_uri: settings.redirectUri
      });
    },
    async exchange(code) {
      const response = await client.getToken({ code, redirect_uri: settings.redirectUri });
      return tokenSet(response.tokens);
    },
    async refresh(refreshToken) {
      client.setCredentials({ refresh_token: refreshToken });
      const response = await client.refreshAccessToken();
      const next = tokenSet(response.credentials);
      return { ...next, refreshToken: next.refreshToken ?? refreshToken };
    },
    async revoke(token) {
      await client.revokeToken(token);
    },
    async identity(idToken) {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: settings.clientId
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) return null;
      return {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true
      };
    }
  };
}
function tokenSet(tokens) {
  if (!tokens.access_token) {
    throw new Error("token_exchange_failed");
  }
  const expiry = typeof tokens.expiry_date === "number" ? tokens.expiry_date : Date.now() + 36e5;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresIn: Math.max(1, Math.floor((expiry - Date.now()) / 1e3)),
    scope: tokens.scope ?? "",
    idToken: tokens.id_token ?? null
  };
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

// server/google-app.ts
var STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
var CODE_PATTERN = /^[A-Za-z0-9._~/-]{1,1024}$/;
var SUB_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
var ACCESS_REFRESH_SKEW_MS = 6e4;
var MESSAGES = {
  configuration: "Google sign-in is not configured.",
  unavailable: "This Google product is not available to connect.",
  not_connected: "This Google product is not connected.",
  rate_limited: "Google rate limit reached. Try again shortly.",
  missing_scope: "Google did not grant the requested access. Reconnect and allow that permission.",
  reconnect_required: "The Google connection expired. Reconnect this product.",
  provider_unavailable: "Google could not be reached. No data was changed.",
  provider_error: "Google could not complete the request.",
  server_error: "The request could not be completed.",
  persistence_unavailable: "Production token storage is not configured. Set DATABASE_URL before connecting Google.",
  forbidden: "The request was rejected."
};
async function handleGoogleRequest(req, res, deps) {
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  const method = req.method ?? "GET";
  const googleConfig = configOf(deps);
  if (path === "/api/integrations/google/callback" && method === "GET") {
    await callback(req, res, deps, googleConfig);
    return;
  }
  if (path === "/api/integrations/google" && method === "GET") {
    await sendCatalog(req, res, deps, googleConfig);
    return;
  }
  const route = path.match(/^\/api\/integrations\/google\/([a-z0-9-]+)\/(connect|disconnect|preview)$/);
  if (!route) {
    sendJson(res, 404, "server_error");
    return;
  }
  const productId = route[1] ?? "";
  const action = route[2];
  if (action === "connect" && method === "GET") {
    await startConnect(req, res, deps, googleConfig, productId);
    return;
  }
  if (action === "disconnect" && method === "POST") {
    await disconnect(req, res, deps, googleConfig, productId);
    return;
  }
  if (action === "preview" && method === "GET") {
    await preview(req, res, deps, productId);
    return;
  }
  sendJson(res, 405, "server_error");
}
async function sendCatalog(req, res, deps, googleConfig) {
  const active = await resolveSession(req, deps);
  const connections = active ? await deps.store.listGoogleConnections(active.session.id) : [];
  const visible = googleConfig.status === "ready" ? visibleGoogleProducts(googleConfig.settings.confirmedProducts) : [];
  const visibleIds = new Set(visible.map((product) => product.id));
  const products = visible.map((product) => publicProduct(product, connections, true));
  const retained = connections.filter((connection) => !visibleIds.has(connection.product)).flatMap((connection) => {
    const product = googleProductById(connection.product);
    if (!product) return [];
    return [publicProduct(product, connections, false)];
  });
  sendJson(res, 200, { products: [...products, ...retained] });
}
async function startConnect(req, res, deps, googleConfig, productId) {
  if (!persistenceReady(deps)) {
    sendJson(res, 503, "persistence_unavailable");
    return;
  }
  if (googleConfig.status !== "ready") {
    sendJson(res, 503, "configuration", googleConfig.message);
    return;
  }
  const product = googleProductById(productId);
  const visible = visibleGoogleProducts(googleConfig.settings.confirmedProducts);
  if (!product || !visible.some((item) => item.id === product.id)) {
    sendJson(res, 409, "unavailable");
    return;
  }
  if (limited(req, deps, `google-connect:${product.id}`, 20, 10 * 6e4)) {
    sendJson(res, 429, "rate_limited");
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
    scopes: requestedScopes(product)
  });
  redirect(res, location, cookie);
}
async function callback(req, res, deps, googleConfig) {
  const params = new URL(req.url ?? "/", "http://localhost").searchParams;
  const errorParam = bounded(params.get("error"), 64);
  const state = bounded(params.get("state"), 128);
  const active = await resolveSession(req, deps);
  if (errorParam) {
    await consumeIfValid(deps, state, active?.session.id ?? null);
    redirect(res, errorLocation(errorParam === "access_denied" ? "access_denied" : "provider_error"));
    return;
  }
  if (!active || !state || !STATE_PATTERN.test(state)) {
    redirect(res, errorLocation("invalid_state"));
    return;
  }
  const code = bounded(params.get("code"), 1024);
  if (!code || !CODE_PATTERN.test(code)) {
    await consumeIfValid(deps, state, active.session.id);
    redirect(res, errorLocation("missing_code"));
    return;
  }
  if (googleConfig.status !== "ready") {
    await consumeIfValid(deps, state, active.session.id);
    redirect(res, errorLocation("provider_error"));
    return;
  }
  const productKey = await deps.store.consumeOauthState(state, active.session.id, clock(deps));
  const productId = productKey?.startsWith("google:") ? productKey.slice("google:".length) : "";
  const product = googleProductById(productId);
  const visible = visibleGoogleProducts(googleConfig.settings.confirmedProducts);
  if (!product || !visible.some((item) => item.id === product.id)) {
    redirect(res, errorLocation("invalid_state"));
    return;
  }
  try {
    const oauth = oauthFor(deps, googleConfig.settings);
    const tokens = await oauth.exchange(code);
    if (!tokens.refreshToken || !tokens.idToken) {
      redirect(res, errorLocation("missing_refresh_token"));
      return;
    }
    const identity = await oauth.identity(tokens.idToken);
    if (!identity || !identity.emailVerified || !SUB_PATTERN.test(identity.sub) || !validEmail(identity.email)) {
      redirect(res, errorLocation("invalid_account"));
      return;
    }
    if (!scopesGranted(tokens.scope, requestedScopes(product))) {
      redirect(res, errorLocation("missing_scope"));
      return;
    }
    const now = clock(deps);
    const next = newSession(now);
    next.userId = active.session.userId;
    const rotated = await deps.store.rotateSession(active.session.id, now, next);
    if (!rotated) {
      redirect(res, errorLocation("provider_error"));
      return;
    }
    await storeGrant(deps, rotated, identity, tokens, product, now);
    redirect(
      res,
      `/?${new URLSearchParams({ google: "connected", product: product.id }).toString()}`,
      cookieFor(rotated, deps, now)
    );
  } catch (error) {
    logger(deps, error instanceof Error && error.message === "token_exchange_failed" ? "token_exchange_failed" : "provider_error");
    redirect(res, errorLocation("token_exchange_failed"));
  }
}
async function preview(req, res, deps, productId) {
  const product = googleProductById(productId);
  if (!product) {
    sendJson(res, 404, "server_error");
    return;
  }
  const active = await resolveSession(req, deps);
  if (!active) {
    sendJson(res, 200, { connected: false, sections: [] });
    return;
  }
  const connection = (await deps.store.listGoogleConnections(active.session.id)).find((item) => item.product === product.id);
  if (!connection) {
    sendJson(res, 409, "not_connected");
    return;
  }
  if (!scopesGranted(connection.grantedScopes, product.scopes.map((item) => item.scope))) {
    sendJson(res, 403, "missing_scope");
    return;
  }
  try {
    const accessToken = await freshAccessToken(deps, connection);
    const sections = await previewGoogleProduct(product, accessToken, deps.fetchImpl ?? fetch, clock(deps));
    sendJson(res, 200, { connected: true, sections });
  } catch (error) {
    const code = error instanceof GoogleApiError ? error.code : "provider_error";
    if (code === "reconnect_required") {
      await deps.store.deleteGoogleGrant(connection.sessionId, connection.grantId);
    }
    sendJson(res, code === "rate_limited" ? 429 : code === "missing_scope" ? 403 : 502, code);
  }
}
async function disconnect(req, res, deps, googleConfig, productId) {
  if (req.headers["x-em-request"] !== "1") {
    sendJson(res, 403, "forbidden");
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
    if (refreshToken && googleConfig.status === "ready") {
      try {
        await oauthFor(deps, googleConfig.settings).revoke(refreshToken);
        grantRevoked = true;
      } catch {
        logger(deps, "revoke_failed");
      }
    }
    await deps.store.deleteGoogleGrant(active.session.id, connection.grantId);
  }
  sendJson(res, 200, { disconnected: true, grantRevoked });
}
async function storeGrant(deps, session, identity, tokens, product, now) {
  const previous = (await deps.store.listGoogleConnections(session.id)).find((item) => item.product === product.id);
  const existing = await deps.store.getGoogleGrant(session.id, identity.sub);
  const grantId = existing?.id ?? randomUUID2();
  const grant = {
    id: grantId,
    sessionId: session.id,
    userId: session.userId,
    googleSub: identity.sub,
    email: identity.email,
    accessToken: encryptString(tokens.accessToken, deps.config.tokenEncryptionKey, grantId),
    refreshToken: encryptString(tokens.refreshToken ?? "", deps.config.tokenEncryptionKey, grantId),
    accessTokenExpiresAt: now + tokens.expiresIn * 1e3,
    grantedScopes: tokens.scope,
    refreshedAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  if (existing) await deps.store.updateGoogleGrant(grant);
  else await deps.store.insertGoogleGrant(grant);
  await deps.store.upsertGoogleConnection({
    id: randomUUID2(),
    grantId,
    sessionId: session.id,
    product: product.id,
    scopes: product.scopes.map((item) => item.scope).join(" "),
    createdAt: now,
    updatedAt: now
  });
  if (!previous || previous.grantId === grantId) return;
  const stillUsed = (await deps.store.listGoogleConnections(session.id)).some((item) => item.grantId === previous.grantId);
  if (stillUsed) return;
  const refreshToken = decrypt(previous.refreshToken, deps, previous.grantId);
  const settings = readySettings(deps);
  if (refreshToken && settings) {
    try {
      await oauthFor(deps, settings).revoke(refreshToken);
    } catch {
      logger(deps, "revoke_failed");
    }
  }
  await deps.store.deleteGoogleGrant(session.id, previous.grantId);
}
async function freshAccessToken(deps, connection) {
  const current = decrypt(connection.accessToken, deps, connection.grantId);
  if (current && connection.accessTokenExpiresAt > clock(deps) + ACCESS_REFRESH_SKEW_MS) return current;
  const refreshToken = decrypt(connection.refreshToken, deps, connection.grantId);
  if (!refreshToken) throw new GoogleApiError("reconnect_required");
  const settings = readySettings(deps);
  if (!settings) throw new GoogleApiError("reconnect_required");
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
      accessTokenExpiresAt: now + next.expiresIn * 1e3,
      grantedScopes: next.scope || connection.grantedScopes,
      refreshedAt: now,
      createdAt: connection.createdAt,
      updatedAt: now
    });
    return next.accessToken;
  } catch {
    throw new GoogleApiError("reconnect_required");
  }
}
function configOf(deps) {
  return deps.googleConfig ?? {
    status: "absent",
    message: "GOOGLE_CLIENT_ID is missing. Set the Google OAuth client in the server environment."
  };
}
function readySettings(deps) {
  const googleConfig = configOf(deps);
  return googleConfig.status === "ready" ? googleConfig.settings : null;
}
function oauthFor(deps, settings) {
  return deps.googleOAuth ?? createGoogleOAuth(settings);
}
function publicProduct(product, connections, connectable) {
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
    scopes: product.scopes.map((item) => item.scope)
  };
}
function scopesGranted(granted, required2) {
  const have = new Set(granted.split(/\s+/).filter(Boolean));
  return required2.every((scope) => have.has(scope));
}
function validEmail(email) {
  return email.length <= 320 && EMAIL_PATTERN.test(email);
}
async function consumeIfValid(deps, state, sessionId) {
  if (!state || !sessionId || !STATE_PATTERN.test(state)) return;
  await deps.store.consumeOauthState(state, sessionId, clock(deps));
}
async function resolveSession(req, deps) {
  const now = clock(deps);
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  const payload = verifySessionToken(token, deps.config.sessionSecret, now);
  if (!payload) return null;
  const session = await deps.store.getSession(payload.sid);
  if (!session || session.expiresAt <= now || session.id !== payload.sid) return null;
  return { session, cookie: null };
}
function newSession(now) {
  return {
    id: createSessionId(),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    userId: null
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
function persistenceReady(deps) {
  if (process.env.VERCEL === "1" && !deps.config.databaseUrl) return false;
  return true;
}
function decrypt(secret, deps, aad) {
  try {
    const value = decryptString(secret, deps.config.tokenEncryptionKey, aad);
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
function clock(deps) {
  return deps.now ? deps.now() : Date.now();
}
function logger(deps, event) {
  deps.logger?.(event);
}
var buckets = /* @__PURE__ */ new Map();
function limited(req, deps, name, max, windowMs) {
  const now = clock(deps);
  const key = `${name}:${req.socket?.remoteAddress ?? "local"}`;
  const recent = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  recent.push(now);
  buckets.set(key, recent);
  return recent.length > max;
}
function bounded(value, max) {
  if (!value || value.length > max) return null;
  return value;
}
function errorLocation(reason) {
  return `/?${new URLSearchParams({ google: "error", reason }).toString()}`;
}
function redirect(res, location, cookie) {
  res.statusCode = 302;
  if (cookie) res.setHeader("Set-Cookie", cookie);
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}
function sendJson(res, status, codeOrBody, message) {
  const body = typeof codeOrBody === "string" ? { error: codeOrBody, message: message ?? MESSAGES[codeOrBody] } : codeOrBody;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
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
var PROJECTS_ORIGINS = {
  "https://www.zohoapis.com": "https://projectsapi.zoho.com",
  "https://www.zohoapis.eu": "https://projectsapi.zoho.eu",
  "https://www.zohoapis.in": "https://projectsapi.zoho.in",
  "https://www.zohoapis.com.au": "https://projectsapi.zoho.com.au",
  "https://www.zohoapis.jp": "https://projectsapi.zoho.jp",
  "https://www.zohoapis.sa": "https://projectsapi.zoho.sa",
  "https://www.zohoapis.ca": "https://projectsapi.zohocloud.ca"
};
var CALENDAR_ORIGINS = {
  "https://www.zohoapis.com": "https://calendar.zoho.com",
  "https://www.zohoapis.eu": "https://calendar.zoho.eu",
  "https://www.zohoapis.in": "https://calendar.zoho.in",
  "https://www.zohoapis.com.au": "https://calendar.zoho.com.au",
  "https://www.zohoapis.jp": "https://calendar.zoho.jp",
  "https://www.zohoapis.sa": "https://calendar.zoho.sa",
  "https://www.zohoapis.ca": "https://calendar.zohocloud.ca"
};
var SIGN_ORIGINS = {
  "https://www.zohoapis.com": "https://sign.zoho.com",
  "https://www.zohoapis.eu": "https://sign.zoho.eu",
  "https://www.zohoapis.in": "https://sign.zoho.in",
  "https://www.zohoapis.com.au": "https://sign.zoho.com.au",
  "https://www.zohoapis.jp": "https://sign.zoho.jp",
  "https://www.zohoapis.sa": "https://sign.zoho.sa",
  "https://www.zohoapis.ca": "https://sign.zohocloud.ca"
};
var SERVICE_ORIGINS = {
  desk: DESK_ORIGINS,
  people: PEOPLE_ORIGINS,
  projects: PROJECTS_ORIGINS,
  calendar: CALENDAR_ORIGINS,
  sign: SIGN_ORIGINS
};
function serviceOrigin(apiOrigin, service) {
  const origin = assertApiOrigin(apiOrigin);
  const mapped = SERVICE_ORIGINS[service][origin];
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
  url.searchParams.set("prompt", "consent");
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
  const data = record2(payload)?.data;
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
  const fields = record2(payload);
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
  const text3 = await response.text();
  if (!text3) return null;
  try {
    return JSON.parse(text3);
  } catch {
    return null;
  }
}
function record2(value) {
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
  return safeCode(stringField(record2(value), "error"));
}
function crmCode(value) {
  return safeCode(stringField(record2(value), "code"));
}
function safeCode(value) {
  if (!value || !/^[A-Za-z0-9_.-]{1,64}$/.test(value)) return null;
  return value;
}
function toLead(value) {
  const fields = record2(value);
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
    case "projects":
      return projectsPreview(input, fetchImpl);
    case "calendar":
      return calendarPreview(input, fetchImpl);
    case "sign":
      return signPreview(input, fetchImpl);
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
    case "projects": {
      const origin = serviceOrigin(input.apiOrigin, "projects");
      return readOrganizations(
        await zohoGet(new URL("/restapi/portals/", origin), input.accessToken, fetchImpl),
        "portals",
        "id",
        "name"
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
async function projectsPreview(input, fetchImpl) {
  const organizations = await listOrganizations("projects", input, fetchImpl);
  if (!input.organizationId) return { sections: [], organizations };
  const origin = serviceOrigin(input.apiOrigin, "projects");
  const portalId = pathId(input.organizationId);
  if (!portalId) return { sections: [], organizations };
  const projectsUrl = new URL(`/restapi/portal/${portalId}/projects/`, origin);
  projectsUrl.searchParams.set("index", "0");
  projectsUrl.searchParams.set("range", String(PAGE_SIZE));
  const projects = await zohoGet(projectsUrl, input.accessToken, fetchImpl);
  const projectRecords = mapRows(projects, "projects", "id", "name", "status");
  const firstProject = projectRecords[0];
  const sections = [{ title: "Projects", records: projectRecords }];
  if (firstProject) {
    const projectId = pathId(firstProject.id);
    if (projectId) {
      const tasksUrl = new URL(`/restapi/portal/${portalId}/projects/${projectId}/tasks/`, origin);
      tasksUrl.searchParams.set("index", "0");
      tasksUrl.searchParams.set("range", String(PAGE_SIZE));
      const tasks = await zohoGet(tasksUrl, input.accessToken, fetchImpl);
      sections.push({
        title: "Tasks",
        records: mapRows(tasks, "tasks", "id", "name", "status")
      });
    }
  }
  return { organizations, sections };
}
async function calendarPreview(input, fetchImpl) {
  const origin = serviceOrigin(input.apiOrigin, "calendar");
  const calendarsUrl = new URL("/api/v1/calendars", origin);
  calendarsUrl.searchParams.set("category", "own");
  const calendars = await zohoGet(calendarsUrl, input.accessToken, fetchImpl);
  const listed = arrayField(calendars, "calendars").map((item) => asRecord(item)).filter((item) => item !== null);
  const chosen = listed.find((calendar) => calendar.isdefault === true) ?? listed[0] ?? null;
  const uid = pathId(text2(chosen, "uid") ?? "");
  const sections = [];
  if (uid) {
    const start = /* @__PURE__ */ new Date();
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1e3);
    const eventsUrl = new URL(`/api/v1/calendars/${encodeURIComponent(uid)}/events`, origin);
    eventsUrl.searchParams.set("range", JSON.stringify({ start: ymd(start), end: ymd(end) }));
    const events = await zohoGet(eventsUrl, input.accessToken, fetchImpl);
    sections.push({
      title: "Events",
      records: mapRows(events, "events", "uid", "title", "dateandtime")
    });
  }
  return { organizations: [], sections };
}
async function signPreview(input, fetchImpl) {
  const origin = serviceOrigin(input.apiOrigin, "sign");
  const url = new URL("/api/v1/requests", origin);
  url.searchParams.set(
    "data",
    JSON.stringify({
      page_context: {
        row_count: PAGE_SIZE,
        start_index: 1,
        sort_column: "created_time",
        sort_order: "DESC"
      }
    })
  );
  const payload = await zohoGet(url, input.accessToken, fetchImpl);
  return {
    organizations: [],
    sections: [{ title: "Signature requests", records: mapRows(payload, "requests", "request_id", "request_name", "request_status") }]
  };
}
function ymd(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}
function pathId(value) {
  return /^[A-Za-z0-9_.:@-]{1,200}$/.test(value) ? value : null;
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
  const text3 = await response.text();
  let payload = null;
  if (text3) {
    try {
      payload = JSON.parse(text3);
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
    const record3 = asRecord(item);
    const id = text2(record3, idKey);
    if (!id) continue;
    organizations.push({ id, name: text2(record3, nameKey) ?? id });
    if (organizations.length === 20) break;
  }
  return organizations;
}
function mapRows(payload, listKey, idKey, titleKey, detailKey) {
  const records = [];
  for (const item of arrayField(payload, listKey)) {
    const record3 = asRecord(item);
    const id = text2(record3, idKey);
    if (!record3 || !id) continue;
    const detailValue = record3[detailKey];
    const detailRecord = asRecord(detailValue);
    const detail = detailRecord ? text2(detailRecord, "start") ?? text2(detailRecord, "timezone") ?? "" : text2(record3, detailKey) ?? "";
    records.push({
      id,
      title: text2(record3, titleKey) ?? "Untitled",
      detail
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
    const record3 = asRecord(row);
    if (!record3) continue;
    const first = Object.values(record3)[0];
    const fields = Array.isArray(first) ? asRecord(first[0]) : asRecord(first);
    const id = text2(fields, "Zoho_ID") ?? text2(fields, "recordId") ?? text2(record3, "recordId");
    if (!id) continue;
    const title = [text2(fields, "FirstName"), text2(fields, "LastName")].filter(Boolean).join(" ") || text2(fields, "EmployeeID") || "Employee";
    records.push({ id, title, detail: text2(fields, "EmailID") ?? "" });
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
function text2(record3, key) {
  const value = record3?.[key];
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
function planned(id, name, description, category, initials, icon, note = "Coming soon. This connector is not built yet, so Connect stays off.") {
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
    note
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
    scopes: ["Desk.tickets.READ", "Desk.basic.READ", "Desk.organization.READ"],
    docsUrl: "https://desk.zoho.com/DeskAPIDocument",
    note: "Read-only tickets. Choose a Desk organization when Zoho returns more than one."
  },
  planned("assist", "Zoho Assist", "Remote support session information.", "support", "ZA", "Headset"),
  planned(
    "mail",
    "Zoho Mail",
    "Business mailboxes.",
    "email",
    "ZM",
    "Mail",
    "Coming soon. A read-only mailbox preview is not built, so this app does not request mail access."
  ),
  {
    id: "calendar",
    cardId: "zoho-calendar",
    name: "Zoho Calendar",
    description: "Events and schedules.",
    category: "calendar",
    initials: "CL",
    icon: "Calendar",
    availability: "available",
    scopes: ["ZohoCalendar.calendar.READ", "ZohoCalendar.event.READ"],
    docsUrl: "https://www.zoho.com/calendar/help/api/oauth2-user-guide.html",
    note: "Read-only events from your own calendars for the next seven days."
  },
  planned(
    "workdrive",
    "Zoho WorkDrive",
    "Team files and folders.",
    "files",
    "WD",
    "Folder",
    "Coming soon. Team folders can be listed with WorkDrive.team.READ and WorkDrive.teamfolders.READ, and that connector is not built yet."
  ),
  planned("writer", "Zoho Writer", "Documents.", "files", "WR", "FileText"),
  planned("sheet", "Zoho Sheet", "Spreadsheets.", "files", "SH", "FileText"),
  planned("cliq", "Zoho Cliq", "Team conversations.", "email", "CQ", "MessageCircle"),
  planned("connect", "Zoho Connect", "Internal company network.", "email", "CN", "MessageSquare"),
  planned("meeting", "Zoho Meeting", "Meetings and webinars.", "calendar", "MT", "CalendarDays"),
  {
    id: "projects",
    cardId: "zoho-projects",
    name: "Zoho Projects",
    description: "Projects and tasks.",
    category: "project",
    initials: "PJ",
    icon: "CheckSquare",
    availability: "available",
    scopes: ["ZohoProjects.portals.READ", "ZohoProjects.projects.READ", "ZohoProjects.tasks.READ"],
    docsUrl: "https://www.zoho.com/projects/help/rest-api/projects-api.html",
    note: "Read-only projects and tasks. Choose a portal when Zoho returns more than one."
  },
  planned("sprints", "Zoho Sprints", "Agile sprints and work items.", "project", "SP", "ListTodo"),
  {
    id: "sign",
    cardId: "zoho-sign",
    name: "Zoho Sign",
    description: "Signature requests.",
    category: "files",
    initials: "SG",
    icon: "PenTool",
    availability: "available",
    scopes: ["ZohoSign.documents.READ"],
    docsUrl: "https://www.zoho.com/sign/api/document-managment/get-document-list.html",
    note: "Read-only signature requests."
  },
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
  {
    id: "creator",
    cardId: "zoho-creator",
    name: "Zoho Creator",
    description: "Custom apps and forms.",
    category: "project",
    initials: "CR",
    icon: "SquareDot",
    availability: "setup_required",
    scopes: [],
    docsUrl: "https://www.zoho.com/creator/help/api/v2/",
    note: "Setup required. Creator records belong to a specific app, and this connector does not ask for the app owner or link name yet."
  },
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
var ACCESS_REFRESH_SKEW_MS2 = 6e4;
var STATE_PATTERN2 = /^[A-Za-z0-9_-]{43}$/;
var CODE_PATTERN2 = /^[A-Za-z0-9._~-]{1,1024}$/;
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
    sendJson2(res, 413, publicError("server_error"));
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
    sendJson2(res, 405, publicError("server_error"));
    return;
  }
  const statusRoute = path.match(/^\/api\/integrations\/([a-z0-9-]+)\/status$/);
  if (statusRoute && method === "GET") {
    await handleStatus(req, res, deps, statusRoute[1] ?? "");
    return;
  }
  if (path.startsWith("/api/integrations/google")) {
    await handleGoogleRequest(req, res, deps);
    return;
  }
  if (path.startsWith("/api/integrations/zoho/")) {
    sendJson2(res, 405, publicError("server_error"));
    return;
  }
  sendJson2(res, 404, publicError("server_error"));
}
async function handleConnect(req, res, deps, productId) {
  const product = zohoProductById(productId);
  if (!product) {
    sendJson2(res, 404, publicError("server_error"));
    return;
  }
  if (product.availability !== "available") {
    sendJson2(res, 409, publicError("planned"));
    return;
  }
  if (!persistenceReady2(deps)) {
    sendJson2(res, 503, publicError("persistence_unavailable"));
    return;
  }
  if (limited2(req, deps, "connect", 20, 10 * 6e4)) {
    sendJson2(res, 429, publicError("rate_limited"));
    return;
  }
  const now = clock2(deps);
  const existing = await resolveSession2(req, deps, false);
  let session = existing?.session ?? null;
  let cookie = existing?.cookie ?? null;
  if (!session) {
    session = newSession2(now, null);
    await deps.store.createSession(session);
    cookie = cookieFor2(session, deps, now);
  }
  const state = createOauthState();
  await deps.store.saveOauthState(state, session.id, now + OAUTH_STATE_TTL_MS, product.id);
  const location = buildAuthorizationUrl({
    clientId: deps.config.clientId,
    redirectUri: deps.config.redirectUri,
    state,
    scope: product.scopes.join(",")
  });
  redirect2(res, location, cookie);
}
async function handleCallback(req, res, deps) {
  const params = requestParams(req.url);
  const errorParam = bounded2(params.get("error"), 64);
  const state = bounded2(params.get("state"), 128);
  const active = await resolveSession2(req, deps, false);
  if (errorParam) {
    await consumeIfValid2(deps, state, active?.session.id ?? null);
    redirect2(
      res,
      errorLocation2(errorParam === "access_denied" ? "access_denied" : "provider_error")
    );
    return;
  }
  if (!active) {
    redirect2(res, errorLocation2("invalid_state"));
    return;
  }
  if (!state || !STATE_PATTERN2.test(state)) {
    redirect2(res, errorLocation2("invalid_state"));
    return;
  }
  const code = bounded2(params.get("code"), 1024);
  if (!code || !CODE_PATTERN2.test(code)) {
    await consumeIfValid2(deps, state, active.session.id);
    redirect2(res, errorLocation2("missing_code"));
    return;
  }
  const accountsServer = bounded2(params.get("accounts-server"), 200);
  let accountsOrigin;
  try {
    accountsOrigin = accountsServer ? assertAccountsOrigin(accountsServer) : "";
  } catch {
    accountsOrigin = "";
  }
  if (!accountsOrigin) {
    await consumeIfValid2(deps, state, active.session.id);
    redirect2(res, errorLocation2("invalid_accounts_server"));
    return;
  }
  const productId = await deps.store.consumeOauthState(state, active.session.id, clock2(deps));
  const product = productId ? zohoProductById(productId) : null;
  if (!product || product.availability !== "available") {
    redirect2(res, errorLocation2("invalid_state"));
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
      redirect2(res, errorLocation2("missing_refresh_token"));
      return;
    }
    const now = clock2(deps);
    const next = newSession2(now, active.session.userId);
    const rotated = await deps.store.rotateSession(active.session.id, now, next);
    if (!rotated) {
      redirect2(res, errorLocation2("provider_error"));
      return;
    }
    const connectionId = randomUUID3();
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
    redirect2(
      res,
      `/?${new URLSearchParams({ zoho: "connected", product: product.id }).toString()}`,
      cookieFor2(rotated, deps, now)
    );
  } catch (error) {
    const reason = callbackReason(error);
    if (error instanceof ZohoRequestError && error.providerCode) {
      loggerOf(deps)("token_exchange_failed", { providerCode: error.providerCode });
    } else {
      loggerOf(deps)(reason);
    }
    redirect2(res, errorLocation2(reason));
  }
}
async function handleCatalog(req, res, deps) {
  const active = await resolveSession2(req, deps, true);
  const connections = active ? await deps.store.listConnections({ sessionId: active.session.id, userId: active.session.userId }) : [];
  const connected = new Map(connections.map((connection) => [connection.product, connection]));
  sendJson2(
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
    sendJson2(res, 404, publicError("server_error"));
    return;
  }
  const active = await resolveSession2(req, deps, true);
  if (!active) {
    sendJson2(res, 200, { connected: false, product: productId, identity: IDENTITY });
    return;
  }
  const connection = await deps.store.getConnection(ownerOf(active.session, productId));
  sendJson2(res, 200, statusBody(connection, productId), active.cookie);
}
async function handleLeads(req, res, deps) {
  const active = await resolveSession2(req, deps, true);
  if (!active) {
    sendJson2(res, 401, publicError("not_connected"));
    return;
  }
  const owner = ownerOf(active.session, CRM_PRODUCT);
  let connection = await deps.store.getConnection(owner);
  if (!connection) {
    sendJson2(res, 401, publicError("not_connected"), active.cookie);
    return;
  }
  try {
    connection = await refreshIfDue(connection, deps, false);
    let accessToken = readSecret(connection, deps, "access");
    if (!accessToken) {
      await deps.store.deleteConnection(owner);
      sendJson2(res, 401, publicError("reconnect_required"), active.cookie);
      return;
    }
    try {
      const leads = await fetchLeads(
        { apiOrigin: connection.apiOrigin, accessToken },
        fetchOf(deps)
      );
      sendJson2(
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
        sendJson2(res, 401, publicError("reconnect_required"), active.cookie);
        return;
      }
      const leads = await fetchLeads(
        { apiOrigin: connection.apiOrigin, accessToken },
        fetchOf(deps)
      );
      sendJson2(
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
      sendJson2(res, mapped.status, publicError(mapped.code), active.cookie);
      return;
    }
    loggerOf(deps)("provider_error");
    sendJson2(res, 502, publicError("provider_error"), active.cookie);
  }
}
async function handlePreview(req, res, deps, productId) {
  const product = zohoProductById(productId);
  if (!product || product.availability !== "available") {
    sendJson2(res, 404, publicError("server_error"));
    return;
  }
  const active = await resolveSession2(req, deps, true);
  if (!active) {
    sendJson2(res, 401, publicError("not_connected"));
    return;
  }
  if (limited2(req, deps, "preview", 60, 6e4)) {
    sendJson2(res, 429, publicError("rate_limited"), active.cookie);
    return;
  }
  const owner = ownerOf(active.session, product.id);
  let connection = await deps.store.getConnection(owner);
  if (!connection) {
    sendJson2(res, 401, publicError("not_connected"), active.cookie);
    return;
  }
  try {
    connection = await refreshIfDue(connection, deps, false);
    const accessToken = readSecret(connection, deps, "access");
    if (!accessToken) {
      await deps.store.deleteConnection(owner);
      sendJson2(res, 401, publicError("reconnect_required"), active.cookie);
      return;
    }
    let preview2 = await previewProduct(
      product.id,
      {
        apiOrigin: connection.apiOrigin,
        accessToken,
        organizationId: connection.organizationId
      },
      fetchOf(deps)
    );
    if (needsSingleOrganization(product.id, connection.organizationId, preview2.organizations)) {
      const only = preview2.organizations[0];
      if (only && await deps.store.setOrganization(owner, only.id)) {
        connection = { ...connection, organizationId: only.id };
        preview2 = await previewProduct(
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
    sendJson2(
      res,
      200,
      {
        product: product.id,
        apiDomain: connection.apiOrigin,
        organizationId: connection.organizationId,
        needsOrganization: organizationProducts(product.id) && !connection.organizationId && preview2.organizations.length > 1,
        organizations: preview2.organizations,
        sections: preview2.sections
      },
      active.cookie
    );
  } catch (error) {
    await sendZohoError(res, deps, owner, error, active.cookie);
  }
}
async function handleOrganization(req, res, deps, productId, body) {
  if (!hasCsrfHeader(req)) {
    sendJson2(res, 403, publicError("server_error"));
    return;
  }
  const product = zohoProductById(productId);
  if (!product || !organizationProducts(product.id)) {
    sendJson2(res, 404, publicError("server_error"));
    return;
  }
  const active = await resolveSession2(req, deps, true);
  if (!active) {
    sendJson2(res, 401, publicError("not_connected"));
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
    sendJson2(res, 400, publicError("server_error"), active.cookie);
    return;
  }
  const owner = ownerOf(active.session, product.id);
  const connection = await deps.store.getConnection(owner);
  if (!connection) {
    sendJson2(res, 401, publicError("not_connected"), active.cookie);
    return;
  }
  const accessToken = readSecret(connection, deps, "access");
  if (!accessToken) {
    sendJson2(res, 401, publicError("reconnect_required"), active.cookie);
    return;
  }
  try {
    const organizations = await listOrganizations(
      product.id,
      { apiOrigin: connection.apiOrigin, accessToken },
      fetchOf(deps)
    );
    if (!organizations.some((organization) => organization.id === requested)) {
      sendJson2(res, 400, publicError("server_error"), active.cookie);
      return;
    }
    await deps.store.setOrganization(owner, requested);
    sendJson2(res, 200, { organizationId: requested }, active.cookie);
  } catch (error) {
    await sendZohoError(res, deps, owner, error, active.cookie);
  }
}
async function handleDisconnect(req, res, deps, productId) {
  if (!hasCsrfHeader(req)) {
    sendJson2(res, 403, publicError("server_error"));
    return;
  }
  if (!zohoProductById(productId)) {
    sendJson2(res, 404, publicError("server_error"));
    return;
  }
  const active = await resolveSession2(req, deps, true);
  if (!active) {
    sendJson2(res, 200, { disconnected: true, revoked: false });
    return;
  }
  const owner = ownerOf(active.session, productId);
  const connection = await deps.store.getConnection(owner);
  if (!connection) {
    sendJson2(res, 200, { disconnected: true, revoked: false }, active.cookie);
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
  sendJson2(res, 200, { disconnected: true, revoked }, active.cookie);
}
async function refreshIfDue(connection, deps, force) {
  const now = clock2(deps);
  const due = connection.accessTokenExpiresAt - ACCESS_REFRESH_SKEW_MS2 <= now;
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
async function resolveSession2(req, deps, rotate) {
  const now = clock2(deps);
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  const payload = verifySessionToken(token, deps.config.sessionSecret, now);
  if (!payload) return null;
  const session = await deps.store.getSession(payload.sid);
  if (!session || session.expiresAt <= now || session.id !== payload.sid) return null;
  if (rotate && now - session.createdAt >= SESSION_ROTATE_AFTER_MS) {
    const next = newSession2(now, session.userId);
    const rotated = await deps.store.rotateSession(session.id, now, next);
    if (!rotated) return null;
    return { session: rotated, cookie: cookieFor2(rotated, deps, now) };
  }
  return { session, cookie: null };
}
function newSession2(now, userId) {
  return {
    id: createSessionId(),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    userId
  };
}
function cookieFor2(session, deps, now) {
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
  return product === "books" || product === "inventory" || product === "desk" || product === "projects";
}
function needsSingleOrganization(product, organizationId, organizations) {
  return organizationProducts(product) && !organizationId && organizations.length === 1;
}
function persistenceReady2(deps) {
  if (process.env.VERCEL === "1" && !deps.config.databaseUrl) return false;
  return true;
}
function persistenceName(deps) {
  if (deps.config.databaseUrl) return "postgres";
  if (!persistenceReady2(deps)) return "unavailable";
  return "sqlite";
}
var REQUIRED_TABLES = ["oauth_states", "sessions", "zoho_connections", "google_grants", "google_connections"];
async function handleHealth(res, deps) {
  const persistence = persistenceName(deps);
  if (!persistenceReady2(deps)) {
    sendJson2(res, 503, { ok: false, persistence, identity: IDENTITY, tables: [] });
    return;
  }
  try {
    const ping = await deps.store.ping();
    const tables = ping.tables.filter((name) => REQUIRED_TABLES.includes(name)).sort();
    const ok = REQUIRED_TABLES.every((name) => tables.includes(name));
    sendJson2(res, ok ? 200 : 503, { ok, persistence, identity: IDENTITY, tables });
  } catch (error) {
    loggerOf(deps)("database_check_failed");
    sendJson2(res, 503, {
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
function limited2(req, deps, action, limit, windowMs) {
  if (!deps.config.production || deps.now) return false;
  const now = clock2(deps);
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
    sendJson2(res, mapped.status, publicError(mapped.code), cookie);
    return;
  }
  loggerOf(deps)("provider_error");
  sendJson2(res, 502, publicError("provider_error"), cookie);
}
async function consumeIfValid2(deps, state, sessionId) {
  if (!state || !sessionId || !STATE_PATTERN2.test(state)) return;
  await deps.store.consumeOauthState(state, sessionId, clock2(deps));
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
function errorLocation2(reason) {
  return `/?${new URLSearchParams({ zoho: "error", reason }).toString()}`;
}
function redirect2(res, location, cookie) {
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
function sendJson2(res, status, body, cookie) {
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
function bounded2(value, max) {
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
function clock2(deps) {
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
    getGoogleGrant: () => Promise.resolve(null),
    insertGoogleGrant: refused,
    updateGoogleGrant: refused,
    listGoogleConnections: () => Promise.resolve([]),
    upsertGoogleConnection: refused,
    deleteGoogleConnection: () => Promise.resolve(false),
    deleteGoogleGrant: refused,
    ping: () => Promise.resolve({ tables: [] }),
    close: () => Promise.resolve()
  };
}

// server/vercel-handler.ts
init_postgres_store();
var ready = null;
var REQUIRED_TABLES3 = ["oauth_states", "sessions", "zoho_connections", "google_grants", "google_connections"];
async function reportDatabaseHealth(res) {
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) {
    sendJson3(res, 503, { ok: false, persistence: "unavailable", identity: IDENTITY, tables: [] });
    return;
  }
  try {
    const store = await openPostgresStore(databaseUrl);
    const ping = await store.ping();
    await store.close();
    const tables = ping.tables.filter((name) => REQUIRED_TABLES3.includes(name)).sort();
    const ok = REQUIRED_TABLES3.every((name) => tables.includes(name));
    sendJson3(res, ok ? 200 : 503, { ok, persistence: "postgres", identity: IDENTITY, tables });
  } catch (error) {
    sendJson3(res, 503, {
      ok: false,
      persistence: "postgres",
      identity: IDENTITY,
      tables: [],
      message: safeMessage(error)
    });
  }
}
function sendJson3(res, status, body) {
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
      return { config, store, googleConfig: loadGoogleConfig(process.env, config.production) };
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
