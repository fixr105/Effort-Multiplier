export const ZOHO_INTEGRATION_ID = 'zoho-crm';
export const ZOHO_CONNECT_PATH = '/api/integrations/zoho/connect';

export interface ZohoLead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  status: string;
}

export interface ZohoStatus {
  connected: boolean;
  apiDomain: string | null;
}

const RETURN_REASONS = [
  'access_denied',
  'invalid_state',
  'missing_code',
  'invalid_accounts_server',
  'token_exchange_failed',
  'invalid_api_domain',
  'missing_refresh_token',
  'provider_error',
] as const;

export type ZohoReturnReason = (typeof RETURN_REASONS)[number];

export type ZohoReturn =
  | { type: 'none' }
  | { type: 'connected' }
  | { type: 'error'; reason: ZohoReturnReason };

const API_ERRORS = [
  'not_connected',
  'rate_limited',
  'missing_scope',
  'reconnect_required',
  'provider_unavailable',
  'provider_error',
  'server_error',
] as const;

type ApiErrorCode = (typeof API_ERRORS)[number];

export class ZohoClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let pendingReturn: ZohoReturn | null = null;

/**
 * Reads the OAuth result from the callback redirect once.
 * React Strict Mode mounts twice; the query string is removed on the first
 * read and kept in memory for the second.
 */
export function consumeZohoReturn(): ZohoReturn {
  if (pendingReturn) {
    const value = pendingReturn;
    pendingReturn = null;
    return value;
  }
  const fromUrl = readZohoReturn(window.location.search);
  if (fromUrl.type === 'none') return fromUrl;
  pendingReturn = fromUrl;
  const url = new URL(window.location.href);
  url.searchParams.delete('zoho');
  url.searchParams.delete('reason');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  return fromUrl;
}

export function readZohoReturn(search: string): ZohoReturn {
  const params = new URLSearchParams(search);
  const flag = params.get('zoho');
  if (flag === 'connected') return { type: 'connected' };
  if (flag === 'error') return { type: 'error', reason: parseReason(params.get('reason')) };
  return { type: 'none' };
}

export function zohoReturnMessage(reason: ZohoReturnReason): string {
  switch (reason) {
    case 'access_denied':
      return 'Zoho authorization was cancelled. No new account was connected.';
    case 'invalid_state':
      return 'The Zoho sign-in session expired or did not match this browser. Start the connection again.';
    case 'missing_code':
      return 'Zoho did not return an authorization code. No account was connected.';
    case 'invalid_accounts_server':
      return 'Zoho returned an accounts server that this app does not accept. No tokens were stored.';
    case 'token_exchange_failed':
      return 'Zoho did not issue tokens. No account was connected.';
    case 'invalid_api_domain':
      return 'Zoho returned an API domain that this app does not accept. No tokens were stored.';
    case 'missing_refresh_token':
      return 'Zoho did not return a refresh token. Reconnect and grant offline access. If this app was authorized before, remove it in your Zoho account and try again.';
    case 'provider_error':
      return 'Zoho could not complete the connection. No account was connected.';
    default: {
      const neverReason: never = reason;
      return neverReason;
    }
  }
}

export function apiErrorMessage(payload: unknown): string {
  const code = parseApiError(payload);
  if (!code) return 'The request could not be completed.';
  switch (code) {
    case 'not_connected':
      return 'Zoho CRM is not connected.';
    case 'rate_limited':
      return 'Zoho rate limit reached. Try again shortly.';
    case 'missing_scope':
      return 'Zoho did not allow Leads read access. Reconnect and grant the requested permission.';
    case 'reconnect_required':
      return 'The Zoho connection expired. Reconnect Zoho CRM.';
    case 'provider_unavailable':
      return 'Zoho could not be reached. No data was changed.';
    case 'provider_error':
      return 'Zoho could not complete the request.';
    case 'server_error':
      return 'The request could not be completed.';
    default: {
      const neverCode: never = code;
      return neverCode;
    }
  }
}

export function apiErrorCode(payload: unknown): string | null {
  return parseApiError(payload);
}

export async function fetchZohoStatus(): Promise<ZohoStatus> {
  const response = await fetch('/api/integrations/zoho/status');
  if (!response.ok) throw new ZohoClientError('status_unavailable', 'Zoho connection status is unavailable.');
  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    throw new ZohoClientError('status_unavailable', 'Zoho connection status is unavailable.');
  }
  if (payload.connected === true) {
    return {
      connected: true,
      apiDomain: typeof payload.apiDomain === 'string' ? displayApiDomain(payload.apiDomain) : null,
    };
  }
  if (payload.connected === false) return { connected: false, apiDomain: null };
  throw new ZohoClientError('status_unavailable', 'Zoho connection status is unavailable.');
}

export async function fetchZohoLeads(): Promise<{ leads: ZohoLead[]; apiDomain: string | null }> {
  const response = await fetch('/api/integrations/zoho/leads');
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new ZohoClientError(apiErrorCode(payload) ?? 'server_error', apiErrorMessage(payload));
  }
  if (!isRecord(payload) || !Array.isArray(payload.leads)) {
    throw new ZohoClientError('provider_error', 'Zoho could not complete the request.');
  }
  const leads: ZohoLead[] = [];
  for (const item of payload.leads) {
    const lead = toLead(item);
    if (lead) leads.push(lead);
  }
  return {
    leads,
    apiDomain: typeof payload.apiDomain === 'string' ? displayApiDomain(payload.apiDomain) : null,
  };
}

export async function disconnectZoho(): Promise<{ revoked: boolean }> {
  const response = await fetch('/api/integrations/zoho/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new ZohoClientError(apiErrorCode(payload) ?? 'server_error', apiErrorMessage(payload));
  }
  return { revoked: isRecord(payload) && payload.revoked === true };
}

export function displayApiDomain(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !isZohoApiHost(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parseReason(value: string | null): ZohoReturnReason {
  if (value && (RETURN_REASONS as readonly string[]).includes(value)) {
    return value as ZohoReturnReason;
  }
  return 'provider_error';
}

function parseApiError(payload: unknown): ApiErrorCode | null {
  if (!isRecord(payload) || typeof payload.error !== 'string') return null;
  if (!(API_ERRORS as readonly string[]).includes(payload.error)) return null;
  return payload.error as ApiErrorCode;
}

function toLead(value: unknown): ZohoLead | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0) return null;
  return {
    id: value.id,
    firstName: text(value.firstName),
    lastName: text(value.lastName),
    email: text(value.email),
    company: text(value.company),
    status: text(value.status),
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isZohoApiHost(hostname: string): boolean {
  return (
    hostname === 'www.zohoapis.com' ||
    hostname.endsWith('.zohoapis.com') ||
    hostname.endsWith('.zohoapis.eu') ||
    hostname.endsWith('.zohoapis.in') ||
    hostname.endsWith('.zohoapis.com.au') ||
    hostname.endsWith('.zohoapis.jp') ||
    hostname.endsWith('.zohoapis.com.cn') ||
    hostname.endsWith('.zohoapis.sa') ||
    hostname.endsWith('.zohoapis.ca')
  );
}
