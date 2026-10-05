import { NextResponse } from 'next/server';
import { currentUid } from '@/lib/auth';
import { analyze, describe, estimate, plausible } from '@/lib/immo/estimation';
import { counterpartOf, deleteImmoQuery, getImmoQuery, loadImmoAds, refreshImmoQuery } from '@/lib/immo/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Un marché, avec les biens qui le fondent et le marché d'en face (loyers ou
 * prix de vente) quand il est connu. Avec ?surface=&rooms=, chiffre en plus
 * un bien précis d'après ses comparables.
 */
export async function GET(request: Request, context: Context) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id } = await context.params;
  const query = await getImmoQuery(uid, id);
  if (!query) return NextResponse.json({ error: 'Estimation inconnue' }, { status: 404 });

  const ads = describe(await loadImmoAds(query.adIds), query.transaction);
  const url = new URL(request.url);
  const surface = number(url.searchParams.get('surface'));
  const rooms = number(url.searchParams.get('rooms'));
  const { kept } = plausible(ads, query.transaction);

  const { adIds: _ignored, ...rest } = query;
  return NextResponse.json({
    estimation: rest,
    analysis: analyze(ads, query.transaction),
    ads,
    estimate: surface ? estimate({ surface, rooms }, kept, query.transaction) : null,
    counterpart: await counterpartOf(uid, query),
  });
}

/** Relance la collecte de ce marché. */
export async function POST(_request: Request, context: Context) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { id } = await context.params;
  const query = await refreshImmoQuery(uid, id);
  if (!query) return NextResponse.json({ error: 'Estimation inconnue' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: Context) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { id } = await context.params;
  const ok = await deleteImmoQuery(uid, id);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Estimation inconnue' }, { status: 404 });
}

function number(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
