import { NextResponse } from 'next/server';
import { getListingDetail } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const listing = await getListingDetail(id);
  if (!listing) return NextResponse.json({ error: 'Annonce inconnue' }, { status: 404 });
  return NextResponse.json({ listing });
}
