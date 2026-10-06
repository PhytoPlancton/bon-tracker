import { currentUid } from '@/lib/auth';
import { adsCsv, exportFilename, summaryCsv } from '@/lib/market-export';
import { harmonize } from '@/lib/estimation';
import { getQuery, loadAds, loadGoneAds } from '@/lib/market-store';
import { collections } from '@/lib/mongo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Télécharge une estimation en CSV : ?quoi=annonces (par défaut) pour une
 * ligne par annonce, ?quoi=synthese pour les chiffres par motorisation.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const uid = await currentUid();
  if (!uid) return Response.json({ error: 'Non authentifié' }, { status: 401 });

  const { id } = await context.params;
  const query = await getQuery(uid, id);
  if (!query) return Response.json({ error: 'Estimation inconnue' }, { status: 404 });

  const { marketAds } = await collections();
  const docs = await marketAds.find({ lbcId: { $in: query.adIds } }, { projection: { _id: 0 } }).toArray();

  const kind = new URL(request.url).searchParams.get('quoi') === 'synthese' ? 'synthese' : 'annonces';
  const now = new Date();
  let csv: string;
  if (kind === 'synthese') {
    csv = summaryCsv(docs, now);
  } else {
    // Les annonces parties servent à repérer les republications.
    const live = await loadAds(query.adIds);
    const goneRaw = await loadGoneAds(query.codes);
    const gone = harmonize([...live, ...goneRaw]).slice(live.length) as typeof goneRaw;
    csv = adsCsv(docs, now, gone);
  }

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFilename(query, kind, now)}"`,
      'cache-control': 'no-store',
    },
  });
}
