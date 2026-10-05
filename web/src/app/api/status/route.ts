import { NextResponse } from 'next/server';
import { collections } from '@/lib/mongo';
import { currentUid } from '@/lib/auth';
import { isMode, listingModeFilter, searchMode } from '@/lib/mode';
import { findUserByUid } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** État de la collecte : dernier passage du worker et présence d'une session. */
export async function GET(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  // Les compteurs suivent le mode affiché ; le relevé, lui, couvre tout.
  const requested = new URL(request.url).searchParams.get('mode');
  const mode = isMode(requested) ? requested : null;
  const { runs, listings, searches } = await collections();

  const [lastRun, user, activeListings, tracked] = await Promise.all([
    runs.find({ uid }, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(1).next(),
    findUserByUid(uid),
    listings.countDocuments({ uid, isActive: true, ...(mode ? listingModeFilter(mode) : {}) }),
    searches.find({ uid, tracked: true }, { projection: { _id: 0, url: 1 } }).toArray(),
  ]);
  const trackedSearches = tracked.filter((search) => !mode || searchMode(search.url) === mode).length;

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
