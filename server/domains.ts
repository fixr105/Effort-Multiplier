/**
 * Official Zoho Accounts and CRM API origins.
 * Token exchange uses the accounts-server Zoho returns, after this allowlist check.
 * CRM calls use the api_domain Zoho returns, after the API allowlist check.
 * Regional hosts are not guessed from a country code.
 */

const ACCOUNTS_ORIGINS = new Set([
  'https://accounts.zoho.com',
  'https://accounts.zoho.eu',
  'https://accounts.zoho.in',
  'https://accounts.zoho.com.au',
  'https://accounts.zoho.jp',
  'https://accounts.zoho.com.cn',
  'https://accounts.zoho.sa',
  'https://accounts.zohocloud.ca',
]);

const API_ORIGINS = new Set([
  'https://www.zohoapis.com',
  'https://www.zohoapis.eu',
  'https://www.zohoapis.in',
  'https://www.zohoapis.com.au',
  'https://www.zohoapis.jp',
  'https://www.zohoapis.com.cn',
  'https://www.zohoapis.sa',
  'https://www.zohoapis.ca',
  'https://sandbox.zohoapis.com',
  'https://sandbox.zohoapis.eu',
  'https://sandbox.zohoapis.in',
  'https://sandbox.zohoapis.com.au',
  'https://sandbox.zohoapis.jp',
  'https://sandbox.zohoapis.com.cn',
  'https://sandbox.zohoapis.sa',
  'https://sandbox.zohoapis.ca',
  'https://developer.zohoapis.com',
  'https://developer.zohoapis.eu',
  'https://developer.zohoapis.in',
  'https://developer.zohoapis.com.au',
  'https://developer.zohoapis.jp',
  'https://developer.zohoapis.com.cn',
  'https://developer.zohoapis.sa',
  'https://developer.zohoapis.ca',
]);

export type DomainFailure = 'invalid_accounts_server' | 'invalid_api_domain';

export class DomainError extends Error {
  readonly kind: DomainFailure;

  constructor(kind: DomainFailure) {
    super(kind);
    this.kind = kind;
  }
}

export function assertAccountsOrigin(value: string): string {
  return assertOrigin(value, ACCOUNTS_ORIGINS, 'invalid_accounts_server');
}

export function assertApiOrigin(value: string): string {
  return assertOrigin(value, API_ORIGINS, 'invalid_api_domain');
}

const DESK_ORIGINS: Record<string, string> = {
  'https://www.zohoapis.com': 'https://desk.zoho.com',
  'https://www.zohoapis.eu': 'https://desk.zoho.eu',
  'https://www.zohoapis.in': 'https://desk.zoho.in',
  'https://www.zohoapis.com.au': 'https://desk.zoho.com.au',
  'https://www.zohoapis.jp': 'https://desk.zoho.jp',
  'https://www.zohoapis.sa': 'https://desk.zoho.sa',
  'https://www.zohoapis.ca': 'https://desk.zohocloud.ca',
};

const PEOPLE_ORIGINS: Record<string, string> = {
  'https://www.zohoapis.com': 'https://people.zoho.com',
  'https://www.zohoapis.eu': 'https://people.zoho.eu',
  'https://www.zohoapis.in': 'https://people.zoho.in',
  'https://www.zohoapis.com.au': 'https://people.zoho.com.au',
  'https://www.zohoapis.jp': 'https://people.zoho.jp',
  'https://www.zohoapis.sa': 'https://people.zoho.sa',
  'https://www.zohoapis.ca': 'https://people.zohocloud.ca',
};

export function serviceOrigin(apiOrigin: string, service: 'desk' | 'people'): string {
  const origin = assertApiOrigin(apiOrigin);
  const mapped = service === 'desk' ? DESK_ORIGINS[origin] : PEOPLE_ORIGINS[origin];
  if (!mapped) throw new DomainError('invalid_api_domain');
  return mapped;
}

function assertOrigin(
  value: string,
  allowlist: Set<string>,
  kind: DomainFailure,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainError(kind);
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new DomainError(kind);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new DomainError(kind);
  }
  if (!allowlist.has(url.origin)) {
    throw new DomainError(kind);
  }
  return url.origin;
}
