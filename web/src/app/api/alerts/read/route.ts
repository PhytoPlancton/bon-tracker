import { NextResponse } from 'next/server';
import { currentUid } from '@/lib/auth';
import { markAlertsRead } from '@/lib/watch-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  await markAlertsRead(uid);
  return NextResponse.json({ ok: true });
}
