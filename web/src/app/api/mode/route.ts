import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUid } from '@/lib/auth';
import { modeOf, setMode } from '@/lib/mode-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  return NextResponse.json({ mode: await modeOf(uid) });
}

const schema = z.object({ mode: z.enum(['auto', 'immo']) });

/** Bascule entre Bon Tracker (voitures) et Bon Tracker Immo. */
export async function PUT(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Mode inconnu' }, { status: 400 });
  await setMode(uid, parsed.data.mode);
  return NextResponse.json({ mode: parsed.data.mode });
}
