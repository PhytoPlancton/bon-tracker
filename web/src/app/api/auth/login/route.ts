import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSessionToken, setSessionCookie } from '@/lib/auth';
import { clientIp, explainRefusal, verifyWithLeboncoin } from '@/lib/lbc-verify';
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit';
import { findUserByEmail, setLbcSession, updateLbcPassword, verifyPassword } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

/**
 * Connexion avec l'adresse et le mot de passe du compte leboncoin.
 *
 * Un même message pour « pas de compte » et « mauvais mot de passe » laissait
 * chercher l'erreur au mauvais endroit : on dit lequel des deux. Et puisque
 * l'écran demande le mot de passe leboncoin, c'est leboncoin qui tranche
 * quand il diffère de celui enregistré — changé sur le site depuis
 * l'inscription, le plus souvent.
 */
export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = checkRateLimit(`login:${ip}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Trop de tentatives. Réessaie dans ${Math.ceil(limit.retryAfter / 60)} min.` },
      { status: 429 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Adresse ou mot de passe manquant' }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const user = await findUserByEmail(email);
  if (!user) {
    return NextResponse.json(
      {
        error: 'Aucun compte Bon Tracker pour cette adresse. Vérifie qu’elle est bien celle de ton compte leboncoin, ou crée ton compte.',
        code: 'no_account',
      },
      { status: 401 },
    );
  }

  if (!(await verifyPassword(user, password))) {
    const verification = await verifyWithLeboncoin(user.email, password);
    if (!verification) {
      return NextResponse.json(
        { error: 'Mot de passe différent de celui enregistré, et leboncoin injoignable pour le vérifier. Réessaie dans quelques minutes.' },
        { status: 503 },
      );
    }
    if (verification.outcome !== 'ok') {
      return NextResponse.json({ error: explainRefusal(verification.outcome) }, { status: 401 });
    }
    // leboncoin l'accepte : c'est le nouveau mot de passe du compte.
    await updateLbcPassword(user.uid, password);
    if (verification.storageState) await setLbcSession(user.uid, verification.storageState);
  }

  resetRateLimit(`login:${ip}`);
  await setSessionCookie(await createSessionToken(user.uid));
  return NextResponse.json({ ok: true });
}
