import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUid } from '@/lib/auth';
import { createWatch, listWatches, MAX_WATCHES, THRESHOLDS } from '@/lib/watch-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  return NextResponse.json({ watches: await listWatches(uid) });
}

const optionalText = z
  .string()
  .trim()
  .max(80)
  .nullable()
  .optional()
  .transform((value) => value || null);
const optionalNumber = z
  .number()
  .int()
  .positive()
  .max(5_000_000)
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const schema = z.object({
  queryId: z.string().min(1),
  version: optionalText,
  gearbox: optionalText,
  kmMax: optionalNumber,
  priceMax: optionalNumber,
  threshold: z
    .number()
    .refine((value) => THRESHOLDS.some((allowed) => Math.abs(allowed - value) < 1e-9), 'Seuil inconnu'),
});

/** Surveiller une estimation : être prévenu des voitures qui sortent sous leurs comparables. */
export async function POST(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Veille incomplète.' }, { status: 400 });

  const outcome = await createWatch(uid, parsed.data);
  if (outcome.kind === 'unknown_query') {
    return NextResponse.json({ error: 'Estimation inconnue' }, { status: 404 });
  }
  if (outcome.kind === 'too_many') {
    return NextResponse.json(
      { error: `${MAX_WATCHES} veilles au plus : supprime-en une avant d’en créer une autre.` },
      { status: 429 },
    );
  }
  return NextResponse.json({ watch: outcome.watch, initial: outcome.initial });
}
