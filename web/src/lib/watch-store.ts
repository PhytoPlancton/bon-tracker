import { randomUUID } from 'node:crypto';
import { collections } from './mongo';
import { estimate, plausible, screen, suspects, SUSPICIOUS_FLAG, type Ad } from './estimation';
import { loadAds } from './market-store';
import { sendToUser } from './push';
import type { Alert, MarketQuery, Watch } from './types';

/**
 * Veilles : surveiller un modèle et être prévenu dès qu'une voiture sort
 * nettement sous le prix de ses comparables.
 *
 * Une annonce est jugée comme ailleurs dans l'application : face aux voitures
 * du même moteur, d'années et de kilométrages proches. Une veille ne fait que
 * répéter ce jugement à chaque relevé et retenir ce qu'elle a déjà signalé.
 */

/** Un modèle surveillé est relu toutes les deux heures environ. */
const FRESH_EVERY = 2 * 60 * 60 * 1000;
/** Au-delà, les annonces vendues encombrent : on relit tout le modèle. */
const FULL_EVERY = 22 * 60 * 60 * 1000;
/** Modèles relevés par passage du collecteur : chacun l'occupe une minute. */
const CLAIM_LIMIT = 3;
/** Une annonce déjà signalée ne l'est de nouveau que si elle a encore baissé. */
const NEW_DROP = 0.02;
/** Plus de veilles ne rendrait pas service : le collecteur ne suivrait plus. */
export const MAX_WATCHES = 10;

export const THRESHOLDS = [0.1, 0.15, 0.2] as const;

export interface WatchInput {
  queryId: string;
  version: string | null;
  gearbox: string | null;
  kmMax: number | null;
  priceMax: number | null;
  threshold: number;
}

export type CreateWatchOutcome =
  | { kind: 'created'; watch: Watch; initial: number }
  | { kind: 'unknown_query' }
  | { kind: 'too_many' };

export async function createWatch(uid: string, input: WatchInput): Promise<CreateWatchOutcome> {
  const { watches, marketQueries } = await collections();
  const query = await marketQueries.findOne({ uid, id: input.queryId }, { projection: { _id: 0 } });
  if (!query) return { kind: 'unknown_query' };
  if ((await watches.countDocuments({ uid })) >= MAX_WATCHES) return { kind: 'too_many' };

  const watch: Watch = {
    id: randomUUID(),
    uid,
    queryId: query.id,
    key: query.key,
    label: labelOf(query, input),
    version: input.version,
    gearbox: input.gearbox,
    kmMax: input.kmMax,
    priceMax: input.priceMax,
    threshold: input.threshold,
    active: true,
    createdAt: new Date(),
    checkedAt: null,
  };
  await watches.insertOne(watch);

  // Les affaires déjà en ligne sont listées tout de suite, sans notification :
  // seules celles qui arrivent ensuite méritent qu'on sonne.
  const initial = await evaluateWatch(watch, { initial: true });
  return { kind: 'created', watch, initial };
}

function labelOf(query: MarketQuery, input: WatchInput): string {
  const parts = [input.version ?? `${query.brand} ${query.model}`];
  if (input.gearbox) parts.push(input.gearbox.toLowerCase());
  if (input.kmMax) parts.push(`< ${Math.round(input.kmMax / 1000)} 000 km`);
  if (input.priceMax) parts.push(`< ${input.priceMax.toLocaleString('fr-FR')} €`);
  return parts.join(' · ');
}

