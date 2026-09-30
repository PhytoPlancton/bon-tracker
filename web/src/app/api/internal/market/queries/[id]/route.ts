import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWorkerAuthorized } from '@/lib/auth';
import { updateQueryProgress } from '@/lib/market-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  status: z.enum(['running', 'done', 'error']).optional(),
  pages: z.number().int().nonnegative().optional(),
  ads: z.number().int().nonnegative().optional(),
  codes: z.object({ brand: z.string(), model: z.string() }).nullable().optional(),
  error: z.string().max(500).optional(),
});

/** Avancement d'une collecte, remonté par le collecteur page après page. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isWorkerAuthorized(request.headers.get('x-worker-token'))) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });

  const { id } = await context.params;
  const found = await updateQueryProgress(id, parsed.data);
  return found
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Collecte inconnue' }, { status: 404 });
}
