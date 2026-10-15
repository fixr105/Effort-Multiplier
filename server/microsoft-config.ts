import { MICROSOFT_PRODUCTS } from './microsoft-products.ts';

export const LOCAL_MICROSOFT_REDIRECT_URI =
  'http://localhost:5173/api/integrations/microsoft/callback';

export const PRODUCTION_MICROSOFT_REDIRECT_URI =
  'https://em.multiplierclub.in/api/integrations/microsoft/callback';

const TENANT_PATTERN =
  /^(common|organizations|consumers|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface MicrosoftSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenant: string;
  confirmedProducts: readonly string[];
}

export type MicrosoftConfigState =
  | { status: 'ready'; settings: MicrosoftSettings }
  | { status: 'absent'; message: string }
  | { status: 'invalid'; message: string };

const PRODUCT_ID = /^[a-z0-9-]{1,40}$/;

export function loadMicrosoftConfig(env: NodeJS.ProcessEnv, production: boolean): MicrosoftConfigState {
  const clientId = env.MICROSOFT_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.MICROSOFT_CLIENT_SECRET?.trim() ?? '';
  const redirectUri = env.MICROSOFT_REDIRECT_URI?.trim() ?? '';
  const tenant = env.MICROSOFT_TENANT?.trim() ?? '';
  if (!clientId && !clientSecret && !redirectUri && !tenant) {
    return {
      status: 'absent',
      message: 'MICROSOFT_CLIENT_ID is missing. Set the Microsoft Entra app in the server environment.',
    };
  }
  if (!clientId) return { status: 'invalid', message: 'MICROSOFT_CLIENT_ID is missing. Set it in the server environment.' };
  if (!clientSecret) return { status: 'invalid', message: 'MICROSOFT_CLIENT_SECRET is missing. Set it in the server environment.' };
  if (!redirectUri) return { status: 'invalid', message: 'MICROSOFT_REDIRECT_URI is missing. Set it in the server environment.' };
  if (!TENANT_PATTERN.test(tenant)) {
    return {
      status: 'invalid',
      message: 'MICROSOFT_TENANT must be common, organizations, consumers, or a tenant id.',
    };
  }

  const expected = production ? PRODUCTION_MICROSOFT_REDIRECT_URI : LOCAL_MICROSOFT_REDIRECT_URI;
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return {
      status: 'invalid',
      message: `MICROSOFT_REDIRECT_URI must be ${expected}. The server will not substitute a different callback URL.`,
    };
  }
  if (url.username || url.password || url.search || url.hash || redirectUri !== expected) {
    return {
      status: 'invalid',
      message: `MICROSOFT_REDIRECT_URI must be ${expected}. The server will not substitute a different callback URL.`,
    };
  }

  return {
    status: 'ready',
    settings: {
      clientId,
      clientSecret,
      redirectUri,
      tenant,
      confirmedProducts: confirmedProducts(env.MICROSOFT_CONFIRMED_PRODUCTS),
    },
  };
}

function confirmedProducts(value: string | undefined): string[] {
  if (!value) return [];
  const known = new Set<string>(
    MICROSOFT_PRODUCTS.filter((product) => product.availability === 'confirmable').map((product) => product.id),
  );
  const selected: string[] = [];
  for (const part of value.split(',')) {
    const id = part.trim();
    if (!PRODUCT_ID.test(id) || !known.has(id) || selected.includes(id)) continue;
    selected.push(id);
  }
  return selected;
}
