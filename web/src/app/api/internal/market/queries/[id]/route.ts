import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWorkerAuthorized } from '@/lib/auth';
import { collections } from '@/lib/mongo';
import { updateQueryProgress } from '@/lib/market-store';
import { evaluateWatchesFor } from '@/lib/watch-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  runId: z.string().max(64).optional(),
  status: z.enum(['running', 'done', 'error']).optional(),
  pages: z.number().int().nonnegative().optional(),
  ads: z.number().int().nonnegative().optional(),
  codes: z.object({ brand: z.string(), model: z.string() }).nullable().optional(),
  error: z.string().max(500).optional(),
  mode: z.enum(['full', 'fresh']).optional(),
  activity: z
    .object({
      step: z.string().max(200),
      recent: z
        .array(
          z.object({
            title: z.string().max(200),
            price: z.number().nonnegative().max(5_000_000),
            km: z.number().nonnegative().nullable(),
            year: z.number().int().nullable(),
            imageUrl: z.string().max(500).nullable(),
            location: z.string().max(120).nullable(),
          }),
        )
        .max(12),
      total: z.number().int().nonnegative().nullable(),
    })
    .optional(),
});

/** Avancement d'une collecte, remonté par le collecteur page après page. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isWorkerAuthorized(request.headers.get('x-worker-token'))) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });

  const { id } = await context.params;
  const { found, stop } = await updateQueryProgress(id, parsed.data);

  // Un relevé terminé, c'est peut-être une affaire qui vient d'arriver :
  // les veilles de ce modèle sont aussitôt appliquées.
  if (found && parsed.data.status === 'done') {
    const { marketQueries } = await collections();
    const query = await marketQueries.findOne({ id }, { projection: { key: 1 } });
    if (query) await evaluateWatchesFor(query.key).catch((error) => console.warn('[veille]', error));
  }

  return found
    ? NextResponse.json({ ok: true, stop })
    : NextResponse.json({ error: 'Collecte inconnue' }, { status: 404 });
}
