import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SESSION_COOKIE = 'bt_session';

/** Chemins accessibles sans session applicative. */
const PUBLIC_PATHS = [
  '/login',
  '/inscription',
  '/api/auth/login',
  '/api/auth/register',
  '/manifest.webmanifest',
  '/sw.js',
  '/icons',
  '/favicon.ico',
];

// Le worker s'authentifie par jeton dédié, vérifié dans chaque route interne.
const WORKER_PREFIX = '/api/internal';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith(WORKER_PREFIX)) return NextResponse.next();
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const valid = token ? await isValid(token) : false;

  if (valid) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

async function isValid(token: string): Promise<boolean> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
