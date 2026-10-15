import type { MicrosoftSettings } from './microsoft-config.ts';

export interface MicrosoftTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
}

export interface MicrosoftAccountIdentity {
  oid: string;
  email: string;
}

export interface MicrosoftOAuth {
  authorizationUrl(input: { state: string; scopes: readonly string[] }): string;
  exchange(code: string): Promise<MicrosoftTokenSet>;
  refresh(refreshToken: string, scopes: readonly string[]): Promise<MicrosoftTokenSet>;
  identity(accessToken: string): Promise<MicrosoftAccountIdentity | null>;
}

export function createMicrosoftOAuth(settings: MicrosoftSettings, fetchImpl: typeof fetch = fetch): MicrosoftOAuth {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(settings.tenant)}/oauth2/v2.0/token`;

  return {
    authorizationUrl(input) {
      const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(settings.tenant)}/oauth2/v2.0/authorize`);
      url.searchParams.set('client_id', settings.clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', settings.redirectUri);
      url.searchParams.set('response_mode', 'query');
      url.searchParams.set('scope', input.scopes.join(' '));
      url.searchParams.set('state', input.state);
      url.searchParams.set('prompt', 'consent');
      return url.toString();
    },
    async exchange(code) {
      return tokenSet(await tokenRequest(fetchImpl, tokenUrl, {
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: settings.redirectUri,
      }));
    },
    async refresh(refreshToken, scopes) {
      const next = tokenSet(await tokenRequest(fetchImpl, tokenUrl, {
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: scopes.join(' '),
      }));
      return { ...next, refreshToken: next.refreshToken ?? refreshToken };
    },
    async identity(accessToken) {
      const response = await fetchImpl('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const body = await response.json().catch(() => null);
      if (!body || typeof body !== 'object') return null;
      const record = body as Record<string, unknown>;
      const oid = typeof record.id === 'string' ? record.id : '';
      const email = typeof record.mail === 'string' && record.mail.includes('@')
        ? record.mail
        : typeof record.userPrincipalName === 'string'
          ? record.userPrincipalName
          : '';
      if (!oid || !email) return null;
      return { oid, email };
    },
  };
}

async function tokenRequest(
  fetchImpl: typeof fetch,
  url: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== 'object') {
    throw new Error('token_exchange_failed');
  }
  return body as Record<string, unknown>;
}

function tokenSet(body: Record<string, unknown>): MicrosoftTokenSet {
  const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
  if (!accessToken) throw new Error('token_exchange_failed');
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in);
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
    scope: typeof body.scope === 'string' ? body.scope : '',
  };
}
