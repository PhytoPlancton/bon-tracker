import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSessionToken, setSessionCookie } from '@/lib/auth';
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit';
import { findUserByEmail, verifyPassword } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Connexion avec l'adresse et le mot de passe du compte leboncoin. */
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const limit = checkRateLimit(`login:${ip}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Trop de tentatives. Réessaie dans ${limit.retryAfter} s.` },
      { status: 429 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const user = await findUserByEmail(parsed.data.email);
  if (!(await verifyPassword(user, parsed.data.password))) {
    return NextResponse.json({ error: 'Identifiants incorrects' }, { status: 401 });
  }

  resetRateLimit(`login:${ip}`);
  await setSessionCookie(await createSessionToken(user!.uid));
  return NextResponse.json({ ok: true });
}
