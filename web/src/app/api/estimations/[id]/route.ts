import { NextResponse } from 'next/server';
import { currentUid } from '@/lib/auth';
import { analyze, estimate, harmonize, plausible } from '@/lib/estimation';
import { deleteQuery, getQuery, loadAds, refreshQuery } from '@/lib/market-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Une estimation, avec les annonces qui la fondent. Avec ?km=&year=, calcule
 * en plus la valeur d'une voiture précise d'après ses comparables.
 */
export async function GET(request: Request, context: Context) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id } = await context.params;
  const query = await getQuery(uid, id);
  if (!query) return NextResponse.json({ error: 'Estimation inconnue' }, { status: 404 });

  const ads = harmonize(await loadAds(query.adIds));
  const { kept } = plausible(ads);

  const url = new URL(request.url);
  const km = number(url.searchParams.get('km'));
  const year = number(url.searchParams.get('year'));
  const version = url.searchParams.get('version') || null;

  const target = km !== null || year !== null ? { km, year, version } : null;

  const { adIds: _ignored, ...rest } = query;
  return NextResponse.json({
    estimation: rest,
    analysis: analyze(ads),
    ads,
    estimate: target ? estimate(target, kept) : null,
  });
}

/** Relance la collecte de ce modèle. */
export async function POST(_request: Request, context: Context) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { id } = await context.params;
  const query = await refreshQuery(uid, id);
  if (!query) return NextResponse.json({ error: 'Estimation inconnue' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: Context) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { id } = await context.params;
  const ok = await deleteQuery(uid, id);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Estimation inconnue' }, { status: 404 });
}

function number(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[^\d]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
