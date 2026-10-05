import { randomUUID } from 'node:crypto';
import { collectJobs, FRESH_FOR, MAX_ACTIVE } from './collect-jobs';
import { collections } from './mongo';
import { readSpecs, type Ad } from './estimation';
import type { MarketActivity, MarketAd, MarketQuery, ScrapedListing } from './types';

/** Envoi, avancement, arrêt et collectes mortes : le cycle commun à toutes les collectes. */
const jobs = collectJobs<MarketQuery>({
  collection: async () => (await collections()).marketQueries,
  workerPath: '/market',
  payload: (query) => ({
    brand: query.brand,
    model: query.model,
    yearMin: query.yearMin,
    yearMax: query.yearMax,
    powerMin: query.powerMin ?? null,
    powerMax: query.powerMax ?? null,
    codes: query.codes,
  }),
});

/** Collectes laissées en cours par un collecteur qui vient de redémarrer. */
export const abandonQueries = jobs.abandon;
export const refreshQuery = jobs.refresh;
export const stopQuery = jobs.stop;
export const listQueries = jobs.list;
export const getQuery = jobs.get;
export const deleteQuery = jobs.remove;

type QueryInput = {
  brand: string;
  model: string;
  yearMin: number | null;
  yearMax: number | null;
  powerMin: number | null;
  powerMax: number | null;
  /** Codes du site déjà connus (lus sur une annonce) : épargnent la recherche libre. */
  codes?: { brand: string; model: string } | null;
};

