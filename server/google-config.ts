import { GOOGLE_PRODUCTS } from './google-products.ts';

export const LOCAL_GOOGLE_REDIRECT_URI =
  'http://localhost:5173/api/integrations/google/callback';

export const PRODUCTION_GOOGLE_REDIRECT_URI =
  'https://em.multiplierclub.in/api/integrations/google/callback';

export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  confirmedProducts: readonly string[];
}

export type GoogleConfigState =
  | { status: 'ready'; settings: GoogleSettings }
  | { status: 'absent'; message: string }
  | { status: 'invalid'; message: string };

const PRODUCT_ID = /^[a-z0-9-]{1,40}$/;

export function loadGoogleConfig(env: NodeJS.ProcessEnv, production: boolean): GoogleConfigState {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim() ?? '';
  if (!clientId && !clientSecret && !redirectUri) {
    return {
      status: 'absent',
      message: 'GOOGLE_CLIENT_ID is missing. Set the Google OAuth client in the server environment.',
    };
  }
  if (!clientId) {
    return { status: 'invalid', message: 'GOOGLE_CLIENT_ID is missing. Set it in the server environment.' };
  }
  if (!clientSecret) {
    return { status: 'invalid', message: 'GOOGLE_CLIENT_SECRET is missing. Set it in the server environment.' };
  }
  if (!redirectUri) {
    return { status: 'invalid', message: 'GOOGLE_REDIRECT_URI is missing. Set it in the server environment.' };
  }

  const expected = production ? PRODUCTION_GOOGLE_REDIRECT_URI : LOCAL_GOOGLE_REDIRECT_URI;
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return {
      status: 'invalid',
      message: `GOOGLE_REDIRECT_URI must be ${expected}. The server will not substitute a different callback URL.`,
    };
  }
  if (url.username || url.password || url.search || url.hash || redirectUri !== expected) {
    return {
      status: 'invalid',
      message: `GOOGLE_REDIRECT_URI must be ${expected}. The server will not substitute a different callback URL.`,
    };
  }

  return {
    status: 'ready',
    settings: {
      clientId,
      clientSecret,
      redirectUri,
      confirmedProducts: confirmedProducts(env.GOOGLE_CONFIRMED_PRODUCTS),
    },
  };
}

function confirmedProducts(value: string | undefined): string[] {
  if (!value) return [];
  const known = new Set<string>(
    GOOGLE_PRODUCTS.filter((product) => product.availability === 'confirmable').map((product) => product.id),
  );
  const selected: string[] = [];
  for (const part of value.split(',')) {
    const id = part.trim();
    if (!PRODUCT_ID.test(id) || !known.has(id) || selected.includes(id)) continue;
    selected.push(id);
  }
  return selected;
}
