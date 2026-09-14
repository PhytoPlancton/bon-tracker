import Link from 'next/link';
import { Sparkline } from './sparkline';
import { formatPrice, relativeTime } from '@/lib/format';

export interface ListingCardData {
  lbcId: string;
  title: string;
  imageUrl: string | null;
  location: string | null;
  sellerType: 'pro' | 'private' | null;
  currentPrice: number | null;
  initialPrice: number | null;
  priceChangeCount: number;
  lastSeenAt: string;
  isActive: boolean;
  history?: number[];
}

export function ListingCard({ listing }: { listing: ListingCardData }) {
  const delta =
    listing.currentPrice !== null && listing.initialPrice !== null
      ? listing.currentPrice - listing.initialPrice
      : null;

  return (
    <Link
      href={`/annonce/${listing.lbcId}`}
      className="flex items-stretch gap-3 rounded-2xl border border-ink-line bg-ink-soft p-2.5 active:scale-[0.99] transition-transform"
    >
      <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-ink">
        {listing.imageUrl ? (
          // Image distante non optimisée : elle change à chaque republication.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-700">—</div>
        )}
        {!listing.isActive && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/75 text-[10px] font-medium text-zinc-400">
            retirée
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-zinc-100">
          {listing.title}
        </h3>

        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[17px] font-semibold tracking-tight text-white">
              {formatPrice(listing.currentPrice)}
            </div>
            {delta !== null && delta !== 0 ? (
              // Flèche + montant : la variation ne repose jamais sur la couleur seule.
              <div
                className={`text-[11px] font-medium ${delta < 0 ? 'text-down' : 'text-up'}`}
              >
                {delta < 0 ? '↓' : '↑'} {formatPrice(Math.abs(delta))}
                <span className="ml-1 text-zinc-600">
                  · {listing.priceChangeCount} modif{listing.priceChangeCount > 1 ? 's' : ''}
                </span>
              </div>
            ) : (
              <div className="text-[11px] text-zinc-600">
                prix stable · vu {relativeTime(listing.lastSeenAt)}
              </div>
            )}
          </div>

          <div className="shrink-0 pb-0.5">
            <Sparkline prices={listing.history ?? []} />
          </div>
        </div>
      </div>
    </Link>
  );
}
