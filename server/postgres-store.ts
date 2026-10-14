import { Pool } from 'pg';
import type {
  GoogleConnectionRecord,
  GoogleGrantRecord,
  SessionRecord,
  StoredConnection,
  TokenStore,
} from './store.ts';

const SCHEMA_STATEMENTS = [
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
  )`,
];

const REQUIRED_TABLES = [
  'oauth_states',
  'sessions',
  'zoho_connections',
  'google_grants',
  'google_connections',
] as const;

export async function openPostgresStore(databaseUrl: string): Promise<TokenStore> {
  const pool = new Pool(poolOptions(databaseUrl));
  await applySchema(pool);

  return {
    async createSession(session) {
      await pool.query(
        'INSERT INTO sessions (id, created_at, expires_at, user_id) VALUES ($1, $2, $3, $4)',
        [session.id, session.createdAt, session.expiresAt, session.userId],
      );
    },
    async getSession(id) {
      const result = await pool.query('SELECT id, created_at, expires_at, user_id FROM sessions WHERE id = $1', [id]);
      return mapSession(result.rows[0]);
    },
    async rotateSession(sessionId, now, next) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await client.query(
          'SELECT expires_at FROM sessions WHERE id = $1',
          [sessionId],
        );
        const row = current.rows[0] as { expires_at: number } | undefined;
        if (!row || Number(row.expires_at) <= now) {
          await client.query('ROLLBACK');
          return null;
        }
        await client.query(
          'INSERT INTO sessions (id, created_at, expires_at, user_id) VALUES ($1, $2, $3, $4)',
          [next.id, next.createdAt, next.expiresAt, next.userId],
        );
        await client.query(
          'UPDATE zoho_connections SET session_id = $1, user_id = $2 WHERE session_id = $3',
          [next.id, next.userId, sessionId],
        );
        await client.query(
          'UPDATE google_grants SET session_id = $1, user_id = $2 WHERE session_id = $3',
          [next.id, next.userId, sessionId],
        );
        await client.query(
          'UPDATE google_connections SET session_id = $1 WHERE session_id = $2',
          [next.id, sessionId],
        );
        await client.query('DELETE FROM oauth_states WHERE session_id = $1', [sessionId]);
        await client.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
        await client.query('COMMIT');
        return next;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async saveOauthState(state, sessionId, expiresAt, product) {
      await pool.query('DELETE FROM oauth_states WHERE expires_at <= $1 OR used_at IS NOT NULL', [expiresAt]);
      await pool.query(
        'INSERT INTO oauth_states (state, session_id, product, expires_at, used_at) VALUES ($1, $2, $3, $4, NULL)',
        [state, sessionId, product, expiresAt],
      );
    },
    async consumeOauthState(state, sessionId, now) {
      const result = await pool.query(
        `UPDATE oauth_states SET used_at = $1
         WHERE state = $2 AND session_id = $3 AND used_at IS NULL AND expires_at > $4
         RETURNING product`,
        [now, state, sessionId, now],
      );
      const product = result.rows[0]?.product;
      return typeof product === 'string' ? product : null;
    },
    async saveConnection(connection) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM zoho_connections WHERE session_id = $1 AND product = $2', [
          connection.sessionId,
          connection.product,
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
            connection.updatedAt,
          ],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async getConnection(owner) {
      if (owner.userId) {
        const byUser = await pool.query(
          `${connectionSelect()} WHERE user_id = $1 AND product = $2`,
          [owner.userId, owner.product],
        );
        const found = mapConnection(byUser.rows[0]);
        if (found) return found;
      }
      const bySession = await pool.query(
        `${connectionSelect()} WHERE session_id = $1 AND product = $2`,
        [owner.sessionId, owner.product],
      );
      return mapConnection(bySession.rows[0]);
    },
    async listConnections(owner) {
      const result = owner.userId
        ? await pool.query(`${connectionSelect()} WHERE user_id = $1`, [owner.userId])
        : await pool.query(`${connectionSelect()} WHERE session_id = $1`, [owner.sessionId]);
      return result.rows.map((row) => mapConnection(row)).filter((row): row is StoredConnection => row !== null);
    },
    async deleteConnection(owner) {
      const byUser = owner.userId
        ? await pool.query(`${connectionSelect()} WHERE user_id = $1 AND product = $2`, [owner.userId, owner.product])
        : null;
      const bySession = await pool.query(
        `${connectionSelect()} WHERE session_id = $1 AND product = $2`,
        [owner.sessionId, owner.product],
      );
      const existing = mapConnection(byUser?.rows[0]) ?? mapConnection(bySession.rows[0]);
      if (!existing) return null;
      await pool.query('DELETE FROM zoho_connections WHERE session_id = $1 AND product = $2', [
        existing.sessionId,
        existing.product,
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
          connection.id,
        ],
      );
    },
    async getGoogleGrant(sessionId, googleSub) {
      const result = await pool.query(
        `${googleGrantSelect()} WHERE session_id = $1 AND google_sub = $2`,
        [sessionId, googleSub],
      );
      return mapGoogleGrant(result.rows[0] as Record<string, unknown> | undefined);
    },
    async insertGoogleGrant(grant) {
      await pool.query(
        `INSERT INTO google_grants (
          id, session_id, user_id, google_sub, email,
          access_iv, access_tag, access_ciphertext,
          refresh_iv, refresh_tag, refresh_ciphertext,
          access_expires_at, granted_scopes, refreshed_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        googleGrantValues(grant),
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
          grant.sessionId,
        ],
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
        [sessionId],
      );
      return result.rows
        .map((row) => mapGoogleConnection(row as Record<string, unknown>))
        .filter((row): row is GoogleConnectionRecord => row !== null);
    },
    async upsertGoogleConnection(input) {
      await pool.query(
        `INSERT INTO google_connections (id, grant_id, session_id, product, scopes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (session_id, product) DO UPDATE SET
           grant_id = EXCLUDED.grant_id,
           scopes = EXCLUDED.scopes,
           updated_at = EXCLUDED.updated_at`,
        [input.id, input.grantId, input.sessionId, input.product, input.scopes, input.createdAt, input.updatedAt],
      );
    },
    async deleteGoogleConnection(sessionId, product) {
      const result = await pool.query(
        'DELETE FROM google_connections WHERE session_id = $1 AND product = $2',
        [sessionId, product],
      );
      return (result.rowCount ?? 0) === 1;
    },
    async deleteGoogleGrant(sessionId, grantId) {
      await pool.query(
        'DELETE FROM google_connections WHERE grant_id = $1 AND session_id = $2',
        [grantId, sessionId],
      );
      await pool.query(
        'DELETE FROM google_grants WHERE id = $1 AND session_id = $2',
        [grantId, sessionId],
      );
    },
    async setOrganization(owner, organizationId) {
      const result = await pool.query(
        'UPDATE zoho_connections SET organization_id = $1, updated_at = $2 WHERE session_id = $3 AND product = $4',
        [organizationId, Date.now(), owner.sessionId, owner.product],
      );
      return (result.rowCount ?? 0) === 1;
    },
    async ping() {
      const result = await pool.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])
         ORDER BY table_name`,
        [REQUIRED_TABLES],
      );
      return {
        tables: result.rows.map((row: { table_name?: unknown }) => String(row.table_name ?? '')).filter(Boolean),
      };
    },
    async close() {
      await pool.end();
    },
  };
}

async function applySchema(pool: Pool): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await pool.query(statement);
  }
}

function connectionSelect(): string {
  return `SELECT id, session_id, user_id, product, accounts_origin, api_origin,
            access_iv, access_tag, access_ciphertext,
            refresh_iv, refresh_tag, refresh_ciphertext,
            access_expires_at, scope, organization_id, created_at, updated_at
     FROM zoho_connections`;
}

function poolOptions(databaseUrl: string): ConstructorParameters<typeof Pool>[0] {
  const options: ConstructorParameters<typeof Pool>[0] = {
    connectionString: databaseUrl,
    max: 2,
  };
  const local = databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');
  if (local) options.ssl = false;
  else if (!/sslmode=/i.test(databaseUrl)) options.ssl = { rejectUnauthorized: true };
  return options;
}

function googleGrantSelect(): string {
  return `SELECT id, session_id, user_id, google_sub, email,
            access_iv, access_tag, access_ciphertext,
            refresh_iv, refresh_tag, refresh_ciphertext,
            access_expires_at, granted_scopes, refreshed_at, created_at, updated_at
     FROM google_grants`;
}

function googleGrantValues(grant: GoogleGrantRecord): unknown[] {
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
    grant.updatedAt,
  ];
}

function mapGoogleGrant(row: Record<string, unknown> | undefined): GoogleGrantRecord | null {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    sessionId: String(row.session_id),
    userId: typeof row.user_id === 'string' ? row.user_id : null,
    googleSub: String(row.google_sub),
    email: String(row.email),
    accessToken: {
      iv: String(row.access_iv),
      tag: String(row.access_tag),
      ciphertext: String(row.access_ciphertext),
    },
    refreshToken: {
      iv: String(row.refresh_iv),
      tag: String(row.refresh_tag),
      ciphertext: String(row.refresh_ciphertext),
    },
    accessTokenExpiresAt: Number(row.access_expires_at),
    grantedScopes: String(row.granted_scopes),
    refreshedAt: row.refreshed_at === null || row.refreshed_at === undefined ? null : Number(row.refreshed_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapGoogleConnection(row: Record<string, unknown> | undefined): GoogleConnectionRecord | null {
  const grant = mapGoogleGrant(row);
  if (!grant || !row || typeof row.product !== 'string' || typeof row.connection_id !== 'string') return null;
  return {
    ...grant,
    id: row.connection_id,
    grantId: String(row.grant_id),
    product: row.product,
    scopes: String(row.scopes),
    createdAt: Number(row.connection_created_at),
    updatedAt: Number(row.connection_updated_at),
  };
}

function mapSession(row: Record<string, unknown> | undefined): SessionRecord | null {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    userId: typeof row.user_id === 'string' ? row.user_id : null,
  };
}

function mapConnection(row: Record<string, unknown> | undefined): StoredConnection | null {
  if (!row || typeof row.id !== 'string' || typeof row.product !== 'string') return null;
  return {
    id: row.id,
    sessionId: String(row.session_id),
    userId: typeof row.user_id === 'string' ? row.user_id : null,
    product: row.product,
    accountsOrigin: String(row.accounts_origin),
    apiOrigin: String(row.api_origin),
    accessToken: {
      iv: String(row.access_iv),
      tag: String(row.access_tag),
      ciphertext: String(row.access_ciphertext),
    },
    refreshToken: {
      iv: String(row.refresh_iv),
      tag: String(row.refresh_tag),
      ciphertext: String(row.refresh_ciphertext),
    },
    accessTokenExpiresAt: Number(row.access_expires_at),
    scope: String(row.scope),
    organizationId: typeof row.organization_id === 'string' ? row.organization_id : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
