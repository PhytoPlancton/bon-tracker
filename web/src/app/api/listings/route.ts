import { NextResponse } from 'next/server';
import { listListings } from '@/lib/repo';
import { currentUid } from '@/lib/auth';
import { isMode } from '@/lib/mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const url = new URL(request.url);
  const mode = url.searchParams.get('mode');
  const listings = await listListings(uid, {
    includeInactive: url.searchParams.get('includeInactive') === '1',
    source: url.searchParams.get('source') ?? undefined,
    // Sans mode précisé, tout : c'est ce que voyaient les versions d'avant.
    mode: isMode(mode) ? mode : undefined,
  });
  return NextResponse.json({ listings });
}
