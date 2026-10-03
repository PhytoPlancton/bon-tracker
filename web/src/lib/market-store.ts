import { randomUUID } from 'node:crypto';
import { collections } from './mongo';
import { env } from './env';
import { readSpecs, type Ad } from './estimation';
import type { MarketActivity, MarketAd, MarketQuery, ScrapedListing } from './types';

/** Une collecte de moins d'un jour est réutilisée plutôt que refaite. */
const FRESH_FOR = 24 * 60 * 60 * 1000;

/** Collectes simultanées par compte : chacune occupe le navigateur une à deux minutes. */
const MAX_ACTIVE = 3;

/**
 * Sans nouvelles du collecteur depuis ce délai, une collecte ne progresse
 * plus : collecteur redémarré, Chrome fermé. Une collecte dure quelques
 * minutes, mais peut attendre derrière un relevé complet de tous les comptes.
 */
const STALE_AFTER = 20 * 60 * 1000;

/** Collectes laissées en cours par un collecteur qui vient de redémarrer. */
export async function abandonQueries(before: Date): Promise<number> {
  const { marketQueries } = await collections();
  const result = await marketQueries.updateMany(
    {
      status: { $in: ['queued', 'running'] },
      $or: [
        { updatedAt: { $lt: before } },
        { updatedAt: { $exists: false }, createdAt: { $lt: before } },
      ],
    },
    {
      $set: {
        status: 'error',
        error: 'Le collecteur a redémarré pendant la collecte. Actualise pour la relancer.',
        updatedAt: new Date(),
      },
    },
  );
  return result.modifiedCount;
}

/** Rend la main sur les collectes mortes, pour qu'on puisse les relancer. */
async function settleStale(): Promise<void> {
  const { marketQueries } = await collections();
  const cutoff = new Date(Date.now() - STALE_AFTER);
  await marketQueries.updateMany(
    {
      status: { $in: ['queued', 'running'] },
      $or: [
        { updatedAt: { $lt: cutoff } },
        { updatedAt: { $exists: false }, createdAt: { $lt: cutoff } },
      ],
    },
    {
      $set: {
        status: 'error',
        error: 'Collecte interrompue sans nouvelles du collecteur. Vérifie que la fenêtre Chrome dédiée est ouverte, puis Actualise.',
      },
    },
  );
}

