import { NextResponse } from 'next/server';
import { currentUid } from '@/lib/auth';
import { stopImmoQuery } from '@/lib/immo/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Arrête la collecte de ce marché, en gardant ce qui a déjà été lu. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { id } = await context.params;
  const query = await stopImmoQuery(uid, id);
  if (!query) return NextResponse.json({ error: 'Estimation inconnue' }, { status: 404 });
  return NextResponse.json({ ok: true, status: query.status });
}
