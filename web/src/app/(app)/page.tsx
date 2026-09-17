'use client';

import { useMemo, useState } from 'react';
import { ListingCard, type ListingCardData } from '@/components/listing-card';
import { useApi } from '@/lib/client';
import { relativeTime } from '@/lib/format';

type SortKey = 'recent' | 'drop';

interface ListingsResponse {
  listings: (ListingCardData & { sources: string[] })[];
}

interface SearchesResponse {
  searches: { lbcSearchId: string; name: string; tracked: boolean }[];
}

interface StatusResponse {
  lastRun: { status: string; finishedAt: string | null; error: string | null } | null;
  hasSession: boolean;
}

export default function DashboardPage() {
  const { data, loading, reload } = useApi<ListingsResponse>('/api/listings');
  const { data: searchData } = useApi<SearchesResponse>('/api/searches');
  const { data: status } = useApi<StatusResponse>('/api/status');

  const [source, setSource] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('recent');

  const trackedSearches = (searchData?.searches ?? []).filter((item) => item.tracked);

  const listings = useMemo(() => {
    const all = data?.listings ?? [];
    const filtered =
      source === 'all' ? all : all.filter((listing) => listing.sources.includes(source));

    return [...filtered].sort((a, b) => {
      if (sort === 'drop') return dropRatio(a) - dropRatio(b);
      return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    });
  }, [data, source, sort]);

  const needsAttention = status?.lastRun?.status === 'needs_session' || status?.hasSession === false;

  return (
    <>
      <header className="flex items-center justify-between pb-4 pt-1">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Suivi</h1>
          <p className="text-xs text-zinc-500">
            {listings.length} annonce{listings.length > 1 ? 's' : ''}
            {status?.lastRun?.finishedAt && ` · relevé ${relativeTime(status.lastRun.finishedAt)}`}
          </p>
        </div>
        <button
          onClick={() => void reload()}
          aria-label="Recharger l’affichage"
          title="Recharger l’affichage (ne lance pas de relevé)"
          className="rounded-full border border-ink-line bg-ink-soft p-2.5 active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" strokeWidth="1.8">
            <path
              d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>

      {needsAttention && (
        <a
          href="/reglages"
          className="mb-4 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3.5 py-3 text-[13px] text-accent-soft"
        >
          <span aria-hidden="true">⚠</span>
          <span className="flex-1">
            La collecte est bloquée : session leboncoin à rétablir dans les réglages.
          </span>
          <span aria-hidden="true">›</span>
        </a>
      )}

      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={source === 'all'} onClick={() => setSource('all')} label="Tout" />
        <Chip
          active={source === 'favorites'}
          onClick={() => setSource('favorites')}
          label="★ Favoris"
        />
        {trackedSearches.map((search) => (
          <Chip
            key={search.lbcSearchId}
            active={source === `search:${search.lbcSearchId}`}
            onClick={() => setSource(`search:${search.lbcSearchId}`)}
            label={search.name}
          />
        ))}
      </div>

      <div className="mb-4 flex gap-4 text-[12px]">
        <SortLink active={sort === 'recent'} onClick={() => setSort('recent')} label="Récentes" />
        <SortLink active={sort === 'drop'} onClick={() => setSort('drop')} label="Plus grosses baisses" />
      </div>

      {loading ? (
        <SkeletonList />
      ) : listings.length === 0 ? (
        <EmptyState hasSession={status?.hasSession ?? false} />
      ) : (
        <div className="space-y-2.5">
          {listings.map((listing) => (
            <ListingCard key={listing.lbcId} listing={listing} />
          ))}
        </div>
      )}
    </>
  );
}

/** Variation relative depuis le premier prix connu ; négatif = baisse. */
function dropRatio(listing: ListingCardData): number {
  if (listing.currentPrice === null || !listing.initialPrice) return 0;
  return (listing.currentPrice - listing.initialPrice) / listing.initialPrice;
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
        active
          ? 'border-accent bg-accent text-ink font-medium'
          : 'border-ink-line bg-ink-soft text-zinc-400'
      }`}
    >
      {label}
    </button>
  );
}

function SortLink({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={active ? 'font-medium text-zinc-200 underline underline-offset-4' : 'text-zinc-500'}
    >
      {label}
    </button>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2.5">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="h-[92px] animate-pulse rounded-2xl border border-ink-line bg-ink-soft" />
      ))}
    </div>
  );
}

function EmptyState({ hasSession }: { hasSession: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-line px-5 py-10 text-center">
      <p className="text-sm text-zinc-400">Aucune annonce suivie pour l’instant.</p>
      <p className="mt-2 text-xs text-zinc-600">
        {hasSession
          ? 'Le prochain relevé récupérera tes favoris leboncoin.'
          : 'Connecte d’abord le compte leboncoin depuis les réglages.'}
      </p>
    </div>
  );
}
