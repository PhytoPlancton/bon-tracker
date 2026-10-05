import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUid } from '@/lib/auth';
import { listNegotiations, startNegotiation } from '@/lib/negotiation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  return NextResponse.json({ negotiations: await listNegotiations(uid) });
}

/** Négocier une annonce : son lien leboncoin, ou son numéro. */
export async function POST(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const parsed = z.object({ annonce: z.string().min(6).max(500) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Colle le lien de l’annonce.' }, { status: 400 });

  const outcome = await startNegotiation(uid, parsed.data.annonce);
  if (outcome.kind === 'invalid') {
    return NextResponse.json(
      { error: 'Ce n’est pas un lien d’annonce leboncoin (il ressemble à leboncoin.fr/ad/voitures/1234567890).' },
      { status: 400 },
    );
  }
  if (outcome.kind === 'error') return NextResponse.json({ error: outcome.message }, { status: 409 });
  return NextResponse.json({ id: outcome.negotiation.id, status: outcome.negotiation.status });
}
