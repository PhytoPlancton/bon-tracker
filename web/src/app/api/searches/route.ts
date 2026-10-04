import { NextResponse } from 'next/server';
import { collections } from '@/lib/mongo';
import { currentUid } from '@/lib/auth';
import { isMode, searchMode } from '@/lib/mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const mode = new URL(request.url).searchParams.get('mode');
  const { searches } = await collections();
  const docs = await searches.find({ uid }, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
  return NextResponse.json({
    searches: docs
      .filter((doc) => !isMode(mode) || searchMode(doc.url) === mode)
      .map((doc) => ({
        ...doc,
        lastRunAt: doc.lastRunAt ? doc.lastRunAt.toISOString() : null,
      })),
  });
}
