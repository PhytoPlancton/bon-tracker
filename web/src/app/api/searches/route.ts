import { NextResponse } from 'next/server';
import { collections } from '@/lib/mongo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { searches } = await collections();
  const docs = await searches.find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
  return NextResponse.json({
    searches: docs.map((doc) => ({
      ...doc,
      lastRunAt: doc.lastRunAt ? doc.lastRunAt.toISOString() : null,
    })),
  });
}
