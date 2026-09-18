import { NextResponse } from 'next/server';
import { currentUid } from '@/lib/auth';
import { buildMarket } from '@/lib/market';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  return NextResponse.json({ segments: await buildMarket(uid) });
}
