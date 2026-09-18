import { NextResponse } from 'next/server';
import { getListingDetail } from '@/lib/repo';
import { currentUid } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id } = await context.params;
  const listing = await getListingDetail(uid, id);
  if (!listing) return NextResponse.json({ error: 'Annonce inconnue' }, { status: 404 });
  return NextResponse.json({ listing });
}
