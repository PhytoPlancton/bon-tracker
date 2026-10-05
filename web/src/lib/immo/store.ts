import { randomUUID } from 'node:crypto';
import { collectJobs, FRESH_FOR, MAX_ACTIVE, type ProgressPatch } from '../collect-jobs';
import { collections } from '../mongo';
import type { ScrapedListing } from '../types';
import { describe, plausible, quantile, roundPerM2, searchBand, type ImmoAdInput } from './estimation';
import { readImmoSpecs, zipcodeOf } from './specs';
import type { ImmoActivity, ImmoAd, ImmoQuery, Place, PropertyType, Transaction } from './types';

/** Envoi, avancement, arrêt et collectes mortes : le cycle commun à toutes les collectes. */
const jobs = collectJobs<ImmoQuery>({
  collection: async () => (await collections()).immoQueries,
  workerPath: '/immo',
  payload: (query) => ({
    transaction: query.transaction,
    propertyType: query.propertyType,
    place: query.place,
    radiusKm: query.radiusKm,
    surfaceMin: query.surfaceMin,
    surfaceMax: query.surfaceMax,
    locationParam: query.locationParam,
  }),
});

export const abandonImmoQueries = jobs.abandon;
export const refreshImmoQuery = jobs.refresh;
export const stopImmoQuery = jobs.stop;
export const listImmoQueries = jobs.list;
export const getImmoQuery = jobs.get;
export const deleteImmoQuery = jobs.remove;

export interface ImmoInput {
  transaction: Transaction;
  propertyType: PropertyType;
  place: Place;
  radiusKm: number;
  surface: number | null;
}

/** Même bien, même lieu, même rayon, même fourchette : même collecte, quel que soit le compte. */
export function immoKey(input: ImmoInput): string {
  const band = searchBand(input.surface);
  return [input.transaction, input.propertyType, input.place.code, input.radiusKm, band.min ?? '', band.max ?? ''].join('|');
}

export type CreateOutcome =
  | { kind: 'reused' | 'created' | 'existing'; query: ImmoQuery }
  | { kind: 'too_many' };

/**
 * Crée une estimation pour un compte.
 *
 * Les résultats d'une recherche sont publics : si ce marché a déjà été
 * collecté récemment, par n'importe qui, on reprend cette collecte. C'est ce
 * qui empêche le trafic vers le site de croître avec le nombre de comptes.
 */
export async function createImmoQuery(uid: string, input: ImmoInput): Promise<CreateOutcome> {
  await jobs.settleStale();
  const { immoQueries } = await collections();
  const key = immoKey(input);

  const mine = await immoQueries.findOne({ uid, key }, { projection: { _id: 0 } });
  if (mine && (mine.status === 'queued' || mine.status === 'running')) {
    return { kind: 'existing', query: mine };
  }

  const fresh = await immoQueries.findOne(
    { key, status: 'done', collectedAt: { $gte: new Date(Date.now() - FRESH_FOR) } },
    { projection: { _id: 0 }, sort: { collectedAt: -1 } },
  );

  if (fresh) {
    const reused = {
      status: 'done' as const,
      adIds: fresh.adIds,
      ads: fresh.ads,
      collectedAt: fresh.collectedAt,
      locationParam: fresh.locationParam,
    };
    const query = mine
      ? { ...mine, ...reused, error: null, updatedAt: new Date() }
      : buildQuery(uid, input, key, reused);
    await immoQueries.updateOne({ id: query.id }, { $set: query }, { upsert: true });
    return { kind: 'reused', query };
  }

  if ((await jobs.activeCount(uid)) >= MAX_ACTIVE) return { kind: 'too_many' };

  // La forme du lieu que le site a déjà comprise évite de la chercher à nouveau.
  const known = await immoQueries.findOne(
    { 'place.code': input.place.code, radiusKm: input.radiusKm, locationParam: { $ne: null } },
    { projection: { locationParam: 1 }, sort: { collectedAt: -1 } },
  );

  const query = mine
    ? {
        ...mine,
        status: 'queued' as const,
        error: null,
        stopRequested: false,
        locationParam: mine.locationParam ?? known?.locationParam ?? null,
        updatedAt: new Date(),
      }
    : buildQuery(uid, input, key, { locationParam: known?.locationParam ?? null });

  await immoQueries.updateOne({ id: query.id }, { $set: query }, { upsert: true });
  await jobs.dispatch(query);
  return { kind: mine ? 'existing' : 'created', query };
}

