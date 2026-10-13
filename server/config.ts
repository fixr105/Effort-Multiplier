import { timingSafeEqual } from 'node:crypto';

/**
 * Local Zoho API Console redirect URI. The OAuth request uses ZOHO_REDIRECT_URI
 * from the environment and does not rewrite it. In local development that value
 * must be this exact URL, and the same URL must be registered in Zoho.
 */
export const LOCAL_REDIRECT_URI =
  'http://localhost:5173/api/integrations/zoho/callback';

export const API_PORT = 3001;

const HEX_KEY = /^[0-9a-fA-F]{64}$/;

export interface AppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: Buffer;
  tokenEncryptionKey: Buffer;
  production: boolean;
  databasePath: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const clientId = required(env, 'ZOHO_CLIENT_ID');
  const clientSecret = required(env, 'ZOHO_CLIENT_SECRET');
  const redirectUri = required(env, 'ZOHO_REDIRECT_URI');
  const sessionSecret = decodeKey(required(env, 'SESSION_SECRET'), 'SESSION_SECRET');
  const tokenEncryptionKey = decodeKey(
    required(env, 'TOKEN_ENCRYPTION_KEY'),
    'TOKEN_ENCRYPTION_KEY',
  );

  if (
    sessionSecret.length === tokenEncryptionKey.length &&
    timingSafeEqual(sessionSecret, tokenEncryptionKey)
  ) {
    throw new Error(
      'SESSION_SECRET and TOKEN_ENCRYPTION_KEY must be different 32-byte keys.',
    );
  }

  const production = env.NODE_ENV === 'production';
  assertRedirectUri(redirectUri, production);

  return {
    clientId,
    clientSecret,
    redirectUri,
    sessionSecret,
    tokenEncryptionKey,
    production,
    databasePath: env.ZOHO_DB_PATH?.trim() || 'data/zoho.sqlite',
    port: API_PORT,
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `${name} is missing. Set it in the server environment. Zoho CRM will not fall back to demo mode.`,
    );
  }
  return value.trim();
}

function decodeKey(value: string, name: string): Buffer {
  if (!HEX_KEY.test(value)) {
    throw new Error(
      `${name} must be a 64-character hex string encoding 32 bytes. Generate one with: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return Buffer.from(value, 'hex');
}

function assertRedirectUri(value: string, production: boolean): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'ZOHO_REDIRECT_URI must be an absolute URL that matches the redirect URI registered in the Zoho API Console. The server will not substitute a different callback URL.',
    );
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'ZOHO_REDIRECT_URI must not contain credentials, a query string, or a fragment. Register the exact callback URL in the Zoho API Console.',
    );
  }

  if (production) {
    if (url.protocol !== 'https:') {
      throw new Error(
        'ZOHO_REDIRECT_URI must use https in production and must match the Zoho API Console exactly.',
      );
    }
    return;
  }

  if (value !== LOCAL_REDIRECT_URI) {
    throw new Error(
      `Local development requires ZOHO_REDIRECT_URI to be ${LOCAL_REDIRECT_URI}. Register that exact URI in the Zoho API Console. The server will not substitute a different callback URL.`,
    );
  }
}
