import { NextResponse } from 'next/server';
import { isWorkerAuthorized } from '@/lib/auth';
import { claimDueJobs } from '@/lib/watch-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Le collecteur demande quels modèles surveillés relever ; on les lui réserve. */
export async function POST(request: Request) {
  if (!isWorkerAuthorized(request.headers.get('x-worker-token'))) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }
  return NextResponse.json({ jobs: await claimDueJobs() });
}
