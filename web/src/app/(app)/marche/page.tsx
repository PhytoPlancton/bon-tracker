'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PriceDistribution } from '@/components/price-distribution';
import { useApi } from '@/lib/client';
import { formatPrice } from '@/lib/format';

interface MarketListing {
  lbcId: string;
  title: string;
  url: string;
  location: string | null;
  price: number;
  gap: number;
  gapRatio: number;
  firstSeenAt: string;
  drops: number;
  totalDrop: number;
  lastDropAt: string | null;
}

interface Segment {
  source: string;
  name: string;
  details: string | null;
  active: number;
  stats: {
    median: number;
    p25: number;
    p75: number;
    min: number;
    max: number;
    medianBefore: number | null;
    trend: number | null;
  } | null;
  lifespan: { median: number; sample: number } | null;
  deals: MarketListing[];
  motivated: MarketListing[];
  prices: { lbcId: string; price: number }[];
}

export default function MarketPage() {
  const { data, loading } = useApi<{ segments: Segment[] }>('/api/market');
  const segments = data?.segments ?? [];
  const [openSegment, setOpenSegment] = useState<string | null>(null);

  return (
    <>
      <header className="pb-4 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">Marché</h1>
        <p className="text-xs text-zinc-500">
          Ce que valent réellement les annonces que tu suis.
        </p>
      </header>

      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((index) => (
            <div key={index} className="h-56 animate-pulse rounded-2xl border border-ink-line bg-ink-soft" />
          ))}
        </div>
      ) : segments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-line px-5 py-10 text-center text-sm text-zinc-500">
            Aucun segment à analyser. Le marché se lit par recherche : active-en une
          dans l’onglet Recherches, puis lance un relevé.
        </div>
      ) : (
        <div className="space-y-3">
          {segments.map((segment) => (
            <SegmentCard
              key={segment.source}
              segment={segment}
              open={openSegment === segment.source}
              onToggle={() =>
                setOpenSegment(openSegment === segment.source ? null : segment.source)
              }
            />
          ))}
        </div>
      )}

      <p className="mt-4 px-1 text-[11px] leading-relaxed text-zinc-600">
        Chaque segment correspond à une de tes recherches, donc à un modèle et une
        tranche d’années. À l’intérieur, les prix restent sensibles à l’état et au
        kilométrage : une annonce sous le marché peut l’être pour de bonnes raisons.
        Ces repères disent où regarder, pas quoi acheter.
      </p>
    </>
  );
}

function SegmentCard({
  segment,
  open,
  onToggle,
}: {
  segment: Segment;
  open: boolean;
  onToggle: () => void;
}) {
  const { stats } = segment;

  return (
    <section className="overflow-hidden rounded-2xl border border-ink-line bg-ink-soft">
      <button onClick={onToggle} className="w-full px-4 pt-4 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-medium text-zinc-100">{segment.name}</h2>
            {segment.details && (
              <p className="mt-0.5 truncate text-[11px] text-zinc-500">{segment.details}</p>
            )}
          </div>
          <span className="shrink-0 rounded-full bg-ink px-2 py-0.5 text-[11px] text-zinc-400">
            {segment.active} en ligne
          </span>
        </div>

        {stats ? (
          <div className="mt-3 flex items-end gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-600">Prix médian</div>
              <div className="text-2xl font-semibold tracking-tight text-white">
                {formatPrice(stats.median)}
              </div>
            </div>
            {stats.trend !== null && Math.abs(stats.trend) >= 0.005 && (
              <div
                className={`pb-1 text-[12px] font-medium ${
                  stats.trend < 0 ? 'text-down' : 'text-up'
                }`}
              >
                {stats.trend < 0 ? '↓' : '↑'} {Math.abs(stats.trend * 100).toFixed(1)} % sur 30 j
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-[12px] text-zinc-500">
            Pas assez d’annonces en ligne pour un prix de référence.
          </p>
        )}
      </button>

      {stats && (
        <div className="px-4 pb-1 pt-2">
          <PriceDistribution
            prices={segment.prices}
            median={stats.median}
            p25={stats.p25}
            p75={stats.p75}
          />
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-600">
            La moitié des annonces se situe entre {formatPrice(stats.p25)} et{' '}
            {formatPrice(stats.p75)}.
          </p>
        </div>
      )}

      <div className="px-4 pb-4 pt-3">
        {segment.deals.length > 0 && (
          <Group title={`Sous le marché · ${segment.deals.length}`}>
            {segment.deals.map((listing) => (
              <Row key={listing.lbcId} listing={listing} kind="deal" />
            ))}
          </Group>
        )}

        {open && (
          <>
            {segment.motivated.length > 0 && (
              <Group title={`Vendeurs qui baissent · ${segment.motivated.length}`}>
                {segment.motivated.map((listing) => (
                  <Row key={listing.lbcId} listing={listing} kind="motivated" />
                ))}
              </Group>
            )}

            {segment.lifespan && (
              <p className="mt-3 rounded-xl bg-ink px-3 py-2.5 text-[12px] leading-relaxed text-zinc-400">
                Une annonce de ce segment reste en ligne{' '}
                <strong className="text-zinc-200">{segment.lifespan.median} jours</strong> en
                médiane, avant de disparaître.{' '}
                <span className="text-zinc-600">
                  Sur {segment.lifespan.sample} annonces déjà parties.
                </span>
              </p>
            )}
          </>
        )}

        {(segment.motivated.length > 0 || segment.lifespan) && (
          <button
            onClick={onToggle}
            className="mt-3 w-full rounded-xl border border-ink-line py-2 text-[12px] font-medium text-zinc-400"
          >
            {open ? 'Replier' : 'Tout voir'}
          </button>
        )}
      </div>
    </section>
  );
}

function daysOnline(since: string): number {
  return Math.max(Math.round((Date.now() - new Date(since).getTime()) / 86_400_000), 0);
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-zinc-600">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ listing, kind }: { listing: MarketListing; kind: 'deal' | 'motivated' }) {
  return (
    <Link
      href={`/annonce/${listing.lbcId}`}
      className="flex items-center gap-3 rounded-xl bg-ink px-3 py-2.5 active:scale-[0.99]"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-zinc-200">{listing.title}</div>
        <div className="mt-0.5 truncate text-[11px] text-zinc-600">
          {listing.location ?? 'Lieu inconnu'} · {daysOnline(listing.firstSeenAt)} j en ligne
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="text-[14px] font-semibold text-white">{formatPrice(listing.price)}</div>
        {kind === 'deal' ? (
          // L'écart porte le signe, jamais la couleur seule.
          <div className="text-[11px] font-medium text-down">
            ↓ {formatPrice(Math.abs(listing.gap))} · {Math.round(Math.abs(listing.gapRatio) * 100)} %
          </div>
        ) : (
          <div className="text-[11px] font-medium text-down">
            ↓ {formatPrice(listing.totalDrop)} en {listing.drops} baisses
          </div>
        )}
      </div>
    </Link>
  );
}
