import { NextResponse } from 'next/server';
import { collections } from '@/lib/mongo';
import { currentUid } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searches } = await collections();
  const docs = await searches.find({ uid }, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
  return NextResponse.json({
    searches: docs.map((doc) => ({
      ...doc,
      lastRunAt: doc.lastRunAt ? doc.lastRunAt.toISOString() : null,
    })),
  });
}
