import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env';

export const SESSION_COOKIE = 'bt_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 jours : usage perso, mobile

function secret(): Uint8Array {
  return new TextEncoder().encode(env.sessionSecret);
}

export async function createSessionToken(uid: string): Promise<string> {
  return new SignJWT({ sub: uid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

/** Identifiant de l'utilisateur connecté, lu depuis le cookie de session. */
export async function currentUid(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

/**
 * Identifiant de l'utilisateur, ou une réponse 401 à renvoyer telle quelle.
 * Le middleware protège déjà ces routes ; ceci garantit qu'aucune requête ne
 * s'exécute sans propriétaire, même si un chemin lui échappait.
 */
export async function requireUid(): Promise<string | null> {
  return currentUid();
}

/** Compare le jeton du worker en temps constant. */
export function isWorkerAuthorized(header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(env.workerToken);
  const received = Buffer.from(header);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