function buildQuery(uid: string, input: ImmoInput, key: string, overrides: Partial<ImmoQuery>): ImmoQuery {
  const band = searchBand(input.surface);
  return {
    id: randomUUID(),
    uid,
    transaction: input.transaction,
    propertyType: input.propertyType,
    place: input.place,
    radiusKm: input.radiusKm,
    surface: input.surface,
    surfaceMin: band.min,
    surfaceMax: band.max,
    locationParam: null,
    key,
    status: 'queued',
    pages: 0,
    ads: 0,
    error: null,
    adIds: [],
    pendingIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    collectedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Côté collecteur
// ---------------------------------------------------------------------------

/** Ce que le collecteur relève d'un bien, coordonnées et description comprises. */
export type ScrapedImmo = ScrapedListing & { lat?: number | null; lng?: number | null; body?: string | null };

/** Verse des biens dans la base commune et les rattache à la collecte en cours. */
export async function ingestImmoAds(queryId: string, scraped: ScrapedImmo[]): Promise<number> {
  const { immoAds, immoQueries } = await collections();
  const query = await immoQueries.findOne({ id: queryId }, { projection: { transaction: 1 } });
  if (!query) return 0;
  const now = new Date();

  const operations = scraped
    .filter((ad) => ad.price !== null)
    .map((ad) => {
      const specs = readImmoSpecs(ad.attributes, ad.title);
      // Un champ absent de cette lecture ne doit pas effacer celui qu'une
      // lecture plus complète a déjà enregistré.
      const known = Object.fromEntries(
        Object.entries({
          imageUrl: ad.imageUrl ?? null,
          location: ad.location ?? null,
          zipcode: zipcodeOf(ad.location),
          lat: ad.lat ?? null,
          lng: ad.lng ?? null,
          sellerType: ad.sellerType ?? null,
          body: ad.body ? ad.body.slice(0, 1500) : null,
          ...specs,
        }).filter(([, value]) => value !== null && value !== undefined),
      );

      return {
        updateOne: {
          filter: { lbcId: ad.lbcId },
          update: {
            $set: { title: ad.title, url: ad.url, price: ad.price as number, transaction: query.transaction, lastSeenAt: now, ...known },
            $setOnInsert: { lbcId: ad.lbcId, firstSeenAt: now },
          },
          upsert: true,
        },
      };
    });

  if (operations.length) await immoAds.bulkWrite(operations as never, { ordered: false });
  await jobs.attach(queryId, scraped.map((ad) => ad.lbcId));
  return operations.length;
}

export async function updateImmoProgress(
  id: string,
  patch: Omit<ProgressPatch, 'learned' | 'activity'> & { activity?: ImmoActivity; locationParam?: string | null },
): Promise<{ found: boolean; stop: boolean }> {
  const { locationParam, ...rest } = patch;
  return jobs.progress(id, { ...rest, learned: locationParam !== undefined ? { locationParam } : undefined });
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/** Les biens d'une collecte, tels que l'analyse les attend. */
export async function loadImmoAds(ids: string[]): Promise<ImmoAdInput[]> {
  if (!ids.length) return [];
  const { immoAds } = await collections();
  const docs = await immoAds.find({ lbcId: { $in: ids } }, { projection: { _id: 0 } }).toArray();
  return docs.map(toInput);
}

function toInput(doc: ImmoAd): ImmoAdInput {
  return {
    lbcId: doc.lbcId,
    title: doc.title,
    url: doc.url,
    price: doc.price,
    surface: doc.surface ?? null,
    rooms: doc.rooms ?? null,
    propertyType: doc.propertyType ?? null,
    energy: doc.energy ?? null,
    floor: doc.floor ?? null,
    isNew: doc.isNew ?? null,
    furnished: doc.furnished ?? null,
    landSurface: doc.landSurface ?? null,
    location: doc.location ?? null,
    imageUrl: doc.imageUrl ?? null,
    sellerType: doc.sellerType ?? null,
    body: doc.body ?? null,
  };
}

/** Une collecte de l'autre côté du marché : les loyers face aux prix de vente. */
export interface Counterpart {
  transaction: Transaction;
  /** Prix au m² médian : de vente, ou loyer mensuel. */
  perM2: number;
  count: number;
  collectedAt: string;
  /** L'estimation du compte qui la porte, quand c'est la sienne ; on n'ouvre pas celle d'un autre. */
  id: string | null;
}

/**
 * Le marché d'en face pour le même lieu et le même type de bien : les loyers
 * quand on regarde les prix de vente, et l'inverse. Les deux ensemble donnent
 * le rendement brut. Un mois de recul suffit : les loyers ne bougent pas d'une
 * semaine à l'autre.
 */
export async function counterpartOf(uid: string, query: ImmoQuery): Promise<Counterpart | null> {
  const { immoQueries } = await collections();
  const other: Transaction = query.transaction === 'vente' ? 'location' : 'vente';
  const filter = {
    transaction: other,
    propertyType: query.propertyType,
    'place.code': query.place.code,
    radiusKm: query.radiusKm,
    status: 'done' as const,
    collectedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  };
  const found =
    (await immoQueries.findOne({ ...filter, uid }, { projection: { _id: 0 }, sort: { collectedAt: -1 } })) ??
    (await immoQueries.findOne(filter, { projection: { _id: 0 }, sort: { collectedAt: -1 } }));
  if (!found?.collectedAt) return null;

  // Mêmes tailles de part et d'autre : un loyer de studio rapporté au prix
  // d'un cinq pièces gonflerait le rendement.
  const { kept: all } = plausible(describe(await loadImmoAds(found.adIds), other), other);
  const kept = all.filter(
    (ad) =>
      (query.surfaceMin === null || ad.surface >= query.surfaceMin) &&
      (query.surfaceMax === null || ad.surface <= query.surfaceMax),
  );
  if (kept.length < 4) return null;
  const perM2 = kept.map((ad) => ad.perM2).sort((a, b) => a - b);
  return {
    transaction: other,
    perM2: roundPerM2(quantile(perM2, 0.5), other),
    count: kept.length,
    collectedAt: found.collectedAt.toISOString(),
    id: found.uid === uid ? found.id : null,
  };
}
