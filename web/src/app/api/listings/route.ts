import { NextResponse } from 'next/server';
import { listListings } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const listings = await listListings({
    includeInactive: url.searchParams.get('includeInactive') === '1',
    source: url.searchParams.get('source') ?? undefined,
  });
  return NextResponse.json({ listings });
}
