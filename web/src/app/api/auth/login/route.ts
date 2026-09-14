import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { collections } from '@/lib/mongo';
import { createSessionToken, setSessionCookie } from '@/lib/auth';
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit';
import { ensureAdminUser } from '@/lib/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

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

  await ensureAdminUser();

  const { users } = await collections();
  const user = await users.findOne({ email: parsed.data.email.toLowerCase() });

  // Hash factice pour que la réponse prenne le même temps qu'un compte existant.
  const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(parsed.data.password, hash);

  if (!user || !ok) {
    return NextResponse.json({ error: 'Identifiants incorrects' }, { status: 401 });
  }

  resetRateLimit(`login:${ip}`);
  await setSessionCookie(await createSessionToken(user.email));
  return NextResponse.json({ ok: true });
}
