import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWorkerAuthorized } from '@/lib/auth';
import { abandonImmoQueries } from '@/lib/immo/store';
import { abandonQueries } from '@/lib/market-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ before: z.string().datetime() });

/**
 * Appelé par le collecteur à son démarrage : ce qu'il faisait avant est
 * perdu, voitures comme immobilier.
 */
export async function POST(request: Request) {
  if (!isWorkerAuthorized(request.headers.get('x-worker-token'))) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  const before = new Date(parsed.data.before);
  const abandoned = (await abandonQueries(before)) + (await abandonImmoQueries(before));
  return NextResponse.json({ ok: true, abandoned });
}