type QueryInput = {
  brand: string;
  model: string;
  yearMin: number | null;
  yearMax: number | null;
  powerMin: number | null;
  powerMax: number | null;
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
  await settleStale();
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

  const active = await marketQueries.countDocuments({ uid, status: { $in: ['queued', 'running'] } });
  if (active >= MAX_ACTIVE) return { kind: 'too_many' };

  // Des codes déjà établis pour ce modèle évitent la recherche libre.
  const known = await marketQueries.findOne(
    { brand: new RegExp(`^${escape(input.brand.trim())}$`, 'i'), model: new RegExp(`^${escape(input.model.trim())}$`, 'i'), codes: { $ne: null } },
    { projection: { codes: 1 } },
  );

  const query = mine
    ? { ...mine, status: 'queued' as const, error: null, codes: mine.codes ?? known?.codes ?? null, updatedAt: new Date() }
    : buildQuery(uid, input, key, { codes: known?.codes ?? null });

  await marketQueries.updateOne({ id: query.id }, { $set: query }, { upsert: true });
  await dispatch(query);
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

/** Confie la collecte au collecteur, qui répond aussitôt et travaille ensuite. */
export async function dispatch(query: MarketQuery): Promise<void> {
  const { marketQueries } = await collections();
  try {
    const response = await fetch(`${env.workerUrl}/market`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-token': env.workerToken },
      body: JSON.stringify({
        queryId: query.id,
        brand: query.brand,
        model: query.model,
        yearMin: query.yearMin,
        yearMax: query.yearMax,
        powerMin: query.powerMin ?? null,
        powerMax: query.powerMax ?? null,
        codes: query.codes,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`réponse ${response.status}`);
  } catch (cause) {
    await marketQueries.updateOne(
      { id: query.id },
      {
        $set: {
          status: 'error',
          error: `Collecteur injoignable (${cause instanceof Error ? cause.message : String(cause)}). Vérifie qu'il tourne et que le Chrome dédié est ouvert.`,
        },
      },
    );
  }
}

export async function refreshQuery(uid: string, id: string): Promise<MarketQuery | null> {
  await settleStale();
  const { marketQueries } = await collections();
  const query = await marketQueries.findOne({ uid, id }, { projection: { _id: 0 } });
  if (!query) return null;
  if (query.status === 'queued' || query.status === 'running') return query;

  const next = { ...query, status: 'queued' as const, error: null };
  await marketQueries.updateOne({ id }, { $set: { status: 'queued', error: null, updatedAt: new Date() } });
  await dispatch(next);
  return next;
}

// ---------------------------------------------------------------------------
// Côté collecteur
// ---------------------------------------------------------------------------

/** Verse des annonces dans la base commune et les rattache à la collecte en cours. */
export async function ingestMarketAds(queryId: string, scraped: ScrapedListing[]): Promise<number> {
  const { marketAds, marketQueries } = await collections();
  const now = new Date();

  const operations = scraped
    .filter((ad) => ad.price !== null)
    .map((ad) => {
      const specs = readSpecs(ad.attributes);
      // Un champ absent de cette lecture ne doit pas effacer celui qu'une
      // lecture plus complète a déjà enregistré.
      const known = Object.fromEntries(
        Object.entries({
          imageUrl: ad.imageUrl ?? null,
          location: ad.location ?? null,
          sellerType: ad.sellerType ?? null,
          ...specs,
        }).filter(([, value]) => value !== null && value !== undefined),
      );

      return {
        updateOne: {
          filter: { lbcId: ad.lbcId },
          update: {
            $set: { title: ad.title, url: ad.url, price: ad.price as number, lastSeenAt: now, ...known },
            $setOnInsert: { lbcId: ad.lbcId, firstSeenAt: now },
          },
          upsert: true,
        },
      };
    });

  if (operations.length) await marketAds.bulkWrite(operations as never, { ordered: false });
  await marketQueries.updateOne(
    { id: queryId },
    { $addToSet: { pendingIds: { $each: scraped.map((ad) => ad.lbcId) } } },
  );
  return operations.length;
}

export async function updateQueryProgress(
  id: string,
  patch: {
    status?: 'running' | 'done' | 'error';
    pages?: number;
    ads?: number;
    codes?: { brand: string; model: string } | null;
    error?: string;
    activity?: MarketActivity;
  },
): Promise<boolean> {
  const { marketQueries } = await collections();

  if (patch.status === 'done') {
    // La collecte réussie remplace la précédente d'un bloc : jamais de
    // mélange entre deux relevés.
    const result = await marketQueries.updateOne({ id }, [
      {
        $set: {
          status: 'done',
          adIds: '$pendingIds',
          ads: { $size: '$pendingIds' },
          pendingIds: [],
          collectedAt: '$$NOW',
          updatedAt: '$$NOW',
          activity: null,
          error: null,
          ...(patch.pages !== undefined ? { pages: patch.pages } : {}),
        },
      },
    ]);
    return result.matchedCount > 0;
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status) set.status = patch.status;
  if (patch.pages !== undefined) set.pages = patch.pages;
  if (patch.ads !== undefined) set.ads = patch.ads;
  if (patch.codes !== undefined) set.codes = patch.codes;
  if (patch.activity !== undefined) set.activity = patch.activity;
  if (patch.status === 'running') {
    set.error = null;
    if (patch.activity === undefined) set.activity = null;
    // Seul le démarrage repart de zéro : une remontée d'avancement qui
    // répéterait « en cours » ne doit pas perdre les annonces déjà reçues.
    await marketQueries.updateOne({ id, status: { $ne: 'running' } }, { $set: { pendingIds: [] } });
  }
  // En cas d'échec, la dernière collecte réussie reste consultable.
  if (patch.status === 'error') set.error = patch.error ?? 'Échec de la collecte';

  const result = await marketQueries.updateOne({ id }, { $set: set });
  return result.matchedCount > 0;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function listQueries(uid: string) {
  await settleStale();
  const { marketQueries } = await collections();
  return marketQueries
    .find({ uid }, { projection: { _id: 0, adIds: 0, pendingIds: 0 } })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
}

export async function getQuery(uid: string, id: string) {
  await settleStale();
  const { marketQueries } = await collections();
  return marketQueries.findOne({ uid, id }, { projection: { _id: 0, pendingIds: 0 } });
}

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
  };
}

export async function deleteQuery(uid: string, id: string): Promise<boolean> {
  const { marketQueries } = await collections();
  const result = await marketQueries.deleteOne({ uid, id });
  return result.deletedCount > 0;
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

function pretty(text: string): string {
  const spaced = text.replace(/_/g, ' ').trim();
  return spaced === spaced.toUpperCase() && spaced.length > 3
    ? spaced.charAt(0) + spaced.slice(1).toLowerCase()
    : spaced;
}

/** « PORSCHE_Boxster » devient « Boxster ». */
function prettyModel(brand: string, model: string): string {
  const prefix = `${brand}_`;
  const bare = model.toUpperCase().startsWith(prefix.toUpperCase()) ? model.slice(prefix.length) : model;
  return bare.replace(/_/g, ' ').trim();
}
