import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'em_session';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const SESSION_ROTATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SessionPayload {
  sid: string;
  iat: number;
  exp: number;
}

export function createSessionId(): string {
  return randomUUID();
}

export function createOauthState(): string {
  return randomBytes(32).toString('base64url');
}

export function signSession(
  payload: SessionPayload,
  secret: Buffer,
): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifySessionToken(
  token: string,
  secret: Buffer,
  now: number,
): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isSessionPayload(parsed)) return null;
  if (parsed.exp <= now || parsed.iat > now) return null;
  return parsed;
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function serializeSessionCookie(
  token: string,
  options: { production: boolean; maxAgeSeconds: number },
): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.production) attributes.push('Secure');
  return attributes.join('; ');
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<SessionPayload>;
  return (
    typeof payload.sid === 'string' &&
    UUID_PATTERN.test(payload.sid) &&
    typeof payload.iat === 'number' &&
    Number.isFinite(payload.iat) &&
    typeof payload.exp === 'number' &&
    Number.isFinite(payload.exp)
  );
}
