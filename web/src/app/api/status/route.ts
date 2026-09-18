import { NextResponse } from 'next/server';
import { collections } from '@/lib/mongo';
import { currentUid } from '@/lib/auth';
import { findUserByUid } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** État de la collecte : dernier passage du worker et présence d'une session. */
export async function GET() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { runs, listings, searches } = await collections();

  const [lastRun, user, activeListings, trackedSearches] = await Promise.all([
    runs.find({ uid }, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(1).next(),
    findUserByUid(uid),
    listings.countDocuments({ uid, isActive: true }),
    searches.countDocuments({ uid, tracked: true }),
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
    hasSession: Boolean(user?.lbcSession),
    sessionUpdatedAt: user?.lbcCheckedAt ? user.lbcCheckedAt.toISOString() : null,
    lbcStatus: user?.lbcStatus ?? 'needs_login',
    email: user?.email ?? null,
    activeListings,
    trackedSearches,
  });
}
