import { chmodSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { EncryptedSecret } from './crypto.ts';

/**
 * Local-development token store.
 *
 * There are no Effort Multiplier user accounts yet. Tokens are bound to a
 * verified server session, not to a founder id. A random browser session is
 * not production multi-tenant identity. `userId` is stored so a later
 * authenticated user id can own the same connection record. The request
 * never supplies that id.
 */

export interface SessionRecord {
  id: string;
  createdAt: number;
  expiresAt: number;
  userId: string | null;
}

export interface ConnectionOwner {
  sessionId: string;
  userId: string | null;
  product: string;
}

export interface StoredConnection {
  id: string;
  sessionId: string;
  userId: string | null;
  product: string;
  accountsOrigin: string;
  apiOrigin: string;
  accessToken: EncryptedSecret;
  refreshToken: EncryptedSecret;
  accessTokenExpiresAt: number;
  scope: string;
  organizationId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GoogleGrantRecord {
  id: string;
  sessionId: string;
  userId: string | null;
  googleSub: string;
  email: string;
  accessToken: EncryptedSecret;
  refreshToken: EncryptedSecret;
  accessTokenExpiresAt: number;
  grantedScopes: string;
  refreshedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface MicrosoftGrantRecord {
  id: string;
  sessionId: string;
  userId: string | null;
  microsoftOid: string;
  email: string;
  accessToken: EncryptedSecret;
  refreshToken: EncryptedSecret;
  accessTokenExpiresAt: number;
  grantedScopes: string;
  refreshedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface MicrosoftConnectionRecord extends MicrosoftGrantRecord {
  grantId: string;
  product: string;
  scopes: string;
}

export interface GoogleConnectionRecord {
  id: string;
  grantId: string;
  sessionId: string;
  userId: string | null;
  product: string;
  scopes: string;
  email: string;
  googleSub: string;
  grantedScopes: string;
  accessToken: EncryptedSecret;
  refreshToken: EncryptedSecret;
  accessTokenExpiresAt: number;
  refreshedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TokenStore {
  createSession(session: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  rotateSession(sessionId: string, now: number, next: SessionRecord): Promise<SessionRecord | null>;
  saveOauthState(state: string, sessionId: string, expiresAt: number, product: string): Promise<void>;
  consumeOauthState(state: string, sessionId: string, now: number): Promise<string | null>;
  saveConnection(connection: StoredConnection): Promise<void>;
  getConnection(owner: ConnectionOwner): Promise<StoredConnection | null>;
  listConnections(owner: Pick<ConnectionOwner, 'sessionId' | 'userId'>): Promise<StoredConnection[]>;
  deleteConnection(owner: ConnectionOwner): Promise<StoredConnection | null>;
  updateConnectionSecrets(connection: StoredConnection): Promise<void>;
  setOrganization(owner: ConnectionOwner, organizationId: string): Promise<boolean>;
  getGoogleGrant(sessionId: string, googleSub: string): Promise<GoogleGrantRecord | null>;
  insertGoogleGrant(grant: GoogleGrantRecord): Promise<void>;
  updateGoogleGrant(grant: GoogleGrantRecord): Promise<void>;
  listGoogleConnections(sessionId: string): Promise<GoogleConnectionRecord[]>;
  upsertGoogleConnection(input: {
    id: string;
    grantId: string;
    sessionId: string;
    product: string;
    scopes: string;
    createdAt: number;
    updatedAt: number;
  }): Promise<void>;
  deleteGoogleConnection(sessionId: string, product: string): Promise<boolean>;
  deleteGoogleGrant(sessionId: string, grantId: string): Promise<void>;
  getMicrosoftGrant(sessionId: string, microsoftOid: string): Promise<MicrosoftGrantRecord | null>;
  insertMicrosoftGrant(grant: MicrosoftGrantRecord): Promise<void>;
  updateMicrosoftGrant(grant: MicrosoftGrantRecord): Promise<void>;
  listMicrosoftConnections(sessionId: string): Promise<MicrosoftConnectionRecord[]>;
  upsertMicrosoftConnection(input: {
    id: string;
    grantId: string;
    sessionId: string;
    product: string;
    scopes: string;
    createdAt: number;
    updatedAt: number;
  }): Promise<void>;
  deleteMicrosoftConnection(sessionId: string, product: string): Promise<boolean>;
  deleteMicrosoftGrant(sessionId: string, grantId: string): Promise<void>;
  ping(): Promise<{ tables: string[] }>;
  close(): Promise<void>;
}

interface SessionRow {
  id: string;
  created_at: number;
  expires_at: number;
  user_id: string | null;
}

interface ConnectionRow {
  id: string;
  session_id: string;
  user_id: string | null;
  product: string;
  accounts_origin: string;
  api_origin: string;
  access_iv: string;
  access_tag: string;
  access_ciphertext: string;
  refresh_iv: string;
  refresh_tag: string;
  refresh_ciphertext: string;
  access_expires_at: number;
  scope: string;
  organization_id: string | null;
  created_at: number;
  updated_at: number;
}

export function openTokenStore(filename: string): TokenStore {
  const persistent = filename !== ':memory:';
  if (persistent) {
    const directory = dirname(filename);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!isSharedTempDirectory(directory)) {
      chmodSync(directory, 0o700);
    }
  }

  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = DELETE;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      user_id TEXT
    );

  `);
  ensureOauthStates(db);
  ensureConnections(db);
  ensureGoogle(db);
  ensureMicrosoft(db);

  if (persistent) {
    chmodSync(filename, 0o600);
    const mode = statSync(filename).mode & 0o777;
    if (mode !== 0o600) {
      db.close();
      throw new Error('Could not restrict permissions on the token database.');
    }
  }

  const insertSession = db.prepare(
    'INSERT INTO sessions (id, created_at, expires_at, user_id) VALUES (?, ?, ?, ?)',
  );
  const selectSession = db.prepare(
    'SELECT id, created_at, expires_at, user_id FROM sessions WHERE id = ?',
  );
  const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');
  const deleteStatesForSession = db.prepare(
    'DELETE FROM oauth_states WHERE session_id = ?',
  );
  const insertState = db.prepare(
    'INSERT INTO oauth_states (state, session_id, product, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)',
  );
  const consumeState = db.prepare(
    `UPDATE oauth_states
     SET used_at = ?
     WHERE state = ? AND session_id = ? AND used_at IS NULL AND expires_at > ?
     RETURNING product`,
  );
  const deleteExpiredStates = db.prepare(
    'DELETE FROM oauth_states WHERE expires_at <= ? OR used_at IS NOT NULL',
  );
  const connectionColumns = `id, session_id, user_id, product, accounts_origin, api_origin,
            access_iv, access_tag, access_ciphertext,
            refresh_iv, refresh_tag, refresh_ciphertext,
            access_expires_at, scope, organization_id, created_at, updated_at`;
  const insertConnection = db.prepare(
    `INSERT INTO zoho_connections (
      id, session_id, user_id, product, accounts_origin, api_origin,
      access_iv, access_tag, access_ciphertext,
      refresh_iv, refresh_tag, refresh_ciphertext,
      access_expires_at, scope, organization_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const deleteConnectionByOwner = db.prepare(
    'DELETE FROM zoho_connections WHERE session_id = ? AND product = ?',
  );
  const selectConnectionBySession = db.prepare(
    `SELECT ${connectionColumns}
     FROM zoho_connections WHERE session_id = ? AND product = ?`,
  );
  const selectConnectionByUser = db.prepare(
    `SELECT ${connectionColumns}
     FROM zoho_connections WHERE user_id = ? AND product = ?`,
  );
  const listBySession = db.prepare(
    `SELECT ${connectionColumns} FROM zoho_connections WHERE session_id = ?`,
  );
  const listByUser = db.prepare(
    `SELECT ${connectionColumns} FROM zoho_connections WHERE user_id = ?`,
  );
  const setOrganizationStatement = db.prepare(
    `UPDATE zoho_connections
     SET organization_id = ?, updated_at = ?
     WHERE session_id = ? AND product = ?`,
  );
  const updateSecrets = db.prepare(
    `UPDATE zoho_connections
     SET access_iv = ?, access_tag = ?, access_ciphertext = ?,
         refresh_iv = ?, refresh_tag = ?, refresh_ciphertext = ?,
         access_expires_at = ?, api_origin = ?, updated_at = ?
     WHERE id = ?`,
  );
  const moveConnection = db.prepare(
    'UPDATE zoho_connections SET session_id = ?, user_id = ? WHERE session_id = ?',
  );
  const googleGrantColumns = `id, session_id, user_id, google_sub, email,
    access_iv, access_tag, access_ciphertext,
    refresh_iv, refresh_tag, refresh_ciphertext,
    access_expires_at, granted_scopes, refreshed_at, created_at, updated_at`;
  const selectGoogleGrant = db.prepare(
    `SELECT ${googleGrantColumns} FROM google_grants WHERE session_id = ? AND google_sub = ?`,
  );
  const insertGoogleGrant = db.prepare(
    `INSERT INTO google_grants (
      id, session_id, user_id, google_sub, email,
      access_iv, access_tag, access_ciphertext,
      refresh_iv, refresh_tag, refresh_ciphertext,
      access_expires_at, granted_scopes, refreshed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateGoogleGrant = db.prepare(
    `UPDATE google_grants
     SET email = ?, access_iv = ?, access_tag = ?, access_ciphertext = ?,
         refresh_iv = ?, refresh_tag = ?, refresh_ciphertext = ?,
         access_expires_at = ?, granted_scopes = ?, refreshed_at = ?, updated_at = ?
     WHERE id = ? AND session_id = ?`,
  );
  const listGoogleConnections = db.prepare(
    `SELECT c.id AS connection_id, c.grant_id, c.product, c.scopes,
            c.created_at AS connection_created_at, c.updated_at AS connection_updated_at,
            g.id, g.session_id, g.user_id, g.google_sub, g.email,
            g.access_iv, g.access_tag, g.access_ciphertext,
            g.refresh_iv, g.refresh_tag, g.refresh_ciphertext,
            g.access_expires_at, g.granted_scopes, g.refreshed_at, g.created_at, g.updated_at
     FROM google_connections c
     JOIN google_grants g ON g.id = c.grant_id AND g.session_id = c.session_id
     WHERE c.session_id = ?`,
  );
  const upsertGoogleConnection = db.prepare(
    `INSERT INTO google_connections (id, grant_id, session_id, product, scopes, created_at, updated_at)
     SELECT ?, id, session_id, ?, ?, ?, ?
     FROM google_grants
     WHERE id = ? AND session_id = ?
     ON CONFLICT(session_id, product) DO UPDATE SET
       grant_id = excluded.grant_id,
       scopes = excluded.scopes,
       updated_at = excluded.updated_at`,
  );
  const deleteGoogleConnection = db.prepare(
    'DELETE FROM google_connections WHERE session_id = ? AND product = ?',
  );
  const deleteGoogleConnectionsForGrant = db.prepare(
    'DELETE FROM google_connections WHERE grant_id = ? AND session_id = ?',
  );
  const deleteGoogleGrant = db.prepare(
    'DELETE FROM google_grants WHERE id = ? AND session_id = ?',
  );
  const microsoftGrantColumns = `id, session_id, user_id, microsoft_oid, email,
    access_iv, access_tag, access_ciphertext,
    refresh_iv, refresh_tag, refresh_ciphertext,
    access_expires_at, granted_scopes, refreshed_at, created_at, updated_at`;
  const selectMicrosoftGrant = db.prepare(
    `SELECT ${microsoftGrantColumns} FROM microsoft_grants WHERE session_id = ? AND microsoft_oid = ?`,
  );
  const insertMicrosoftGrant = db.prepare(
    `INSERT INTO microsoft_grants (
      id, session_id, user_id, microsoft_oid, email,
      access_iv, access_tag, access_ciphertext,
      refresh_iv, refresh_tag, refresh_ciphertext,
      access_expires_at, granted_scopes, refreshed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateMicrosoftGrant = db.prepare(
    `UPDATE microsoft_grants
     SET email = ?, access_iv = ?, access_tag = ?, access_ciphertext = ?,
         refresh_iv = ?, refresh_tag = ?, refresh_ciphertext = ?,
         access_expires_at = ?, granted_scopes = ?, refreshed_at = ?, updated_at = ?
     WHERE id = ? AND session_id = ?`,
  );
  const listMicrosoftConnections = db.prepare(
    `SELECT c.id AS connection_id, c.grant_id, c.product, c.scopes,
            c.created_at AS connection_created_at, c.updated_at AS connection_updated_at,
            g.id, g.session_id, g.user_id, g.microsoft_oid, g.email,
            g.access_iv, g.access_tag, g.access_ciphertext,
            g.refresh_iv, g.refresh_tag, g.refresh_ciphertext,
            g.access_expires_at, g.granted_scopes, g.refreshed_at, g.created_at, g.updated_at
     FROM microsoft_connections c
     JOIN microsoft_grants g ON g.id = c.grant_id AND g.session_id = c.session_id
     WHERE c.session_id = ?`,
  );
  const upsertMicrosoftConnection = db.prepare(
    `INSERT INTO microsoft_connections (id, grant_id, session_id, product, scopes, created_at, updated_at)
     SELECT ?, id, session_id, ?, ?, ?, ?
     FROM microsoft_grants
     WHERE id = ? AND session_id = ?
     ON CONFLICT(session_id, product) DO UPDATE SET
       grant_id = excluded.grant_id,
       scopes = excluded.scopes,
       updated_at = excluded.updated_at`,
  );
  const deleteMicrosoftConnection = db.prepare(
    'DELETE FROM microsoft_connections WHERE session_id = ? AND product = ?',
  );
  const deleteMicrosoftConnectionsForGrant = db.prepare(
    'DELETE FROM microsoft_connections WHERE grant_id = ? AND session_id = ?',
  );
  const deleteMicrosoftGrant = db.prepare(
    'DELETE FROM microsoft_grants WHERE id = ? AND session_id = ?',
  );

  function transaction(run: () => void): void {
    db.exec('BEGIN IMMEDIATE');
    try {
      run();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    async createSession(session) {
      insertSession.run(session.id, session.createdAt, session.expiresAt, session.userId);
    },
    async getSession(id) {
      return mapSession(selectSession.get(id) as unknown as SessionRow | undefined);
    },
    async rotateSession(sessionId, now, next) {
      const current = selectSession.get(sessionId) as unknown as SessionRow | undefined;
      if (!current || current.expires_at <= now) return null;
      transaction(() => {
        insertSession.run(next.id, next.createdAt, next.expiresAt, next.userId);
        moveConnection.run(next.id, next.userId, sessionId);
        db.prepare('UPDATE google_grants SET session_id = ?, user_id = ? WHERE session_id = ?').run(
          next.id,
          next.userId,
          sessionId,
        );
        db.prepare('UPDATE google_connections SET session_id = ? WHERE session_id = ?').run(next.id, sessionId);
        db.prepare('UPDATE microsoft_grants SET session_id = ?, user_id = ? WHERE session_id = ?').run(
          next.id,
          next.userId,
          sessionId,
        );
        db.prepare('UPDATE microsoft_connections SET session_id = ? WHERE session_id = ?').run(next.id, sessionId);
        deleteStatesForSession.run(sessionId);
        deleteSession.run(sessionId);
      });
      return next;
    },
    async saveOauthState(state, sessionId, expiresAt, product) {
      deleteExpiredStates.run(expiresAt);
      insertState.run(state, sessionId, product, expiresAt);
    },
    async consumeOauthState(state, sessionId, now) {
      const row = consumeState.get(now, state, sessionId, now) as { product: string } | undefined;
      return typeof row?.product === 'string' ? row.product : null;
    },
    async saveConnection(connection) {
      transaction(() => {
        deleteConnectionByOwner.run(connection.sessionId, connection.product);
        insertConnection.run(
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
        );
      });
    },
    async getConnection(owner) {
      if (owner.userId) {
        const byUser = mapConnection(
          selectConnectionByUser.get(owner.userId, owner.product) as unknown as ConnectionRow | undefined,
        );
        if (byUser) return byUser;
      }
      return mapConnection(
        selectConnectionBySession.get(owner.sessionId, owner.product) as unknown as ConnectionRow | undefined,
      );
    },
    async listConnections(owner) {
      const rows = (
        owner.userId
          ? listByUser.all(owner.userId)
          : listBySession.all(owner.sessionId)
      ) as unknown as ConnectionRow[];
      return rows.map((row) => mapConnection(row)).filter((row): row is StoredConnection => row !== null);
    },
    async deleteConnection(owner) {
      const existing = await this.getConnection(owner);
      if (!existing) return null;
      deleteConnectionByOwner.run(existing.sessionId, existing.product);
      return existing;
    },
    async updateConnectionSecrets(connection) {
      updateSecrets.run(
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
      );
    },
    async setOrganization(owner, organizationId) {
      const result = setOrganizationStatement.run(
        organizationId,
        Date.now(),
        owner.sessionId,
        owner.product,
      );
      return Number(result.changes) === 1;
    },
    async getGoogleGrant(sessionId, googleSub) {
      return mapGoogleGrant(selectGoogleGrant.get(sessionId, googleSub) as unknown as GoogleGrantRow | undefined);
    },
    async insertGoogleGrant(grant) {
      insertGoogleGrant.run(...googleGrantValues(grant));
    },
    async updateGoogleGrant(grant) {
      updateGoogleGrant.run(
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
      );
    },
    async listGoogleConnections(sessionId) {
      const rows = listGoogleConnections.all(sessionId) as unknown as GoogleConnectionRow[];
      return rows.map((row) => mapGoogleConnection(row)).filter((row): row is GoogleConnectionRecord => row !== null);
    },
    async upsertGoogleConnection(input) {
      const result = upsertGoogleConnection.run(
        input.id,
        input.product,
        input.scopes,
        input.createdAt,
        input.updatedAt,
        input.grantId,
        input.sessionId,
      );
      if (Number(result.changes) !== 1) {
        throw new Error('google_grant_session_mismatch');
      }
    },
    async deleteGoogleConnection(sessionId, product) {
      const result = deleteGoogleConnection.run(sessionId, product);
      return Number(result.changes) === 1;
    },
    async deleteGoogleGrant(sessionId, grantId) {
      deleteGoogleConnectionsForGrant.run(grantId, sessionId);
      deleteGoogleGrant.run(grantId, sessionId);
    },
    async getMicrosoftGrant(sessionId, microsoftOid) {
      return mapMicrosoftGrant(selectMicrosoftGrant.get(sessionId, microsoftOid) as unknown as MicrosoftGrantRow | undefined);
    },
    async insertMicrosoftGrant(grant) {
      insertMicrosoftGrant.run(...microsoftGrantValues(grant));
    },
    async updateMicrosoftGrant(grant) {
      updateMicrosoftGrant.run(
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
      );
    },
    async listMicrosoftConnections(sessionId) {
      const rows = listMicrosoftConnections.all(sessionId) as unknown as MicrosoftConnectionRow[];
      return rows.map((row) => mapMicrosoftConnection(row)).filter((row): row is MicrosoftConnectionRecord => row !== null);
    },
    async upsertMicrosoftConnection(input) {
      const result = upsertMicrosoftConnection.run(
        input.id,
        input.product,
        input.scopes,
        input.createdAt,
        input.updatedAt,
        input.grantId,
        input.sessionId,
      );
      if (Number(result.changes) !== 1) {
        throw new Error('microsoft_grant_session_mismatch');
      }
    },
    async deleteMicrosoftConnection(sessionId, product) {
      const result = deleteMicrosoftConnection.run(sessionId, product);
      return Number(result.changes) === 1;
    },
    async deleteMicrosoftGrant(sessionId, grantId) {
      deleteMicrosoftConnectionsForGrant.run(grantId, sessionId);
      deleteMicrosoftGrant.run(grantId, sessionId);
    },
    async ping() {
      const rows = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('sessions', 'oauth_states', 'zoho_connections', 'google_grants', 'google_connections', 'microsoft_grants', 'microsoft_connections') ORDER BY name`)
        .all() as { name: string }[];
      return { tables: rows.map((row) => row.name) };
    },
    async close() {
      db.close();
    },
  };
}

function ensureGoogle(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_grants (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT,
      google_sub TEXT NOT NULL,
      email TEXT NOT NULL,
      access_iv TEXT NOT NULL,
      access_tag TEXT NOT NULL,
      access_ciphertext TEXT NOT NULL,
      refresh_iv TEXT NOT NULL,
      refresh_tag TEXT NOT NULL,
      refresh_ciphertext TEXT NOT NULL,
      access_expires_at INTEGER NOT NULL,
      granted_scopes TEXT NOT NULL,
      refreshed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      UNIQUE (session_id, google_sub)
    );
    CREATE TABLE IF NOT EXISTS google_connections (
      id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      product TEXT NOT NULL,
      scopes TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (grant_id) REFERENCES google_grants(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      UNIQUE (session_id, product)
    );
  `);
}

interface GoogleGrantRow {
  id: string;
  session_id: string;
  user_id: string | null;
  google_sub: string;
  email: string;
  access_iv: string;
  access_tag: string;
  access_ciphertext: string;
  refresh_iv: string;
  refresh_tag: string;
  refresh_ciphertext: string;
  access_expires_at: number;
  granted_scopes: string;
  refreshed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface GoogleConnectionRow extends GoogleGrantRow {
  connection_id: string;
  grant_id: string;
  product: string;
  scopes: string;
  connection_created_at: number;
  connection_updated_at: number;
}

function googleGrantValues(grant: GoogleGrantRecord): Array<string | number | null> {
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

function mapGoogleGrant(row: GoogleGrantRow | undefined): GoogleGrantRecord | null {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: typeof row.user_id === 'string' ? row.user_id : null,
    googleSub: row.google_sub,
    email: row.email,
    accessToken: {
      iv: row.access_iv,
      tag: row.access_tag,
      ciphertext: row.access_ciphertext,
    },
    refreshToken: {
      iv: row.refresh_iv,
      tag: row.refresh_tag,
      ciphertext: row.refresh_ciphertext,
    },
    accessTokenExpiresAt: Number(row.access_expires_at),
    grantedScopes: row.granted_scopes,
    refreshedAt: row.refreshed_at === null || row.refreshed_at === undefined ? null : Number(row.refreshed_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapGoogleConnection(row: GoogleConnectionRow | undefined): GoogleConnectionRecord | null {
  const grant = mapGoogleGrant(row);
  if (!grant || !row || typeof row.product !== 'string' || typeof row.connection_id !== 'string') return null;
  return {
    ...grant,
    id: row.connection_id,
    grantId: row.grant_id,
    product: row.product,
    scopes: row.scopes,
    createdAt: Number(row.connection_created_at),
    updatedAt: Number(row.connection_updated_at),
  };
}

function ensureMicrosoft(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS microsoft_grants (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT,
      microsoft_oid TEXT NOT NULL,
      email TEXT NOT NULL,
      access_iv TEXT NOT NULL,
      access_tag TEXT NOT NULL,
      access_ciphertext TEXT NOT NULL,
      refresh_iv TEXT NOT NULL,
      refresh_tag TEXT NOT NULL,
      refresh_ciphertext TEXT NOT NULL,
      access_expires_at INTEGER NOT NULL,
      granted_scopes TEXT NOT NULL,
      refreshed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      UNIQUE (session_id, microsoft_oid)
    );
    CREATE TABLE IF NOT EXISTS microsoft_connections (
      id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      product TEXT NOT NULL,
      scopes TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (grant_id) REFERENCES microsoft_grants(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      UNIQUE (session_id, product)
    );
  `);
}

interface MicrosoftGrantRow {
  id: string;
  session_id: string;
  user_id: string | null;
  microsoft_oid: string;
  email: string;
  access_iv: string;
  access_tag: string;
  access_ciphertext: string;
  refresh_iv: string;
  refresh_tag: string;
  refresh_ciphertext: string;
  access_expires_at: number;
  granted_scopes: string;
  refreshed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface MicrosoftConnectionRow extends MicrosoftGrantRow {
  connection_id: string;
  grant_id: string;
  product: string;
  scopes: string;
  connection_created_at: number;
  connection_updated_at: number;
}

function microsoftGrantValues(grant: MicrosoftGrantRecord): Array<string | number | null> {
  return [
    grant.id,
    grant.sessionId,
    grant.userId,
    grant.microsoftOid,
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

function mapMicrosoftGrant(row: MicrosoftGrantRow | undefined): MicrosoftGrantRecord | null {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: typeof row.user_id === 'string' ? row.user_id : null,
    microsoftOid: row.microsoft_oid,
    email: row.email,
    accessToken: {
      iv: row.access_iv,
      tag: row.access_tag,
      ciphertext: row.access_ciphertext,
    },
    refreshToken: {
      iv: row.refresh_iv,
      tag: row.refresh_tag,
      ciphertext: row.refresh_ciphertext,
    },
    accessTokenExpiresAt: Number(row.access_expires_at),
    grantedScopes: row.granted_scopes,
    refreshedAt: row.refreshed_at === null || row.refreshed_at === undefined ? null : Number(row.refreshed_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapMicrosoftConnection(row: MicrosoftConnectionRow | undefined): MicrosoftConnectionRecord | null {
  const grant = mapMicrosoftGrant(row);
  if (!grant || !row || typeof row.product !== 'string' || typeof row.connection_id !== 'string') return null;
  return {
    ...grant,
    id: row.connection_id,
    grantId: row.grant_id,
    product: row.product,
    scopes: row.scopes,
    createdAt: Number(row.connection_created_at),
    updatedAt: Number(row.connection_updated_at),
  };
}

function ensureOauthStates(db: DatabaseSync): void {
  const columns = tableColumns(db, 'oauth_states');
  if (columns.length === 0) {
    db.exec(`
      CREATE TABLE oauth_states (
        state TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        product TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
    `);
    return;
  }
  if (columns.includes('product')) return;
  db.exec(`
    ALTER TABLE oauth_states RENAME TO oauth_states_legacy;
    CREATE TABLE oauth_states (
      state TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      product TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    INSERT INTO oauth_states (state, session_id, product, expires_at, used_at)
    SELECT state, session_id, 'crm', expires_at, used_at FROM oauth_states_legacy;
    DROP TABLE oauth_states_legacy;
  `);
}

function ensureConnections(db: DatabaseSync): void {
  const columns = tableColumns(db, 'zoho_connections');
  if (columns.length === 0) {
    db.exec(`
      CREATE TABLE zoho_connections (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
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
        access_expires_at INTEGER NOT NULL,
        scope TEXT NOT NULL,
        organization_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        UNIQUE (session_id, product)
      );
      CREATE UNIQUE INDEX zoho_connections_user_product
        ON zoho_connections(user_id, product)
        WHERE user_id IS NOT NULL;
    `);
    return;
  }
  if (columns.includes('product')) return;
  db.exec(`
    ALTER TABLE zoho_connections RENAME TO zoho_connections_legacy;
    CREATE TABLE zoho_connections (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
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
      access_expires_at INTEGER NOT NULL,
      scope TEXT NOT NULL,
      organization_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      UNIQUE (session_id, product)
    );
    INSERT INTO zoho_connections (
      id, session_id, user_id, product, accounts_origin, api_origin,
      access_iv, access_tag, access_ciphertext,
      refresh_iv, refresh_tag, refresh_ciphertext,
      access_expires_at, scope, organization_id, created_at, updated_at
    )
    SELECT
      id, session_id, user_id, 'crm', accounts_origin, api_origin,
      access_iv, access_tag, access_ciphertext,
      refresh_iv, refresh_tag, refresh_ciphertext,
      access_expires_at, scope, NULL, created_at, updated_at
    FROM zoho_connections_legacy;
    DROP TABLE zoho_connections_legacy;
    CREATE UNIQUE INDEX zoho_connections_user_product
      ON zoho_connections(user_id, product)
      WHERE user_id IS NOT NULL;
  `);
}

function tableColumns(db: DatabaseSync, table: 'oauth_states' | 'zoho_connections'): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.map((row) => row.name);
}

function isSharedTempDirectory(directory: string): boolean {
  const resolved = resolve(directory);
  return resolved === '/tmp' || resolved === '/private/tmp' || resolved === '/var/tmp' || resolved === '/';
}

function mapSession(row: SessionRow | undefined): SessionRecord | null {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    createdAt: asNumber(row.created_at),
    expiresAt: asNumber(row.expires_at),
    userId: typeof row.user_id === 'string' ? row.user_id : null,
  };
}

function mapConnection(row: ConnectionRow | undefined): StoredConnection | null {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: typeof row.user_id === 'string' ? row.user_id : null,
    product: row.product,
    accountsOrigin: row.accounts_origin,
    apiOrigin: row.api_origin,
    accessToken: {
      iv: row.access_iv,
      tag: row.access_tag,
      ciphertext: row.access_ciphertext,
    },
    refreshToken: {
      iv: row.refresh_iv,
      tag: row.refresh_tag,
      ciphertext: row.refresh_ciphertext,
    },
    accessTokenExpiresAt: asNumber(row.access_expires_at),
    scope: row.scope,
    organizationId: typeof row.organization_id === 'string' ? row.organization_id : null,
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

function asNumber(value: number | bigint | string): number {
  return typeof value === 'bigint' ? Number(value) : Number(value);
}
