import { NextResponse } from 'next/server';
import { listListings } from '@/lib/repo';
import { currentUid } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const url = new URL(request.url);
  const listings = await listListings(uid, {
    includeInactive: url.searchParams.get('includeInactive') === '1',
    source: url.searchParams.get('source') ?? undefined,
  });
  return NextResponse.json({ listings });
}
