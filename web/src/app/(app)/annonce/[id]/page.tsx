'use client';

import { use } from 'react';
import Link from 'next/link';
import { PriceChart } from '@/components/price-chart';
import { useApi } from '@/lib/client';
import { formatDateTime, formatPrice, relativeTime } from '@/lib/format';

interface DetailResponse {
  listing: {
    lbcId: string;
    title: string;
    url: string;
    imageUrl: string | null;
    location: string | null;
    sellerType: 'pro' | 'private' | null;
    currentPrice: number | null;
    isActive: boolean;
    firstSeenAt: string;
    lastSeenAt: string;
    history: { price: number; observedAt: string }[];
  };
}

export default function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading, error } = useApi<DetailResponse>(`/api/listings/${id}`);

  if (loading) {
    return <div className="h-64 animate-pulse rounded-2xl border border-ink-line bg-ink-soft" />;
  }
  if (error || !data) {
    return <p className="py-10 text-center text-sm text-zinc-500">Annonce introuvable.</p>;
  }

  const { listing } = data;
  const first = listing.history[0]?.price ?? null;
  const delta =
    listing.currentPrice !== null && first !== null ? listing.currentPrice - first : null;

  return (
    <>
      <header className="flex items-center gap-3 pb-4 pt-1">
        <Link
          href="/"
          aria-label="Retour"
          className="rounded-full border border-ink-line bg-ink-soft p-2 active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" strokeWidth="1.8">
            <path d="m14 6-6 6 6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <h1 className="line-clamp-1 flex-1 text-[15px] font-medium">{listing.title}</h1>
      </header>

      <section className="mb-4 flex gap-3">
        {listing.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.imageUrl}
            alt=""
            className="h-24 w-24 shrink-0 rounded-2xl object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-3xl font-semibold tracking-tight">
            {formatPrice(listing.currentPrice)}
          </div>
          {delta !== null && delta !== 0 ? (
            <div className={`text-sm font-medium ${delta < 0 ? 'text-down' : 'text-up'}`}>
              {delta < 0 ? '↓' : '↑'} {formatPrice(Math.abs(delta))} depuis le premier relevé
            </div>
          ) : (
            <div className="text-sm text-zinc-500">Prix inchangé depuis le premier relevé</div>
          )}
          <div className="mt-1 text-xs text-zinc-600">
            {listing.location ?? 'Lieu inconnu'}
            {listing.sellerType && ` · ${listing.sellerType === 'pro' ? 'Pro' : 'Particulier'}`}
          </div>
          {!listing.isActive && (
            <div className="mt-1.5 inline-block rounded-full bg-ink-line px-2 py-0.5 text-[11px] text-zinc-400">
              Retirée · vue {relativeTime(listing.lastSeenAt)}
            </div>
          )}
        </div>
      </section>

      <PriceChart points={listing.history} until={listing.lastSeenAt} />

      <h2 className="mb-2 mt-6 text-sm font-medium text-zinc-300">
        Changements de prix ({Math.max(listing.history.length - 1, 0)})
      </h2>

      {/* Doublon tabulaire du graphe : lisible sans percevoir les couleurs. */}
      <div className="overflow-hidden rounded-2xl border border-ink-line">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-ink-soft text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Prix</th>
              <th className="px-3 py-2 text-right font-medium">Variation</th>
            </tr>
          </thead>
          <tbody>
            {[...listing.history].reverse().map((point, index, array) => {
              const previous = array[index + 1];
              const change = previous ? point.price - previous.price : null;
              return (
                <tr key={point.observedAt} className="border-t border-ink-line">
                  <td className="px-3 py-2.5 text-zinc-400">{formatDateTime(point.observedAt)}</td>
                  <td className="px-3 py-2.5 font-medium">{formatPrice(point.price)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {change === null ? (
                      <span className="text-zinc-600">premier relevé</span>
                    ) : (
                      <span className={change < 0 ? 'text-down' : 'text-up'}>
                        {change < 0 ? '↓' : '↑'} {formatPrice(Math.abs(change))}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <a
        href={listing.url}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-4 block rounded-xl border border-ink-line bg-ink-soft px-4 py-3.5 text-center text-sm font-medium text-zinc-200 active:scale-[0.99]"
      >
        Ouvrir sur leboncoin ↗
      </a>
    </>
  );
}