export function queryKey(input: QueryInput) {
  const key = [normalize(input.brand), normalize(input.model), input.yearMin ?? '', input.yearMax ?? ''];
  // Sans puissance, la clé reste celle d'avant : les estimations existantes
  // se retrouvent.
  if (input.powerMin || input.powerMax) key.push(`${input.powerMin ?? ''}-${input.powerMax ?? ''}ch`);
  return key.join('|');
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type CreateOutcome =
  | { kind: 'reused' | 'created' | 'existing'; query: MarketQuery }
  | { kind: 'too_many' };

/**
 * Crée une estimation pour un compte.
 *
 * Les résultats d'une recherche sont publics : si ce modèle a déjà été
 * collecté récemment, par n'importe qui, on reprend cette collecte. C'est ce
 * qui empêche le trafic vers le site de croître avec le nombre de comptes.
 */
export async function createQuery(
  uid: string,
  input: QueryInput,
): Promise<CreateOutcome> {
  await jobs.settleStale();
  const { marketQueries } = await collections();
  const key = queryKey(input);

  const mine = await marketQueries.findOne({ uid, key }, { projection: { _id: 0 } });
  if (mine && (mine.status === 'queued' || mine.status === 'running')) {
    return { kind: 'existing', query: mine };
  }

  const fresh = await marketQueries.findOne(
    { key, status: 'done', collectedAt: { $gte: new Date(Date.now() - FRESH_FOR) } },
    { projection: { _id: 0 }, sort: { collectedAt: -1 } },
  );

  if (fresh) {
    const query = mine
      ? { ...mine, adIds: fresh.adIds, codes: fresh.codes, ads: fresh.ads, status: 'done' as const, collectedAt: fresh.collectedAt, error: null, updatedAt: new Date() }
      : buildQuery(uid, input, key, { status: 'done', adIds: fresh.adIds, codes: fresh.codes, ads: fresh.ads, collectedAt: fresh.collectedAt });
    await marketQueries.updateOne({ id: query.id }, { $set: query }, { upsert: true });
    return { kind: 'reused', query };
  }

  if ((await jobs.activeCount(uid)) >= MAX_ACTIVE) return { kind: 'too_many' };

  // Des codes déjà établis pour ce modèle évitent la recherche libre.
  const known = await marketQueries.findOne(
    { brand: new RegExp(`^${escape(input.brand.trim())}$`, 'i'), model: new RegExp(`^${escape(input.model.trim())}$`, 'i'), codes: { $ne: null } },
    { projection: { codes: 1 } },
  );

  const query = mine
    ? { ...mine, status: 'queued' as const, error: null, stopRequested: false, codes: mine.codes ?? input.codes ?? known?.codes ?? null, updatedAt: new Date() }
    : buildQuery(uid, input, key, { codes: input.codes ?? known?.codes ?? null });

  await marketQueries.updateOne({ id: query.id }, { $set: query }, { upsert: true });
  await jobs.dispatch(query);
  return { kind: mine ? 'existing' : 'created', query };
}

function buildQuery(
  uid: string,
  input: QueryInput,
  key: string,
  overrides: Partial<MarketQuery>,
): MarketQuery {
  return {
    id: randomUUID(),
    uid,
    brand: input.brand.trim(),
    model: input.model.trim(),
    yearMin: input.yearMin,
    yearMax: input.yearMax,
    powerMin: input.powerMin,
    powerMax: input.powerMax,
    key,
    status: 'queued',
    pages: 0,
    ads: 0,
    error: null,
    codes: null,
    adIds: [],
    pendingIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    collectedAt: null,
    ...overrides,
  };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Côté collecteur
// ---------------------------------------------------------------------------

/** Verse des annonces dans la base commune et les rattache à la collecte en cours. */
export async function ingestMarketAds(queryId: string | null, scraped: ScrapedListing[]): Promise<number> {
  const { marketAds } = await collections();
  const now = new Date();
  const priced = scraped.filter((ad) => ad.price !== null);

  // Les prix déjà connus, pour n'inscrire dans l'historique que les changements.
  const known = new Map(
    (
      await marketAds
        .find(
          { lbcId: { $in: priced.map((ad) => ad.lbcId) } },
          { projection: { _id: 0, lbcId: 1, price: 1, firstSeenAt: 1, priceHistory: 1 } },
        )
        .toArray()
    ).map((doc) => [doc.lbcId, doc]),
  );

  const operations = priced.map((ad) => {
    const price = ad.price as number;
    const specs = readSpecs(ad.attributes);
    const publishedAt = parsePublication(ad.publishedAt);
    // Un champ absent de cette lecture ne doit pas effacer celui qu'une
    // lecture plus complète a déjà enregistré.
    const fields = Object.fromEntries(
      Object.entries({
        imageUrl: ad.imageUrl ?? null,
        location: ad.location ?? null,
        sellerType: ad.sellerType ?? null,
        publishedAt,
        ...specs,
      }).filter(([, value]) => value !== null && value !== undefined),
    );

    const previous = known.get(ad.lbcId);
    const update: Record<string, unknown> = {
      $set: { title: ad.title, url: ad.url, price, lastSeenAt: now, ...fields },
      $setOnInsert: { lbcId: ad.lbcId, firstSeenAt: now, priceHistory: [{ price, at: now }] },
    };
    if (previous && previous.price !== price) {
      // Une annonce connue d'avant l'historique reçoit son prix d'origine,
      // daté du jour où on l'a vue : sans lui, la baisse serait invisible.
      const history = previous.priceHistory?.length
        ? [{ price, at: now }]
        : [{ price: previous.price, at: previous.firstSeenAt }, { price, at: now }];
      update.$push = { priceHistory: { $each: history } };
      delete (update.$setOnInsert as Record<string, unknown>).priceHistory;
    } else if (previous) {
      delete (update.$setOnInsert as Record<string, unknown>).priceHistory;
    }
    return { updateOne: { filter: { lbcId: ad.lbcId }, update, upsert: true } };
  });

  if (operations.length) await marketAds.bulkWrite(operations as never, { ordered: false });
  // Sans collecte quand l'annonce est lue pour une négociation ou vient des favoris.
  if (queryId) await jobs.attach(queryId, scraped.map((ad) => ad.lbcId));
  return operations.length;
}

/** « 2026-09-12 08:41:07 », heure de Paris telle que le site l'affiche. */
function parsePublication(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? '' : '+02:00'));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function updateQueryProgress(
  id: string,
  patch: {
    runId?: string;
    status?: 'running' | 'done' | 'error';
    pages?: number;
    ads?: number;
    codes?: { brand: string; model: string } | null;
    error?: string;
    activity?: MarketActivity;
    mode?: 'full' | 'fresh';
  },
): Promise<{ found: boolean; stop: boolean }> {
  const { codes, ...rest } = patch;
  const result = await jobs.progress(id, { ...rest, learned: codes !== undefined ? { codes } : undefined });
  if (result.found && patch.status === 'done') await shareCollection(id);
  return result;
}

/**
 * Les estimations d'un même modèle, quel que soit le compte, lisent les mêmes
 * annonces : un relevé fait pour l'une profite aussitôt aux autres.
 */
async function shareCollection(id: string): Promise<void> {
  const { marketQueries } = await collections();
  const source = await marketQueries.findOne({ id }, { projection: { _id: 0 } });
  if (!source) return;
  await marketQueries.updateMany(
    { key: source.key, id: { $ne: id }, status: { $in: ['done', 'error'] } },
    {
      $set: {
        adIds: source.adIds,
        ads: source.ads,
        codes: source.codes,
        collectedAt: source.collectedAt,
        freshAt: source.freshAt ?? null,
        status: 'done',
        error: null,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function loadAds(ids: string[]): Promise<Ad[]> {
  if (!ids.length) return [];
  const { marketAds } = await collections();
  const docs = await marketAds
    .find({ lbcId: { $in: ids } }, { projection: { _id: 0 } })
    .toArray();
  return docs.map(toAd);
}

function toAd(doc: MarketAd): Ad {
  return {
    lbcId: doc.lbcId,
    title: doc.title,
    url: doc.url,
    price: doc.price,
    km: doc.km ?? null,
    year: doc.year ?? null,
    version: doc.version ?? null,
    location: doc.location ?? null,
    imageUrl: doc.imageUrl ?? null,
    sellerType: doc.sellerType ?? null,
    gearbox: doc.gearbox ?? null,
    fuel: doc.fuel ?? null,
    onlineSince: doc.publishedAt ?? doc.firstSeenAt ?? null,
  };
}

/**
 * Marques et modèles déjà rencontrés, pour guider la saisie. Ils viennent des
 * estimations passées et des annonces collectées : la liste s'enrichit à
 * l'usage, sans catalogue à tenir à jour.
 */
export async function catalogue(): Promise<{ brand: string; models: string[] }[]> {
  const { marketQueries, marketAds, listings } = await collections();

  const pairs = new Map<string, Set<string>>();
  const add = (brand?: string | null, model?: string | null) => {
    if (!brand) return;
    const b = pretty(brand);
    if (!pairs.has(b)) pairs.set(b, new Set());
    if (model) pairs.get(b)!.add(prettyModel(brand, model));
  };

  for (const q of await marketQueries.find({}, { projection: { brand: 1, model: 1 } }).limit(500).toArray()) {
    add(q.brand, q.model);
  }
  for (const code of await marketAds.aggregate<{ _id: { b: string; m: string } }>([
    { $match: { brandCode: { $ne: null } } },
    { $group: { _id: { b: '$brandCode', m: '$modelCode' } } },
    { $limit: 500 },
  ]).toArray()) {
    add(code._id.b, code._id.m);
  }
  for (const code of await listings.aggregate<{ _id: { b: string; m: string } }>([
    { $match: { 'attributes.u_car_brand': { $exists: true } } },
    { $group: { _id: { b: '$attributes.u_car_brand', m: '$attributes.u_car_model' } } },
    { $limit: 500 },
  ]).toArray()) {
    add(code._id.b, code._id.m);
  }

  return [...pairs.entries()]
    .map(([brand, models]) => ({ brand, models: [...models].sort() }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
}

export function pretty(text: string): string {
  const spaced = text.replace(/_/g, ' ').trim();
  return spaced === spaced.toUpperCase() && spaced.length > 3
    ? spaced.charAt(0) + spaced.slice(1).toLowerCase()
    : spaced;
}

/** « PORSCHE_Boxster » devient « Boxster ». */
export function prettyModel(brand: string, model: string): string {
  const prefix = `${brand}_`;
  const bare = model.toUpperCase().startsWith(prefix.toUpperCase()) ? model.slice(prefix.length) : model;
  return bare.replace(/_/g, ' ').trim();
}
