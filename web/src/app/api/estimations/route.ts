import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUid } from '@/lib/auth';
import { createQuery, listQueries } from '@/lib/market-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  return NextResponse.json({ estimations: await listQueries(uid) });
}

const year = z
  .union([z.number().int().min(1900).max(2100), z.null()])
  .optional()
  .transform((value) => value ?? null);

const power = z
  .union([z.number().int().min(1).max(1999), z.null()])
  .optional()
  .transform((value) => value ?? null);

const schema = z.object({
  brand: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(60),
  yearMin: year,
  yearMax: year,
  powerMin: power,
  powerMax: power,
});

/** Demande l'estimation d'un modèle : réutilise une collecte récente ou en lance une. */
export async function POST(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Indique au moins une marque et un modèle.' }, { status: 400 });
  }
  if (parsed.data.yearMin && parsed.data.yearMax && parsed.data.yearMin > parsed.data.yearMax) {
    return NextResponse.json({ error: 'L’année de début dépasse celle de fin.' }, { status: 400 });
  }
  if (parsed.data.powerMin && parsed.data.powerMax && parsed.data.powerMin > parsed.data.powerMax) {
    return NextResponse.json({ error: 'La puissance mini dépasse la maxi.' }, { status: 400 });
  }

  const outcome = await createQuery(uid, parsed.data);
  if (outcome.kind === 'too_many') {
    return NextResponse.json(
      { error: 'Trois estimations sont déjà en cours. Attends qu’une se termine.' },
      { status: 429 },
    );
  }

  return NextResponse.json({ id: outcome.query.id, reused: outcome.kind === 'reused' });
}
