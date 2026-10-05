'use client';

import { useMemo } from 'react';
import { MarketChart, type ChartPoint } from './market-chart';

export interface KmPoint {
  lbcId: string;
  title: string;
  url: string;
  price: number;
  km: number | null;
  year: number | null;
  version: string | null;
  location: string | null;
  imageUrl?: string | null;
  sellerType?: 'pro' | 'private' | null;
  gearbox?: string | null;
  versionGuessed?: boolean;
  flags?: string[];
}

type Trend = { version: string | null; points: { km: number; price: number }[] };

/** Plus serré, un zoom ne montrerait plus qu'une ou deux voitures. */
const MIN_SPAN = { price: 800, km: 3_000 };

/** Des plus anciennes aux plus récentes : du brun au pêche. */
const OLD = [184, 89, 28];
const RECENT = [255, 214, 176];
const NO_YEAR = '#52525b';

/** Une teinte franche par motorisation ; au-delà, le gris. */
const PALETTE = ['#ff8f45', '#38bdf8', '#4ade80', '#c084fc', '#facc15', '#f472b6'];
const OTHER = '#71717a';

export function versionColor(order: string[], name: string | null | undefined): string {
  const index = name ? order.indexOf(name) : -1;
  return index >= 0 && index < PALETTE.length ? PALETTE[index] : OTHER;
}

export type ColorBy = 'year' | 'version';

/**
 * Nuage prix / kilométrage d'un modèle : le prix en abscisse, le
 * kilométrage en ordonnée, une couleur par motorisation ou par année.
 */
export function PriceKmChart({
  points,
  trends,
  target,
  colorBy = 'year',
  versionOrder = [],
  onPickVersion,
  targetLabel = 'ta voiture',
}: {
  points: KmPoint[];
  /** Médiane par tranche de km ; `version` à null pour l'ensemble affiché. */
  trends: Trend[];
  target?: { km: number; price: number } | null;
  colorBy?: ColorBy;
  versionOrder?: string[];
  onPickVersion?: (name: string) => void;
  /** Ce que désigne le repère blanc : ta voiture, ou l'annonce négociée. */
  targetLabel?: string;
}) {
  // Mêmes annonces, même tableau : le graphique repart de zéro (zoom, fiche)
  // à chaque nouveau nuage, pas à chaque frappe dans un champ voisin.
  const chartPoints = useMemo<ChartPoint[]>(() => points.map((point) => ({
    lbcId: point.lbcId,
    title: point.title,
    url: point.url,
    price: point.price,
    y: point.km,
    group: point.version ?? 'Non précisée',
    shade: point.year,
    details: [point.year, point.km !== null ? `${point.km.toLocaleString('fr-FR')} km` : null, point.gearbox],
    subtitle: point.version ? `${point.version}${point.versionGuessed ? ' (déduite du titre)' : ''}` : null,
    imageUrl: point.imageUrl,
    sellerType: point.sellerType,
    location: point.location,
    flags: point.flags,
  })), [points]);

  return (
    <MarketChart
      points={chartPoints}
      trends={trends.map((trend) => ({
        group: trend.version,
        points: trend.points.map((step) => ({ y: step.km, price: step.price })),
      }))}
      target={target ? { y: target.km, price: target.price } : null}
      coloring={
        colorBy === 'version'
          ? {
              by: 'group',
              groups: versionOrder.slice(0, PALETTE.length).map((name) => ({ name, color: versionColor(versionOrder, name) })),
              other: OTHER,
              others: versionOrder.length > PALETTE.length,
              onPick: onPickVersion,
            }
          : { by: 'shade', from: OLD, to: RECENT, missing: NO_YEAR }
      }
      axis={{ label: 'km ↑', tick: compactKm, minSpan: MIN_SPAN.km, gapAt: 'à ce km', missing: 'sans kilométrage' }}
      priceMinSpan={MIN_SPAN.price}
      targetLabel={targetLabel}
    />
  );
}

function compactKm(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k km` : `${Math.round(value)} km`;
}
