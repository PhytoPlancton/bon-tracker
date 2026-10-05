import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWorkerAuthorized } from '@/lib/auth';
import { ingestMarketAds } from '@/lib/market-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const adSchema = z.object({
  lbcId: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  imageUrl: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  sellerType: z.enum(['pro', 'private']).nullable().optional(),
  location: z.string().nullable().optional(),
  // Au-delà, c'est une valeur mal lue, pas un prix d'annonce.
  price: z.number().int().positive().max(5_000_000).nullable(),
  publishedAt: z.string().max(40).nullable().optional(),
  attributes: z.record(z.string().max(120)).optional(),
  // Description du vendeur : entretien, options, défauts. Gardée pour l'export.
  body: z.string().max(2000).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

const schema = z.object({
  // Absente quand l'annonce n'appartient à aucune collecte : lue pour une
  // négociation, ou venue des favoris.
  queryId: z.string().min(1).nullable(),
  ads: z.array(adSchema).max(500),
});

export async function POST(request: Request) {
  if (!isWorkerAuthorized(request.headers.get('x-worker-token'))) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide', details: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }
  const stored = await ingestMarketAds(parsed.data.queryId, parsed.data.ads);
  return NextResponse.json({ ok: true, stored });
}
