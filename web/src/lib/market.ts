import { collections } from './mongo';
import type { Listing, ListingSource } from './types';

/**
 * Lecture de marché à partir des annonces suivies.
 *
 * Chaque recherche découpe déjà le marché en segments comparables — un modèle,
 * une génération, une tranche d'années. C'est ce découpage qu'on exploite :
 * comparer des prix n'a de sens qu'à l'intérieur d'un de ces ensembles.
 */

/** En deçà, une médiane ne veut rien dire : on préfère l'annoncer que la montrer. */
const MIN_SAMPLE = 5;

/** Une annonce est signalée quand elle est nettement sous le premier quartile. */
const DEAL_MARGIN = 0.03;

export interface MarketListing {
  lbcId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  location: string | null;
  price: number;
  /** Écart au prix médian du segment, en euros puis en part. */
  gap: number;
  gapRatio: number;
  firstSeenAt: string;
  /** Nombre de baisses observées, et total cédé depuis le premier relevé. */
  drops: number;
  totalDrop: number;
  lastDropAt: string | null;
}

export interface MarketSegment {
  source: string;
  name: string;
  details: string | null;
  /** Annonces en ligne au moment du calcul. */
  active: number;
  /** Null tant que l'échantillon est trop mince pour conclure. */
  stats: {
    median: number;
    p25: number;
    p75: number;
    min: number;
    max: number;
    /** Médiane telle qu'elle était il y a 30 jours, si l'historique le permet. */
    medianBefore: number | null;
    trend: number | null;
  } | null;
  /** Jours entre publication et disparition, sur les annonces déjà parties. */
  lifespan: { median: number; sample: number } | null;
  /** Les annonces les plus loin sous le marché. */
  deals: MarketListing[];
  /** Vendeurs qui ont déjà cédé du terrain, plusieurs fois. */
  motivated: MarketListing[];
  /** Tous les prix du segment, pour situer chaque annonce d'un regard. */
  prices: { lbcId: string; price: number }[];
}

export async function buildMarket(uid: string): Promise<MarketSegment[]> {
  const { listings, pricePoints, searches } = await collections();

  const [allListings, allPoints, allSearches] = await Promise.all([
    listings.find({ uid }, { projection: { _id: 0 } }).toArray(),
    pricePoints.find({ uid }, { projection: { _id: 0 } }).sort({ observedAt: 1 }).toArray(),
    searches.find({ uid, tracked: true }, { projection: { _id: 0 } }).toArray(),
  ]);

  const pointsByListing = new Map<string, { price: number; observedAt: Date }[]>();
  for (const point of allPoints) {
    const list = pointsByListing.get(point.lbcId) ?? [];
    list.push({ price: point.price, observedAt: new Date(point.observedAt) });
    pointsByListing.set(point.lbcId, list);
  }

  // Seules les recherches font des segments comparables : elles filtrent par
  // modèle et par années. Les favoris mêlent des générations entières, et une
  // médiane calculée dessus désignerait comme affaire toute voiture d'une
  // génération moins chère.
  const segments = allSearches.map((search) => ({
    source: `search:${search.lbcSearchId}`,
    name: search.name,
    details: search.details ?? null,
  }));

  return segments
    .map(({ source, name, details }) => {
      const members = allListings.filter((listing) =>
        listing.sources?.includes(source as ListingSource),
      );
      return buildSegment(source, name, details, members, pointsByListing);
    })
    .filter((segment) => segment.active > 0);
}

