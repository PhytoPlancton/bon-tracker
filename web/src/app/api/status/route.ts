import { NextResponse } from 'next/server';
import { collections } from '@/lib/mongo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** État de la collecte : dernier passage du worker et présence d'une session. */
export async function GET() {
  const { runs, secrets, listings, searches } = await collections();

  const [lastRun, sessionDoc, activeListings, trackedSearches] = await Promise.all([
    runs.find({}, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(1).next(),
    secrets.findOne({ key: 'lbc_session' }, { projection: { updatedAt: 1 } }),
    listings.countDocuments({ isActive: true }),
    searches.countDocuments({ tracked: true }),
  ]);

  return NextResponse.json({
    lastRun: lastRun
      ? {
          startedAt: lastRun.startedAt.toISOString(),
          finishedAt: lastRun.finishedAt ? lastRun.finishedAt.toISOString() : null,
          status: lastRun.status,
          stats: lastRun.stats,
          error: lastRun.error,
        }
      : null,
    hasSession: Boolean(sessionDoc),
    sessionUpdatedAt: sessionDoc?.updatedAt ? sessionDoc.updatedAt.toISOString() : null,
    activeListings,
    trackedSearches,
  });
}
