import type { AppConfig } from './config.ts';
import type { TokenStore } from './store.ts';

/**
 * SQLite is loaded only for local development. Vercel filesystem storage is
 * ephemeral, so production refuses to open it and waits for DATABASE_URL.
 */
export async function openConfiguredStore(config: AppConfig): Promise<TokenStore> {
  if (config.databaseUrl) {
    const { openPostgresStore } = await import('./postgres-store.ts');
    return openPostgresStore(config.databaseUrl);
  }
  if (process.env.VERCEL === '1') return unavailableStore();
  const sqliteEntry = './store.ts';
  const { openTokenStore } = await import(sqliteEntry);
  return openTokenStore(config.databasePath);
}

function unavailableStore(): TokenStore {
  const refused = () => Promise.reject(new Error('DATABASE_URL is required in production.'));
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
    getMicrosoftGrant: () => Promise.resolve(null),
    insertMicrosoftGrant: refused,
    updateMicrosoftGrant: refused,
    listMicrosoftConnections: () => Promise.resolve([]),
    upsertMicrosoftConnection: refused,
    deleteMicrosoftConnection: () => Promise.resolve(false),
    deleteMicrosoftGrant: refused,
    ping: () => Promise.resolve({ tables: [] }),
    close: () => Promise.resolve(),
  };
}
