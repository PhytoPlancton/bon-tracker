/**
 * « À quel prix vendre ma voiture » : trois prix, et le temps qu'il faut
 * compter à chacun.
 *
 * Les prix viennent des comparables de la voiture (même moteur, années et
 * kilométrages voisins) : bas de fourchette pour vendre vite, médiane pour le
 * prix du marché, haut de fourchette pour qui peut attendre.
 *
 * Le temps vient des annonces du modèle déjà parties : combien de jours elles
 * sont restées en ligne, selon que leur prix était sous, dans ou au-dessus de
 * leur propre marché. Une annonce partie n'est pas forcément vendue — retirée,
 * expirée — mais c'est la meilleure approximation qu'offrent des annonces.
 * Faute d'assez de départs observés, on montre l'âge des annonces encore en
 * ligne au même niveau de prix, en le disant : c'est une borne basse.
 *
 * Fonctions pures, utilisables côté client.
 */
import { estimate, type Ad, type Estimate, type Target } from './estimation';

export type Tier = 'fast' | 'market' | 'patient';

export interface SellingTier {
  tier: Tier;
  price: number;
  /** Jours en ligne médians observés à ce niveau de prix, ou null. */
  days: number | null;
  /** Nombre d'annonces sur lesquelles repose cette durée. */
  sample: number;
  /** « parties » : durée jusqu'au départ ; « en ligne » : âge des annonces toujours là. */
  basis: 'gone' | 'live' | null;
}

export interface SellingAdvice {
  peers: Estimate;
  tiers: SellingTier[];
  /** Départs observés sur le modèle, toutes positions de prix confondues. */
  goneObserved: number;
}

const DAY = 24 * 60 * 60 * 1000;
/** Sous ce nombre d'annonces, une durée médiane ne veut rien dire. */
const MIN_SAMPLE = 3;

/** Position d'un prix face à son marché : sous, dans, au-dessus. */
function tierOf(ratio: number): Tier {
  return ratio <= -0.03 ? 'fast' : ratio <= 0.05 ? 'market' : 'patient';
}

export function sellingAdvice(
  target: Target,
  live: Ad[],
  gone: (Ad & { daysOnline: number })[],
  now = new Date(),
): SellingAdvice | null {
  const peers = estimate(target, live);
  if (!peers) return null;

  // Chaque annonce, partie ou en ligne, est située face à ses propres comparables.
  const place = (ad: Ad) => {
    if (ad.km === null || ad.year === null) return null;
    const own = estimate({ km: ad.km, year: ad.year, version: ad.version }, live, ad.lbcId);
    return own ? tierOf((ad.price - own.median) / own.median) : null;
  };

  // Seules comptent les annonces de la même motorisation que la voiture à vendre.
  const sameEngine = (ad: Ad) => !target.version || ad.version === target.version;
  const goneByTier = new Map<Tier, number[]>();
  for (const ad of gone.filter(sameEngine)) {
    const tier = place(ad);
    if (tier) goneByTier.set(tier, [...(goneByTier.get(tier) ?? []), ad.daysOnline]);
  }
  const liveByTier = new Map<Tier, number[]>();
  for (const ad of live.filter(sameEngine)) {
    if (!ad.onlineSince) continue;
    const tier = place(ad);
    if (!tier) continue;
    const age = Math.max(0, Math.round((now.getTime() - new Date(ad.onlineSince).getTime()) / DAY));
    liveByTier.set(tier, [...(liveByTier.get(tier) ?? []), age]);
  }

  const prices: Record<Tier, number> = { fast: peers.p25, market: peers.median, patient: peers.p75 };
  // Une seule base pour les trois prix : mêler « parties en » et « en ligne
  // depuis » rendrait la comparaison trompeuse.
  const order = ['fast', 'market', 'patient'] as const;
  const basis: 'gone' | 'live' = order.every((tier) => (goneByTier.get(tier)?.length ?? 0) >= MIN_SAMPLE) ? 'gone' : 'live';
  const tiers = order.map((tier): SellingTier => {
    const sample = (basis === 'gone' ? goneByTier : liveByTier).get(tier) ?? [];
    const days = sample.length >= MIN_SAMPLE ? sample : [];
    return {
      tier,
      price: Math.round(prices[tier] / 100) * 100,
      days: days.length ? median(days) : null,
      sample: days.length,
      basis: days.length ? basis : null,
    };
  });

  return { peers, tiers, goneObserved: gone.filter(sameEngine).length };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
