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
}

export interface StoredConnection {
  id: string;
  sessionId: string;
  userId: string | null;
  accountsOrigin: string;
  apiOrigin: string;
  accessToken: EncryptedSecret;
  refreshToken: EncryptedSecret;
  accessTokenExpiresAt: number;
  scope: string;
  createdAt: number;
  updatedAt: number;
}

export interface TokenStore {
  createSession(session: SessionRecord): void;
  getSession(id: string): SessionRecord | null;
  rotateSession(sessionId: string, now: number, next: SessionRecord): SessionRecord | null;
  saveOauthState(state: string, sessionId: string, expiresAt: number): void;
  consumeOauthState(state: string, sessionId: string, now: number): boolean;
  saveConnection(connection: StoredConnection): void;
  getConnection(owner: ConnectionOwner): StoredConnection | null;
  deleteConnection(owner: ConnectionOwner): StoredConnection | null;
  updateConnectionSecrets(connection: StoredConnection): void;
  close(): void;
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

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS zoho_connections (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      user_id TEXT,
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS zoho_connections_user_id
      ON zoho_connections(user_id)
      WHERE user_id IS NOT NULL;
  `);

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
    'INSERT INTO oauth_states (state, session_id, expires_at, used_at) VALUES (?, ?, ?, NULL)',
  );
  const consumeState = db.prepare(
    `UPDATE oauth_states
     SET used_at = ?
     WHERE state = ? AND session_id = ? AND used_at IS NULL AND expires_at > ?`,
  );
  const deleteExpiredStates = db.prepare(
    'DELETE FROM oauth_states WHERE expires_at <= ? OR used_at IS NOT NULL',
  );
  const insertConnection = db.prepare(
    `INSERT INTO zoho_connections (
      id, session_id, user_id, accounts_origin, api_origin,
      access_iv, access_tag, access_ciphertext,
      refresh_iv, refresh_tag, refresh_ciphertext,
      access_expires_at, scope, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const deleteConnectionBySession = db.prepare(
    'DELETE FROM zoho_connections WHERE session_id = ?',
  );
  const selectConnectionBySession = db.prepare(
    `SELECT id, session_id, user_id, accounts_origin, api_origin,
            access_iv, access_tag, access_ciphertext,
            refresh_iv, refresh_tag, refresh_ciphertext,
            access_expires_at, scope, created_at, updated_at
     FROM zoho_connections WHERE session_id = ?`,
  );
  const selectConnectionByUser = db.prepare(
    `SELECT id, session_id, user_id, accounts_origin, api_origin,
            access_iv, access_tag, access_ciphertext,
            refresh_iv, refresh_tag, refresh_ciphertext,
            access_expires_at, scope, created_at, updated_at
     FROM zoho_connections WHERE user_id = ?`,
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
    createSession(session) {
      insertSession.run(session.id, session.createdAt, session.expiresAt, session.userId);
    },
    getSession(id) {
      return mapSession(selectSession.get(id) as SessionRow | undefined);
    },
    rotateSession(sessionId, now, next) {
      const current = selectSession.get(sessionId) as SessionRow | undefined;
      if (!current || current.expires_at <= now) return null;
      transaction(() => {
        insertSession.run(next.id, next.createdAt, next.expiresAt, next.userId);
        moveConnection.run(next.id, next.userId, sessionId);
        deleteStatesForSession.run(sessionId);
        deleteSession.run(sessionId);
      });
      return next;
    },
    saveOauthState(state, sessionId, expiresAt) {
      deleteExpiredStates.run(expiresAt);
      insertState.run(state, sessionId, expiresAt);
    },
    consumeOauthState(state, sessionId, now) {
      const result = consumeState.run(now, state, sessionId, now);
      return Number(result.changes) === 1;
    },
    saveConnection(connection) {
      transaction(() => {
        deleteConnectionBySession.run(connection.sessionId);
        insertConnection.run(
          connection.id,
          connection.sessionId,
          connection.userId,
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
          connection.createdAt,
          connection.updatedAt,
        );
      });
    },
    getConnection(owner) {
      if (owner.userId) {
        const byUser = mapConnection(
          selectConnectionByUser.get(owner.userId) as ConnectionRow | undefined,
        );
        if (byUser) return byUser;
      }
      return mapConnection(
        selectConnectionBySession.get(owner.sessionId) as ConnectionRow | undefined,
      );
    },
    deleteConnection(owner) {
      const existing = this.getConnection(owner);
      if (!existing) return null;
      deleteConnectionBySession.run(existing.sessionId);
      return existing;
    },
    updateConnectionSecrets(connection) {
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
    close() {
      db.close();
    },
  };
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
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

function asNumber(value: number | bigint | string): number {
  return typeof value === 'bigint' ? Number(value) : Number(value);
}
