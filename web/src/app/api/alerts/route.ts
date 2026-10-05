import { NextResponse } from 'next/server';
import { currentUid } from '@/lib/auth';
import { countUnread, listAlerts } from '@/lib/watch-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  // La barre de navigation ne veut que le compte des non-lues.
  if (new URL(request.url).searchParams.has('compter')) return NextResponse.json({ unread: await countUnread(uid) });
  return NextResponse.json(await listAlerts(uid));
}
