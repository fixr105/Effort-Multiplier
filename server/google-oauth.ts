import { OAuth2Client } from 'google-auth-library';
import type { GoogleSettings } from './google-config.ts';

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
  idToken: string | null;
}

export interface GoogleAccountIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
}

export interface GoogleOAuth {
  authorizationUrl(input: { state: string; scopes: readonly string[] }): string;
  exchange(code: string): Promise<GoogleTokenSet>;
  refresh(refreshToken: string): Promise<GoogleTokenSet>;
  revoke(token: string): Promise<void>;
  identity(idToken: string): Promise<GoogleAccountIdentity | null>;
}

export function createGoogleOAuth(settings: GoogleSettings): GoogleOAuth {
  const client = new OAuth2Client({
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    redirectUri: settings.redirectUri,
  });

  return {
    authorizationUrl(input) {
      return client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: true,
        scope: [...input.scopes],
        state: input.state,
        redirect_uri: settings.redirectUri,
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
        audience: settings.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) return null;
      return {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
      };
    },
  };
}

function tokenSet(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
  id_token?: string | null;
}): GoogleTokenSet {
  if (!tokens.access_token) {
    throw new Error('token_exchange_failed');
  }
  const expiry = typeof tokens.expiry_date === 'number' ? tokens.expiry_date : Date.now() + 3600_000;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresIn: Math.max(1, Math.floor((expiry - Date.now()) / 1000)),
    scope: tokens.scope ?? '',
    idToken: tokens.id_token ?? null,
  };
}
