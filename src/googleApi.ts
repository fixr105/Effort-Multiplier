import type { Integration } from '@/types';

export interface GoogleCatalogProduct {
  id: string;
  cardId: string;
  name: string;
  description: string;
  category: Integration['category'];
  initials: string;
  icon: string;
  docsUrl: string;
  connected: boolean;
  connectable: boolean;
  email: string | null;
  scopes: string[];
}

export interface GooglePreviewSection {
  title: string;
  records: { id: string; title: string; detail: string }[];
}

const RETURN_REASONS = [
  'access_denied',
  'invalid_state',
  'missing_code',
  'token_exchange_failed',
  'missing_refresh_token',
  'invalid_account',
  'missing_scope',
  'provider_error',
] as const;

export type GoogleReturnReason = (typeof RETURN_REASONS)[number];

export type GoogleReturn =
  | { type: 'none' }
  | { type: 'connected'; product: string | null }
  | { type: 'error'; reason: GoogleReturnReason };

const API_ERRORS = [
  'configuration',
  'unavailable',
  'not_connected',
  'rate_limited',
  'missing_scope',
  'reconnect_required',
  'provider_unavailable',
  'provider_error',
  'server_error',
  'persistence_unavailable',
  'forbidden',
] as const;

type ApiErrorCode = (typeof API_ERRORS)[number];

export class GoogleClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

let pendingReturn: GoogleReturn | null = null;

export function consumeGoogleReturn(): GoogleReturn {
  if (pendingReturn) {
    const value = pendingReturn;
    pendingReturn = null;
    return value;
  }
  const fromUrl = readGoogleReturn(window.location.search);
  if (fromUrl.type === 'none') return fromUrl;
  pendingReturn = fromUrl;
  const url = new URL(window.location.href);
  url.searchParams.delete('google');
  url.searchParams.delete('reason');
  url.searchParams.delete('product');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  return fromUrl;
}

export function readGoogleReturn(search: string): GoogleReturn {
  const params = new URLSearchParams(search);
  const flag = params.get('google');
  if (flag === 'connected') {
    const product = params.get('product');
    return { type: 'connected', product: product && /^[a-z0-9-]{1,40}$/.test(product) ? product : null };
  }
  if (flag === 'error') return { type: 'error', reason: parseReason(params.get('reason')) };
  return { type: 'none' };
}

export function googleReturnMessage(reason: GoogleReturnReason): string {
  switch (reason) {
    case 'access_denied':
      return 'Google authorization was cancelled. No new account was connected.';
    case 'invalid_state':
      return 'The Google sign-in session expired or did not match this browser. Start the connection again.';
    case 'missing_code':
      return 'Google did not return an authorization code. No account was connected.';
    case 'token_exchange_failed':
      return 'Google did not issue tokens. No account was connected.';
    case 'missing_refresh_token':
      return 'Google did not return a refresh token. Reconnect and allow offline access.';
    case 'invalid_account':
      return 'Google did not confirm the account. No connection was stored.';
    case 'missing_scope':
      return 'Google did not grant the requested access. No connection was stored.';
    case 'provider_error':
      return 'Google could not complete the connection. No account was connected.';
    default: {
      const neverReason: never = reason;
      return neverReason;
    }
  }
}

export function googleProductIdFromCard(cardId: string): string | null {
  const prefix = 'em-google-';
  if (!cardId.startsWith(prefix)) return null;
  const id = cardId.slice(prefix.length);
  return /^[a-z0-9-]{1,40}$/.test(id) ? id : null;
}

export async function fetchGoogleCatalog(): Promise<GoogleCatalogProduct[]> {
  const response = await fetch('/api/integrations/google');
  if (!response.ok) return [];
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.products)) return [];
  return payload.products.flatMap((item) => {
    const product = toProduct(item);
    return product ? [product] : [];
  });
}

export async function fetchGooglePreview(productId: string): Promise<GooglePreviewSection[]> {
  const response = await fetch(`/api/integrations/google/${productId}/preview`);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new GoogleClientError(parseApiError(payload), apiErrorMessage(payload));
  if (!isRecord(payload) || !Array.isArray(payload.sections)) {
    throw new GoogleClientError('provider_error', 'Google could not complete the request.');
  }
  return payload.sections.flatMap((section) => {
    if (!isRecord(section) || typeof section.title !== 'string' || !Array.isArray(section.records)) return [];
    return [{
      title: section.title,
      records: section.records.flatMap((record) => {
        if (!isRecord(record) || typeof record.id !== 'string' || typeof record.title !== 'string') return [];
        return [{ id: record.id, title: record.title, detail: typeof record.detail === 'string' ? record.detail : '' }];
      }),
    }];
  });
}

export async function disconnectGoogle(productId: string): Promise<{ grantRevoked: boolean }> {
  const response = await fetch(`/api/integrations/google/${productId}/disconnect`, {
    method: 'POST',
    headers: { 'x-em-request': '1' },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new GoogleClientError(parseApiError(payload), apiErrorMessage(payload));
  return { grantRevoked: isRecord(payload) && payload.grantRevoked === true };
}

function toProduct(value: unknown): GoogleCatalogProduct | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.cardId !== 'string') return null;
  if (value.connectable !== true && value.connected !== true) return null;
  return {
    id: value.id,
    cardId: value.cardId,
    name: value.name,
    description: typeof value.description === 'string' ? value.description : '',
    category: categoryOf(value.category),
    initials: typeof value.initials === 'string' ? value.initials : 'G',
    icon: typeof value.icon === 'string' ? value.icon : 'FileText',
    docsUrl: typeof value.docsUrl === 'string' ? value.docsUrl : '',
    connected: value.connected === true,
    connectable: value.connectable === true,
    email: typeof value.email === 'string' ? value.email : null,
    scopes: Array.isArray(value.scopes) ? value.scopes.filter((scope): scope is string => typeof scope === 'string') : [],
  };
}

function categoryOf(value: unknown): Integration['category'] {
  const categories = ['crm', 'email', 'calendar', 'project', 'files', 'accounting', 'payments', 'hr', 'support', 'marketing', 'ecommerce'] as const;
  return categories.find((category) => category === value) ?? 'files';
}

function apiErrorMessage(payload: unknown): string {
  if (isRecord(payload) && typeof payload.message === 'string' && payload.message.length < 240) return payload.message;
  return 'Google could not complete the request.';
}

function parseApiError(payload: unknown): ApiErrorCode {
  const code = isRecord(payload) && typeof payload.error === 'string' ? payload.error : '';
  return API_ERRORS.find((item) => item === code) ?? 'provider_error';
}

function parseReason(value: string | null): GoogleReturnReason {
  return RETURN_REASONS.find((reason) => reason === value) ?? 'provider_error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}