export async function listWatches(uid: string) {
  const { watches, alerts } = await collections();
  const list = await watches.find({ uid }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
  const counts = await alerts
    .aggregate<{ _id: string; count: number }>([
      { $match: { uid, watchId: { $in: list.map((watch) => watch.id) } } },
      { $group: { _id: '$watchId', count: { $sum: 1 } } },
    ])
    .toArray();
  const byWatch = new Map(counts.map((item) => [item._id, item.count]));
  return list.map((watch) => ({ ...watch, alerts: byWatch.get(watch.id) ?? 0 }));
}

export async function setWatchActive(uid: string, id: string, active: boolean): Promise<boolean> {
  const { watches } = await collections();
  const result = await watches.updateOne({ uid, id }, { $set: { active } });
  return result.matchedCount > 0;
}

export async function deleteWatch(uid: string, id: string): Promise<boolean> {
  const { watches, alerts } = await collections();
  const result = await watches.deleteOne({ uid, id });
  if (result.deletedCount) await alerts.deleteMany({ uid, watchId: id });
  return result.deletedCount > 0;
}

// ---------------------------------------------------------------------------
// Jugement
// ---------------------------------------------------------------------------

export interface Deal {
  ad: Ad;
  reference: number;
  ratio: number;
  comparables: number;
}

/**
 * Annonces d'un modèle qui répondent à une veille et sortent sous leurs
 * comparables. Fonction pure : la même règle sert aux tests.
 */
export function dealsFor(
  watch: Pick<Watch, 'version' | 'gearbox' | 'kmMax' | 'priceMax' | 'threshold'>,
  ads: Ad[],
): Deal[] {
  const pool = plausible(ads).kept;
  const deals: Deal[] = [];

  // Les prix suspects ne servent de comparable à personne, mais restent
  // signalés : l'alerte dira de vérifier.
  for (const ad of [...pool, ...suspects(ads)]) {
    // Sans moteur, année ni kilométrage, il n'y a pas de comparables honnêtes.
    if (!ad.version || ad.km === null || ad.year === null) continue;
    if (watch.version && ad.version !== watch.version) continue;
    if (watch.gearbox && ad.gearbox !== watch.gearbox) continue;
    if (watch.kmMax && ad.km > watch.kmMax) continue;
    if (watch.priceMax && ad.price > watch.priceMax) continue;

    const peers = estimate(ad, pool, ad.lbcId);
    if (!peers || !peers.tolerance.sameVersion) continue;
    const ratio = (peers.median - ad.price) / peers.median;
    if (ratio >= watch.threshold) {
      deals.push({ ad, reference: peers.median, ratio, comparables: peers.count });
    }
  }
  return deals.sort((a, b) => b.ratio - a.ratio);
}

/**
 * Applique une veille aux annonces de son modèle. Renvoie le nombre
 * d'annonces signalées ou re-signalées à cette occasion.
 */
export async function evaluateWatch(watch: Watch, { initial = false } = {}): Promise<number> {
  const { alerts, watches, marketQueries } = await collections();
  const query = await marketQueries.findOne({ id: watch.queryId }, { projection: { adIds: 1 } });
  if (!query) return 0;

  const ads = screen(await loadAds(query.adIds));
  const deals = dealsFor(watch, ads);
  const existing = new Map(
    (await alerts.find({ watchId: watch.id, lbcId: { $in: deals.map((deal) => deal.ad.lbcId) } }).toArray()).map(
      (alert) => [alert.lbcId, alert],
    ),
  );

  const now = new Date();
  const notify: Alert[] = [];
  for (const deal of deals) {
    const previous = existing.get(deal.ad.lbcId);
    const fields = {
      title: deal.ad.title,
      url: deal.ad.url,
      imageUrl: deal.ad.imageUrl ?? null,
      location: deal.ad.location ?? null,
      price: deal.ad.price,
      reference: deal.reference,
      ratio: deal.ratio,
      comparables: deal.comparables,
      km: deal.ad.km,
      year: deal.ad.year,
      version: deal.ad.version,
      suspicious: deal.ad.flags?.includes(SUSPICIOUS_FLAG) ?? false,
    };

    if (!previous) {
      const alert: Alert = {
        id: randomUUID(),
        uid: watch.uid,
        watchId: watch.id,
        lbcId: deal.ad.lbcId,
        ...fields,
        initial,
        createdAt: now,
        updatedAt: now,
        readAt: initial ? now : null,
      };
      const inserted = await alerts
        .insertOne(alert)
        .then(() => true)
        .catch(() => false); // Un passage concurrent l'a déjà enregistrée.
      if (inserted && !initial) notify.push(alert);
    } else if (deal.ad.price <= previous.price * (1 - NEW_DROP)) {
      // Elle était déjà une affaire, et elle vient encore de baisser : c'est
      // souvent le signe d'un vendeur pressé, à saisir.
      await alerts.updateOne({ id: previous.id }, { $set: { ...fields, updatedAt: now, readAt: null } });
      notify.push({ ...previous, ...fields, updatedAt: now, readAt: null, initial: false });
    }
  }

  await watches.updateOne({ id: watch.id }, { $set: { checkedAt: now } });
  if (notify.length) await announce(watch, notify).catch((error) => console.warn('[veille] notification :', error));
  return deals.length && initial ? deals.length : notify.length;
}

/** Applique toutes les veilles d'un modèle, après un relevé. */
export async function evaluateWatchesFor(key: string): Promise<void> {
  const { watches } = await collections();
  const list = await watches.find({ key, active: true }, { projection: { _id: 0 } }).toArray();
  for (const watch of list) {
    await evaluateWatch(watch).catch((error) => console.warn('[veille] évaluation :', error));
  }
}

async function announce(watch: Watch, fresh: Alert[]): Promise<void> {
  if (fresh.length === 1) {
    const [alert] = fresh;
    const details = [alert.year, alert.km !== null ? `${alert.km.toLocaleString('fr-FR')} km` : null, alert.location]
      .filter(Boolean)
      .join(' · ');
    await sendToUser(watch.uid, {
      title: `${Math.round(alert.ratio * 100)} % sous le marché · ${alert.price.toLocaleString('fr-FR')} €`,
      body: `${alert.suspicious ? 'Prix anormalement bas : à vérifier avant tout.\n' : ''}${alert.title}\n${details}\nComparables autour de ${alert.reference.toLocaleString('fr-FR')} €`,
      url: `/alertes?ouvrir=${alert.id}`,
      tag: `alerte-${alert.lbcId}`,
      image: alert.imageUrl,
    });
    return;
  }
  const best = fresh.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  await sendToUser(watch.uid, {
    title: `${fresh.length} nouvelles affaires · ${watch.label}`,
    body: `La meilleure : ${best.title}, ${best.price.toLocaleString('fr-FR')} € (${Math.round(best.ratio * 100)} % sous le marché)`,
    url: '/alertes',
    tag: `veille-${watch.id}`,
  });
}

// ---------------------------------------------------------------------------
// Alertes
// ---------------------------------------------------------------------------

export async function listAlerts(uid: string) {
  const { alerts } = await collections();
  const [items, unread] = await Promise.all([
    alerts.find({ uid }, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(60).toArray(),
    alerts.countDocuments({ uid, readAt: null }),
  ]);
  return { alerts: items, unread };
}

export async function countUnread(uid: string): Promise<number> {
  const { alerts } = await collections();
  return alerts.countDocuments({ uid, readAt: null });
}

export async function markAlertsRead(uid: string): Promise<void> {
  const { alerts } = await collections();
  await alerts.updateMany({ uid, readAt: null }, { $set: { readAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Planification
// ---------------------------------------------------------------------------

export interface MarketJob {
  queryId: string;
  /** Marque de l'envoi : un envoi plus ancien qui se réveillerait est écarté. */
  runId: string;
  brand: string;
  model: string;
  yearMin: number | null;
  yearMax: number | null;
  powerMin: number | null;
  powerMax: number | null;
  codes: { brand: string; model: string } | null;
  mode: 'full' | 'fresh';
}

/**
 * Modèles surveillés à relever maintenant. Une seule estimation par modèle
 * est relevée, quel que soit le nombre de comptes qui la surveillent ; elle
 * est réservée (« en file ») pour qu'un passage suivant ne la reprenne pas.
 */
export async function claimDueJobs(now = new Date()): Promise<MarketJob[]> {
  const { watches, marketQueries } = await collections();
  const keys: string[] = await watches.distinct('key', { active: true });
  if (!keys.length) return [];

  const queries = await marketQueries
    .find({ key: { $in: keys } }, { projection: { _id: 0, adIds: 0, pendingIds: 0 } })
    .toArray();

  const due: { query: MarketQuery; mode: 'full' | 'fresh'; age: number }[] = [];
  for (const key of keys) {
    const group = queries.filter((query) => query.key === key);
    if (!group.length || group.some((query) => query.status === 'queued' || query.status === 'running')) continue;

    const latest = (field: 'collectedAt' | 'freshAt') =>
      Math.max(0, ...group.map((query) => (query[field] ? new Date(query[field] as Date).getTime() : 0)));
    const collected = latest('collectedAt');
    const touched = Math.max(collected, latest('freshAt'));
    if (touched && now.getTime() - touched < FRESH_EVERY) continue;

    const representative = group.reduce((a, b) =>
      new Date(b.collectedAt ?? 0).getTime() > new Date(a.collectedAt ?? 0).getTime() ? b : a,
    );
    due.push({
      query: representative,
      mode: !collected || now.getTime() - collected > FULL_EVERY ? 'full' : 'fresh',
      age: now.getTime() - touched,
    });
  }

  const chosen = due.sort((a, b) => b.age - a.age).slice(0, CLAIM_LIMIT);
  const jobs: MarketJob[] = [];
  for (const { query, mode } of chosen) {
    const runId = randomUUID();
    await marketQueries.updateOne(
      { id: query.id },
      { $set: { status: 'queued', runMode: mode, runId, stopRequested: false, error: null, updatedAt: now } },
    );
    jobs.push({
      queryId: query.id,
      runId,
      brand: query.brand,
      model: query.model,
      yearMin: query.yearMin,
      yearMax: query.yearMax,
      powerMin: query.powerMin ?? null,
      powerMax: query.powerMax ?? null,
      codes: query.codes,
      mode,
    });
  }
  return jobs;
}
