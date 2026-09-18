import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/lib/env';
import { createSessionToken, setSessionCookie } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { createUser, findUserByEmail, setLbcSession } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Inscription à partir d'un compte leboncoin.
 *
 * Les identifiants ne sont pas crus sur parole : le collecteur ouvre une
 * vraie session sur le site avec eux. Le compte n'est créé que si elle
 * aboutit, et la session obtenue est conservée pour le premier relevé.
 */
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const limit = checkRateLimit(`register:${ip}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Trop de tentatives. Réessaie dans ${limit.retryAfter} s.` },
      { status: 429 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Adresse ou mot de passe manquant' }, { status: 400 });
  }

  const { email, password } = parsed.data;
  if (await findUserByEmail(email)) {
    return NextResponse.json(
      { error: 'Un compte existe déjà pour cette adresse. Connecte-toi.' },
      { status: 409 },
    );
  }

  let verification: { outcome: string; detail?: string; storageState?: unknown };
  try {
    const response = await fetch(`${env.workerUrl}/verify-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-token': env.workerToken },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(120_000),
    });
    verification = await response.json();
  } catch {
    return NextResponse.json(
      { error: 'Le service de connexion est indisponible. Réessaie dans un instant.' },
      { status: 503 },
    );
  }

  if (verification.outcome !== 'ok') {
    return NextResponse.json({ error: explain(verification.outcome) }, { status: 401 });
  }

  const user = await createUser(email, password);
  if (verification.storageState) {
    await setLbcSession(user.uid, verification.storageState);
  }

  await setSessionCookie(await createSessionToken(user.uid));
  return NextResponse.json({ ok: true });
}

function explain(outcome: string): string {
  switch (outcome) {
    case 'bad_credentials':
      return 'leboncoin a refusé ces identifiants. Vérifie-les sur leboncoin.fr.';
    case 'verification_required':
      return 'leboncoin demande un code de vérification par e-mail. Connecte-toi une fois sur leboncoin.fr, puis réessaie.';
    case 'blocked':
      return 'leboncoin a opposé une vérification anti-robot. Réessaie dans quelques minutes.';
    default:
      return 'La connexion à leboncoin n’a pas abouti. Réessaie plus tard.';
  }
}
