import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUid } from '@/lib/auth';
import { deleteWatch, setWatchActive } from '@/lib/watch-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Mettre une veille en pause, ou la relancer. */
export async function PATCH(request: Request, context: Context) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const parsed = z.object({ active: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  const { id } = await context.params;
  return (await setWatchActive(uid, id, parsed.data.active))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Veille inconnue' }, { status: 404 });
}

export async function DELETE(_request: Request, context: Context) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { id } = await context.params;
  return (await deleteWatch(uid, id))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Veille inconnue' }, { status: 404 });
}
