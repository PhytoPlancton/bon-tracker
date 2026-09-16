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

/** La session leboncoin est stockée chiffrée côté web : le worker ne garde rien sur disque. */
export function fetchStoredSession() {
  return call<{ storageState: Record<string, unknown> | null; updatedAt: string | null }>(
    '/api/internal/session',
  );
}

export function storeSession(storageState: Record<string, unknown>) {
  return call<{ ok: boolean }>('/api/internal/session', {
    method: 'PUT',
    body: JSON.stringify({ storageState }),
  });
}

export function ingest(source: string, listings: ScrapedListing[]) {
  return call<RunStats>('/api/internal/ingest', {
    method: 'POST',
    body: JSON.stringify({ source, listings }),
  });
}

export function fetchTrackedSearches() {
  return call<{ searches: TrackedSearch[] }>('/api/internal/searches');
}

export function reportSearches(
  searches: { lbcSearchId: string; name: string; url: string; details?: string | null; itemCount?: number }[],
) {
  return call<{ upserted: number }>('/api/internal/searches', {
    method: 'POST',
    body: JSON.stringify({ searches }),
  });
}

export function reportRun(payload: {
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
