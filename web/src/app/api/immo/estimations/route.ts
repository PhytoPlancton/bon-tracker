import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUid } from '@/lib/auth';
import { createImmoQuery, listImmoQueries } from '@/lib/immo/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  return NextResponse.json({ estimations: await listImmoQueries(uid) });
}

const placeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // Code INSEE (2A et 2B pour la Corse), ou code postal seul quand le
  // référentiel des communes était injoignable.
  code: z.string().regex(/^(\d{5}|2[AB]\d{3}|cp-\d{5})$/),
  postalCodes: z.array(z.string().regex(/^\d{5}$/)).min(1).max(50),
  department: z.string().regex(/^(\d{2,3}|2[AB])$/),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
});

const schema = z.object({
  transaction: z.enum(['vente', 'location']),
  propertyType: z.enum(['appartement', 'maison']),
  place: placeSchema,
  radiusKm: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(20)]),
  surface: z
    .union([z.number().int().min(9).max(1000), z.null()])
    .optional()
    .transform((value) => value ?? null),
});

/** Demande l'estimation d'un marché : réutilise une collecte récente ou en lance une. */
export async function POST(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choisis une commune dans la liste, et une surface entre 9 et 1 000 m².' }, { status: 400 });
  }
  // Sans centre connu, impossible de chercher autour : la commune seule.
  const { place } = parsed.data;
  if (parsed.data.radiusKm > 0 && (place.lat === null || place.lng === null)) {
    return NextResponse.json({ error: 'Pour chercher autour, choisis une commune dans la liste.' }, { status: 400 });
  }

  const outcome = await createImmoQuery(uid, parsed.data);
  if (outcome.kind === 'too_many') {
    return NextResponse.json(
      { error: 'Trois estimations sont déjà en cours. Attends qu’une se termine.' },
      { status: 429 },
    );
  }
  return NextResponse.json({ id: outcome.query.id, reused: outcome.kind === 'reused' });
}