function buildSegment(
  source: string,
  name: string,
  details: string | null,
  members: Listing[],
  pointsByListing: Map<string, { price: number; observedAt: Date }[]>,
): MarketSegment {
  const active = members.filter((listing) => listing.isActive && listing.currentPrice !== null);
  const prices = active.map((listing) => listing.currentPrice as number).sort((a, b) => a - b);

  const stats =
    prices.length >= MIN_SAMPLE
      ? {
          median: quantile(prices, 0.5),
          p25: quantile(prices, 0.25),
          p75: quantile(prices, 0.75),
          min: prices[0],
          max: prices[prices.length - 1],
          ...trendOver(30, members, pointsByListing),
        }
      : null;

  const enriched: MarketListing[] = active.map((listing) => {
    const history = pointsByListing.get(listing.lbcId) ?? [];
    const price = listing.currentPrice as number;
    const median = stats?.median ?? price;

    let drops = 0;
    let totalDrop = 0;
    let lastDropAt: Date | null = null;
    for (let i = 1; i < history.length; i += 1) {
      const change = history[i].price - history[i - 1].price;
      if (change < 0) {
        drops += 1;
        totalDrop += -change;
        lastDropAt = history[i].observedAt;
      }
    }

    return {
      lbcId: listing.lbcId,
      title: listing.title,
      url: listing.url,
      imageUrl: listing.imageUrl ?? null,
      location: listing.location ?? null,
      price,
      gap: price - median,
      gapRatio: median > 0 ? (price - median) / median : 0,
      firstSeenAt: new Date(listing.firstSeenAt).toISOString(),
      drops,
      totalDrop,
      lastDropAt: lastDropAt ? lastDropAt.toISOString() : null,
    };
  });

  // Une affaire, c'est un prix nettement sous le premier quartile — pas
  // seulement sous la médiane, où se trouve la moitié des annonces.
  const deals = stats
    ? enriched
        .filter((listing) => listing.price < stats.p25 * (1 - DEAL_MARGIN))
        .sort((a, b) => a.gapRatio - b.gapRatio)
        .slice(0, 8)
    : [];

  const motivated = enriched
    .filter((listing) => listing.drops >= 2)
    .sort((a, b) => b.totalDrop - a.totalDrop)
    .slice(0, 8);

  return {
    source,
    name,
    details,
    active: active.length,
    stats,
    lifespan: lifespanOf(members),
    deals,
    motivated,
    prices: active.map((listing) => ({
      lbcId: listing.lbcId,
      price: listing.currentPrice as number,
    })),
  };
}

/**
 * Compare la médiane d'aujourd'hui à celle d'il y a N jours, reconstituée à
 * partir du dernier prix connu de chaque annonce à cette date. Reste nulle
 * tant que l'historique est trop court pour que la comparaison ait un sens.
 */
function trendOver(
  days: number,
  members: Listing[],
  pointsByListing: Map<string, { price: number; observedAt: Date }[]>,
): { medianBefore: number | null; trend: number | null } {
  const limit = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const before: number[] = [];
  for (const listing of members) {
    const history = pointsByListing.get(listing.lbcId) ?? [];
    const known = history.filter((point) => point.observedAt <= limit);
    if (!known.length) continue;
    // L'annonce devait encore être en ligne à cette date.
    if (!listing.isActive && new Date(listing.lastSeenAt) < limit) continue;
    before.push(known[known.length - 1].price);
  }

  if (before.length < MIN_SAMPLE) return { medianBefore: null, trend: null };

  const sorted = before.sort((a, b) => a - b);
  const medianBefore = quantile(sorted, 0.5);
  const current = members
    .filter((listing) => listing.isActive && listing.currentPrice !== null)
    .map((listing) => listing.currentPrice as number)
    .sort((a, b) => a - b);

  const median = quantile(current, 0.5);
  return {
    medianBefore,
    trend: medianBefore > 0 ? (median - medianBefore) / medianBefore : null,
  };
}

/** Durée entre première et dernière apparition, sur les annonces déjà parties. */
function lifespanOf(members: Listing[]): { median: number; sample: number } | null {
  const days = members
    .filter((listing) => !listing.isActive)
    .map((listing) => {
      const from = new Date(listing.firstSeenAt).getTime();
      const to = new Date(listing.lastSeenAt).getTime();
      return Math.max(Math.round((to - from) / (24 * 60 * 60 * 1000)), 0);
    })
    .sort((a, b) => a - b);

  if (days.length < MIN_SAMPLE) return null;
  return { median: quantile(days, 0.5), sample: days.length };
}

/** Quantile par interpolation linéaire, sur une liste déjà triée. */
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  return Math.round(sorted[low] + (sorted[high] - sorted[low]) * (position - low));
}
