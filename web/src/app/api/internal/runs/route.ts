import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWorkerAuthorized } from '@/lib/auth';
import { collections } from '@/lib/mongo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  uid: z.string().min(1),
  startedAt: z.string().datetime(),
  status: z.enum(['ok', 'error', 'needs_session']),
  stats: z.object({
    seen: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    priceChanges: z.number().int().nonnegative(),
    deactivated: z.number().int().nonnegative(),
  }),
  error: z.string().max(2000).nullable(),
  trackedSearchIds: z.array(z.string()).optional(),
});

/** Journal d'exécution du worker, affiché dans l'app pour savoir si ça tourne. */
export async function POST(request: Request) {
  if (!isWorkerAuthorized(request.headers.get('x-worker-token'))) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });

  const { runs, searches } = await collections();
  const now = new Date();

  await runs.insertOne({
    uid: parsed.data.uid,
    startedAt: new Date(parsed.data.startedAt),
    finishedAt: now,
    status: parsed.data.status,
    stats: parsed.data.stats,
    error: parsed.data.error,
  });

  if (parsed.data.trackedSearchIds?.length) {
    await searches.updateMany(
      { uid: parsed.data.uid, lbcSearchId: { $in: parsed.data.trackedSearchIds } },
      { $set: { lastRunAt: now } },
    );
  }

  // Le journal n'a d'intérêt que récent : on garde une fenêtre glissante.
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  await runs.deleteMany({ startedAt: { $lt: cutoff } });

  return NextResponse.json({ ok: true });
}
