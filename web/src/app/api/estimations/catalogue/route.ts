import { NextResponse } from 'next/server';
import { currentUid } from '@/lib/auth';
import { catalogue } from '@/lib/market-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Marques et modèles déjà rencontrés, pour guider la saisie. */
export async function GET() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  return NextResponse.json({ brands: await catalogue() });
}
