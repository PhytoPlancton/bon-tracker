import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWorkerAuthorized } from '@/lib/auth';
import { ingestListings } from '@/lib/repo';
import type { ListingSource } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const listingSchema = z.object({
  lbcId: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  imageUrl: z.string().url().nullable().optional(),
  category: z.string().nullable().optional(),
  sellerType: z.enum(['pro', 'private']).nullable().optional(),
  location: z.string().nullable().optional(),
  price: z.number().int().nonnegative().nullable(),
});

const schema = z.object({
  uid: z.string().min(1),
  source: z.string().regex(/^(favorites|search:[\w-]+)$/),
  listings: z.array(listingSchema).max(1000),
});

export async function POST(request: Request) {
  if (!isWorkerAuthorized(request.headers.get('x-worker-token'))) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide', details: parsed.error.issues }, { status: 400 });
  }

  const result = await ingestListings(
    parsed.data.uid,
    parsed.data.source as ListingSource,
    parsed.data.listings.map((item) => ({ ...item, price: item.price })),
  );

  return NextResponse.json(result);
}
