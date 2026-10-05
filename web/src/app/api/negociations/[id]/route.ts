import { NextResponse } from 'next/server';
import { currentUid } from '@/lib/auth';
import { deleteNegotiation, getNegotiation } from '@/lib/negotiation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { id } = await context.params;
  const view = await getNegotiation(uid, id);
  if (!view) return NextResponse.json({ error: 'Négociation inconnue' }, { status: 404 });
  return NextResponse.json(view);
}

export async function DELETE(_request: Request, context: Context) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { id } = await context.params;
  return (await deleteNegotiation(uid, id))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Négociation inconnue' }, { status: 404 });
}
