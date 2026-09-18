import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWorkerAuthorized } from '@/lib/auth';
import { setLbcSession, setLbcStatus, usersToCollect } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function guard(request: Request) {
  return isWorkerAuthorized(request.headers.get('x-worker-token'));
}

/**
 * Comptes à relever, avec de quoi ouvrir leur session.
 *
 * Cette réponse contient des mots de passe déchiffrés : elle n'est servie
 * qu'au collecteur, sur le réseau interne, et jamais exposée au dehors.
 */
export async function GET(request: Request) {
  if (!guard(request)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  return NextResponse.json({ users: await usersToCollect() });
}

const schema = z.object({
  uid: z.string().min(1),
  storageState: z.record(z.unknown()).nullable().optional(),
  status: z.enum(['ok', 'needs_login', 'blocked', 'verification_required']).optional(),
});

/** Le collecteur range la session fraîche d'un compte, ou signale son état. */
export async function PUT(request: Request) {
  if (!guard(request)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });

  if (parsed.data.storageState) {
    await setLbcSession(parsed.data.uid, parsed.data.storageState);
  } else if (parsed.data.status) {
    await setLbcStatus(parsed.data.uid, parsed.data.status);
  }

  return NextResponse.json({ ok: true });
}
