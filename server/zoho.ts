import { assertAccountsOrigin, assertApiOrigin } from './domains.ts';

export const ZOHO_SCOPE = 'ZohoCRM.modules.leads.READ';
export const LEAD_FIELDS = [
  'First_Name',
  'Last_Name',
  'Email',
  'Company',
  'Lead_Status',
] as const;
export const LEAD_PAGE_SIZE = 5;
const REQUEST_TIMEOUT_MS = 15_000;

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  apiOrigin: string;
  expiresIn: number;
}

export interface LeadPreview {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  status: string;
}

export type ZohoFailure =
  | 'token_exchange_failed'
  | 'missing_refresh_token'
  | 'invalid_api_domain'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'invalid_token'
  | 'missing_scope'
  | 'provider_error';

export class ZohoRequestError extends Error {
  readonly kind: ZohoFailure;
  readonly providerCode: string | null;

  constructor(kind: ZohoFailure, providerCode: string | null = null) {
    super(kind);
    this.kind = kind;
    this.providerCode = providerCode;
  }
}

export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL('https://accounts.zoho.com/oauth/v2/auth');
  url.searchParams.set('scope', ZOHO_SCOPE);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  return url.toString();
}

export async function exchangeAuthorizationCode(
  input: {
    accountsServer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
  },
  fetchImpl: typeof fetch,
): Promise<TokenSet> {
  const accountsOrigin = assertAccountsOrigin(input.accountsServer);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
  });
  const payload = await postToken(accountsOrigin, body, fetchImpl);
  if (!payload.refreshToken) {
    throw new ZohoRequestError('missing_refresh_token');
  }
  return payload;
}

export async function refreshAccessToken(
  input: {
    accountsOrigin: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  },
  fetchImpl: typeof fetch,
): Promise<TokenSet> {
  const accountsOrigin = assertAccountsOrigin(input.accountsOrigin);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
  });
  return postToken(accountsOrigin, body, fetchImpl);
}

export async function revokeRefreshToken(
  input: { accountsOrigin: string; refreshToken: string },
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const accountsOrigin = assertAccountsOrigin(input.accountsOrigin);
  try {
    const response = await fetchImpl(`${accountsOrigin}/oauth/v2/token/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: input.refreshToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchLeads(
  input: { apiOrigin: string; accessToken: string },
  fetchImpl: typeof fetch,
): Promise<LeadPreview[]> {
  const apiOrigin = assertApiOrigin(input.apiOrigin);
  const url = new URL('/crm/v8/Leads', apiOrigin);
  url.searchParams.set('fields', LEAD_FIELDS.join(','));
  url.searchParams.set('per_page', String(LEAD_PAGE_SIZE));

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Zoho-oauthtoken ${input.accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ZohoRequestError('provider_unavailable');
  }

  if (response.status === 204) return [];
  const payload = await readJson(response);
  if (response.status === 429) {
    throw new ZohoRequestError('rate_limited', crmCode(payload));
  }
  if (!response.ok) {
    const code = crmCode(payload);
    if (code === 'INVALID_TOKEN' || code === 'AUTHENTICATION_FAILURE') {
      throw new ZohoRequestError('invalid_token', code);
    }
    if (code === 'OAUTH_SCOPE_MISMATCH') {
      throw new ZohoRequestError('missing_scope', code);
    }
    throw new ZohoRequestError('provider_error', code);
  }

  const data = record(payload)?.data;
  if (!Array.isArray(data)) return [];
  const leads: LeadPreview[] = [];
  for (const item of data) {
    const lead = toLead(item);
    if (lead) leads.push(lead);
    if (leads.length === LEAD_PAGE_SIZE) break;
  }
  return leads;
}

async function postToken(
  accountsOrigin: string,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<TokenSet> {
  let response: Response;
  try {
    response = await fetchImpl(`${accountsOrigin}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ZohoRequestError('provider_unavailable');
  }

  const payload = await readJson(response);
  const oauthError = oauthCode(payload);
  if (!response.ok || oauthError) {
    throw new ZohoRequestError('token_exchange_failed', oauthError);
  }

  const fields = record(payload);
  const accessToken = stringField(fields, 'access_token');
  const apiDomain = stringField(fields, 'api_domain');
  const expiresIn = numberField(fields, 'expires_in');
  if (!accessToken || !apiDomain || expiresIn === null || expiresIn < 0) {
    throw new ZohoRequestError('token_exchange_failed');
  }

  let apiOrigin: string;
  try {
    apiOrigin = assertApiOrigin(apiDomain);
  } catch {
    throw new ZohoRequestError('invalid_api_domain');
  }

  return {
    accessToken,
    refreshToken: stringField(fields, 'refresh_token'),
    apiOrigin,
    expiresIn,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(
  value: Record<string, unknown> | null,
  key: string,
): string | null {
  const field = value?.[key];
  return typeof field === 'string' && field.length > 0 ? field : null;
}

function numberField(
  value: Record<string, unknown> | null,
  key: string,
): number | null {
  const field = value?.[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : null;
}

function oauthCode(value: unknown): string | null {
  return safeCode(stringField(record(value), 'error'));
}

function crmCode(value: unknown): string | null {
  return safeCode(stringField(record(value), 'code'));
}

function safeCode(value: string | null): string | null {
  if (!value || !/^[A-Za-z0-9_.-]{1,64}$/.test(value)) return null;
  return value;
}

function toLead(value: unknown): LeadPreview | null {
  const fields = record(value);
  const id = stringField(fields, 'id');
  if (!fields || !id) return null;
  return {
    id,
    firstName: stringField(fields, 'First_Name') ?? '',
    lastName: stringField(fields, 'Last_Name') ?? '',
    email: stringField(fields, 'Email') ?? '',
    company: stringField(fields, 'Company') ?? '',
    status: stringField(fields, 'Lead_Status') ?? '',
  };
}
