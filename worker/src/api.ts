import { config } from './config.js';

export interface ScrapedListing {
  lbcId: string;
  title: string;
  url: string;
  imageUrl?: string | null;
  category?: string | null;
  sellerType?: 'pro' | 'private' | null;
  location?: string | null;
  price: number | null;
  /** Première mise en ligne, telle que le site la date (« 2026-09-12 08:41:07 »). */
  publishedAt?: string | null;
  /**
   * Caractéristiques telles que le site les publie : puissance, année,
   * kilométrage, boîte, surface, pièces, DPE. Relevées sans présumer
   * lesquelles existent — c'est la seule base fiable pour comparer deux
   * annonces entre elles.
   */
  attributes?: Record<string, string>;
  /** Position de l'annonce, pour vérifier qu'un bien est bien dans le rayon demandé. */
  lat?: number | null;
  lng?: number | null;
  /**
   * Début de la description : un viager ou une vente aux enchères ne se
   * lisent souvent que là.
   */
  body?: string | null;
}

export interface TrackedSearch {
  lbcSearchId: string;
  name: string;
  url: string;
}

export interface RunStats {
  seen: number;
  created: number;
  priceChanges: number;
  deactivated: number;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-worker-token': config.workerToken,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status} ${body.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

export interface CollectableUser {
  uid: string;
  email: string;
  /** Mot de passe du compte leboncoin, déchiffré par l'application. */
  password: string | null;
  /** Session en cours, au format attendu par le navigateur. */
  session: Record<string, unknown> | null;
}

/** Comptes à relever. Les secrets restent chiffrés au repos côté application. */
export function fetchUsers() {
  return call<{ users: CollectableUser[] }>('/api/internal/users');
}

export function storeSession(uid: string, storageState: Record<string, unknown>) {
  return call<{ ok: boolean }>('/api/internal/users', {
    method: 'PUT',
    body: JSON.stringify({ uid, storageState }),
  });
}

export function reportLbcStatus(
  uid: string,
  status: 'ok' | 'needs_login' | 'blocked' | 'verification_required',
) {
  return call<{ ok: boolean }>('/api/internal/users', {
    method: 'PUT',
    body: JSON.stringify({ uid, status }),
  });
}

export function ingest(uid: string, source: string, listings: ScrapedListing[]) {
  return call<RunStats>('/api/internal/ingest', {
    method: 'POST',
    body: JSON.stringify({ uid, source, listings: listings.map(withoutBody) }),
  });
}

/**
 * Les favoris n'ont pas l'usage de la description : elle alourdirait l'envoi
 * pour rien. Le marché, lui, la garde — elle dit l'entretien, les options,
 * les défauts, et part avec l'export.
 */
function withoutBody({ body: _body, ...listing }: ScrapedListing): ScrapedListing {
  return listing;
}

export function fetchTrackedSearches(uid: string) {
  return call<{ searches: TrackedSearch[] }>(
    `/api/internal/searches?uid=${encodeURIComponent(uid)}`,
  );
}

export function reportSearches(
  uid: string,
  searches: { lbcSearchId: string; name: string; url: string; details?: string | null; itemCount?: number }[],
) {
  return call<{ upserted: number }>('/api/internal/searches', {
    method: 'POST',
    body: JSON.stringify({ uid, searches }),
  });
}

export function reportRun(payload: {
  uid: string;
  startedAt: string;
  status: 'ok' | 'error' | 'needs_session';
  stats: RunStats;
  error: string | null;
  trackedSearchIds?: string[];
}) {
  return call<{ ok: boolean }>('/api/internal/runs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Ce que fait le collecteur, montré en direct dans l'application. */
export interface MarketActivity {
  step: string;
  recent: {
    title: string;
    price: number;
    km: number | null;
    year: number | null;
    imageUrl: string | null;
    location: string | null;
  }[];
  total: number | null;
}

/**
 * Avancement d'une collecte de marché, affiché en direct dans l'application :
 * statut, pages lues, activité, et ce que la collecte a appris (codes du
 * modèle). Porte la marque de l'envoi servi : l'application écarte celui d'un
 * envoi remplacé, et répond `stop` quand l'arrêt a été demandé.
 */
export function updateMarketQuery(queryId: string, patch: Record<string, unknown>) {
  return call<{ ok: boolean; stop?: boolean }>(`/api/internal/market/queries/${encodeURIComponent(queryId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** Avancement d'une collecte immobilière, sur le modèle de celle des voitures. */
export function updateImmoQuery(queryId: string, patch: Record<string, unknown>) {
  return call<{ ok: boolean; stop?: boolean }>(`/api/internal/immo/queries/${encodeURIComponent(queryId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** Les biens d'un marché, versés dans la base immobilière commune à tous les comptes. */
export function ingestImmoAds(queryId: string, ads: ScrapedListing[]) {
  return call<{ ok: boolean }>('/api/internal/immo/ads', {
    method: 'POST',
    body: JSON.stringify({ queryId, ads }),
  });
}

/** Les annonces d'un modèle, versées dans la base commune à tous les comptes. */
export function ingestMarketAds(queryId: string, ads: ScrapedListing[]) {
  return call<{ ok: boolean }>('/api/internal/market/ads', {
    method: 'POST',
    body: JSON.stringify({ queryId, ads }),
  });
}

/**
 * Au démarrage : les collectes restées en cours sont mortes avec l'ancien
 * collecteur. Seules celles antérieures à ce démarrage sont visées, pour ne
 * pas tuer une demande arrivée entre-temps.
 */
export function abandonMarketQueries(before: Date) {
  return call<{ ok: boolean; abandoned: number }>('/api/internal/market/abandon', {
    method: 'POST',
    body: JSON.stringify({ before: before.toISOString() }),
  });
}

/** Modèles surveillés à relever maintenant, que l'application réserve pour nous. */
export function claimDueMarket() {
  return call<{
    jobs: {
      queryId: string;
      runId: string;
      brand: string;
      model: string;
      yearMin: number | null;
      yearMax: number | null;
      powerMin: number | null;
      powerMax: number | null;
      codes: { brand: string; model: string } | null;
      mode: 'full' | 'fresh';
    }[];
  }>('/api/internal/market/claim', { method: 'POST', body: '{}' });
}

/** L'annonce lue pour une négociation, ou ce qui a empêché de la lire. */
export function reportAd(negotiationId: string, ad: ScrapedListing | null, error: string | null) {
  return call<{ ok: boolean }>(`/api/internal/negotiations/${encodeURIComponent(negotiationId)}`, {
    method: 'POST',
    body: JSON.stringify({ ad, error }),
  });
}
