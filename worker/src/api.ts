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
  /**
   * Caractéristiques telles que le site les publie : puissance, année,
   * kilométrage, boîte. Relevées sans présumer lesquelles existent — c'est
   * la seule base fiable pour comparer deux voitures entre elles.
   */
  attributes?: Record<string, string>;
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
    body: JSON.stringify({ uid, source, listings }),
  });
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
