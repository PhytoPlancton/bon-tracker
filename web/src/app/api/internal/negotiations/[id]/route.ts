import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWorkerAuthorized } from '@/lib/auth';
import { receiveAd } from '@/lib/negotiation-store';

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
  price: z.number().int().positive().max(5_000_000).nullable(),
  publishedAt: z.string().max(40).nullable().optional(),
  attributes: z.record(z.string().max(120)).optional(),
});

const schema = z.object({
  ad: adSchema.nullable(),
  error: z.string().max(500).nullable().optional(),
});

/** L'annonce lue par le collecteur pour une négociation, ou la raison de l'échec. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isWorkerAuthorized(request.headers.get('x-worker-token'))) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  const { id } = await context.params;
  const found = await receiveAd(id, parsed.data.ad, parsed.data.error ?? null);
  return found ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Négociation inconnue' }, { status: 404 });
}
