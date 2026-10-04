import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWorkerAuthorized } from '@/lib/auth';
import { updateImmoProgress } from '@/lib/immo/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  runId: z.string().max(64).optional(),
  status: z.enum(['running', 'done', 'error']).optional(),
  pages: z.number().int().nonnegative().optional(),
  ads: z.number().int().nonnegative().optional(),
  // Forme du lieu que le site a comprise, apprise à la première page.
  locationParam: z.string().max(200).nullable().optional(),
  error: z.string().max(500).optional(),
  activity: z
    .object({
      step: z.string().max(200),
      recent: z
        .array(
          z.object({
            title: z.string().max(200),
            price: z.number().nonnegative().max(5_000_000),
            surface: z.number().nonnegative().max(100_000).nullable().optional(),
            rooms: z.number().int().nonnegative().max(100).nullable().optional(),
            imageUrl: z.string().max(500).nullable(),
            location: z.string().max(120).nullable(),
          }),
        )
        .max(12),
      total: z.number().int().nonnegative().nullable(),
    })
    .optional(),
});

/** Avancement d'une collecte immobilière, remonté par le collecteur page après page. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isWorkerAuthorized(request.headers.get('x-worker-token'))) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });

  const { id } = await context.params;
  const { found, stop } = await updateImmoProgress(id, parsed.data);
  return found
    ? NextResponse.json({ ok: true, stop })
    : NextResponse.json({ error: 'Collecte inconnue' }, { status: 404 });
}
