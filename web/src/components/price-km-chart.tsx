'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatPrice } from '@/lib/format';

export interface KmPoint {
  lbcId: string;
  title: string;
  url: string;
  price: number;
  km: number | null;
  year: number | null;
  version: string | null;
  location: string | null;
}

const PADDING = { top: 14, right: 12, bottom: 28, left: 50 };
const HEIGHT = 300;

/** Des plus anciennes aux plus récentes : du brun au pêche. */
const OLD = [184, 89, 28];
const RECENT = [255, 214, 176];
const NO_YEAR = '#52525b';
const TREND = '#e4e4e7';
const TARGET = '#ffffff';

/** Une teinte franche par motorisation ; au-delà, le gris. */
const PALETTE = ['#ff8f45', '#38bdf8', '#4ade80', '#c084fc', '#facc15', '#f472b6'];
const OTHER = '#71717a';

export function versionColor(order: string[], name: string | null | undefined): string {
  const index = name ? order.indexOf(name) : -1;
  return index >= 0 && index < PALETTE.length ? PALETTE[index] : OTHER;
}

export type ColorBy = 'year' | 'version';

/**
 * Nuage prix / kilométrage : chaque point est une annonce en ligne.
 *
 * La couleur porte l'année, la ligne pointillée la médiane du marché par
 * tranche de kilométrage. Un point touché s'affiche en détail sous le
 * graphique, avec le lien vers l'annonce : au doigt, un survol n'existe pas.
 */
export function PriceKmChart({
  points,
  trends,
  target,
  colorBy = 'year',
  versionOrder = [],
  onPickVersion,
}: {
  points: KmPoint[];
  /** Médiane par tranche de km ; `version` à null pour l'ensemble affiché. */
  trends: { version: string | null; points: { km: number; price: number }[] }[];
  target?: { km: number; price: number } | null;
  colorBy?: ColorBy;
  versionOrder?: string[];
  onPickVersion?: (name: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotted = useMemo(
    () => points.filter((point): point is KmPoint & { km: number } => point.km !== null),
    [points],
  );

  const years = useMemo(() => {
    const known = plotted.map((point) => point.year).filter((year): year is number => year !== null);
    return known.length ? { min: Math.min(...known), max: Math.max(...known) } : null;
  }, [plotted]);

  const geometry = useMemo(() => {
    if (!width || !plotted.length) return null;
    const innerWidth = width - PADDING.left - PADDING.right;
    const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

    const kms = plotted.map((point) => point.km);
    const prices = plotted.map((point) => point.price);
    if (target) {
      kms.push(target.km);
      prices.push(target.price);
    }

    const maxKm = niceCeil(Math.max(...kms) * 1.04);
    // Partir de zéro gaspillerait la moitié de la largeur sur des modèles
    // anciens, qui ont tous beaucoup roulé.
    const minKm = niceFloor(Math.min(...kms) * 0.9);
    const rawMin = Math.min(...prices);
    const rawMax = Math.max(...prices);
    const pad = rawMax === rawMin ? rawMax * 0.1 : (rawMax - rawMin) * 0.08;
    const minPrice = Math.max(0, rawMin - pad);
    const maxPrice = rawMax + pad;

    const x = (km: number) => PADDING.left + ((km - minKm) / (maxKm - minKm || 1)) * innerWidth;
    const y = (price: number) =>
      PADDING.top + innerHeight - ((price - minPrice) / (maxPrice - minPrice || 1)) * innerHeight;

    return {
      x,
      y,
      innerHeight,
      innerWidth,
      xTicks: ticks(minKm, maxKm, width < 420 ? 4 : 6),
      yTicks: ticks(minPrice, maxPrice, 5),
    };
  }, [plotted, target, width]);

  const colorOf = (point: KmPoint) => {
    if (colorBy === 'version') return versionColor(versionOrder, point.version ?? 'Non précisée');
    const { year } = point;
    if (year === null || !years) return NO_YEAR;
    const share = years.max === years.min ? 1 : (year - years.min) / (years.max - years.min);
    const mix = OLD.map((channel, index) => Math.round(channel + (RECENT[index] - channel) * share));
    return `rgb(${mix.join(',')})`;
  };

  const current = plotted.find((point) => point.lbcId === selected) ?? null;
  const radius = plotted.length > 300 ? 3 : plotted.length > 120 ? 3.5 : 4.5;
  const missing = points.length - plotted.length;

  return (
    <div>
      <div ref={containerRef} className="relative w-full" style={{ height: HEIGHT }}>
        {geometry && (
          <svg width={width} height={HEIGHT} className="block select-none">
            {geometry.yTicks.map((tick) => (
              <g key={`y${tick}`}>
                <line
                  x1={PADDING.left}
                  x2={width - PADDING.right}
                  y1={geometry.y(tick)}
                  y2={geometry.y(tick)}
                  stroke="#23272e"
                />
                <text
                  x={PADDING.left - 6}
                  y={geometry.y(tick) + 3}
                  textAnchor="end"
                  className="fill-zinc-500 text-[10px]"
                >
                  {compactPrice(tick)}
                </text>
              </g>
            ))}
            {geometry.xTicks.map((tick) => (
              <text
                key={`x${tick}`}
                x={geometry.x(tick)}
                y={HEIGHT - 8}
                // La dernière graduation, collée au bord, se lirait coupée.
                textAnchor={geometry.x(tick) > width - PADDING.right - 20 ? 'end' : 'middle'}
                className="fill-zinc-500 text-[10px]"
              >
                {`${Math.round(tick / 1000)}k km`}
              </text>
            ))}

            {plotted.map((point) => (
              <circle
                key={point.lbcId}
                cx={geometry.x(point.km)}
                cy={geometry.y(point.price)}
                r={point.lbcId === selected ? radius + 3 : radius}
                fill={colorOf(point)}
                fillOpacity={selected && point.lbcId !== selected ? 0.45 : 0.9}
                stroke={point.lbcId === selected ? '#fff' : 'none'}
                strokeWidth={2}
                className="cursor-pointer"
                onClick={() => setSelected(point.lbcId === selected ? null : point.lbcId)}
              >
                <title>{`${point.title} — ${formatPrice(point.price)}`}</title>
              </circle>
            ))}

            {trends
              .filter((trend) => trend.points.length > 1)
              .map((trend) => (
              <polyline
                key={trend.version ?? 'all'}
                points={trend.points.map((step) => `${geometry.x(step.km)},${geometry.y(step.price)}`).join(' ')}
                fill="none"
                stroke={trend.version === null ? TREND : versionColor(versionOrder, trend.version)}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                strokeLinejoin="round"
                pointerEvents="none"
              />
            ))}

            {target && (
              <g pointerEvents="none">
                <circle
                  cx={geometry.x(target.km)}
                  cy={geometry.y(target.price)}
                  r={9}
                  fill="none"
                  stroke={TARGET}
                  strokeWidth={2}
                />
                <circle cx={geometry.x(target.km)} cy={geometry.y(target.price)} r={4} fill={TARGET} />
              </g>
            )}
          </svg>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-zinc-500">
        {colorBy === 'version' &&
          versionOrder.slice(0, PALETTE.length).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onPickVersion?.(name)}
              className="flex items-center gap-1.5"
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: versionColor(versionOrder, name) }}
              />
              {name}
            </button>
          ))}
        {colorBy === 'version' && versionOrder.length > PALETTE.length && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: OTHER }} />
            autres
          </span>
        )}
        {colorBy === 'year' && years && (
          <span className="flex items-center gap-1.5">
            {years.min}
            <span
              className="inline-block h-2 w-16 rounded-full"
              style={{
                background: `linear-gradient(90deg, rgb(${OLD.join(',')}), rgb(${RECENT.join(',')}))`,
              }}
            />
            {years.max}
          </span>
        )}
        {trends.some((trend) => trend.points.length > 1) && (
          <span className="flex items-center gap-1.5">
            <svg width="18" height="4">
              <line x1="0" x2="18" y1="2" y2="2" stroke={TREND} strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            prix médian
          </span>
        )}
        {target && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-white" />
            ta voiture
          </span>
        )}
        {missing > 0 && <span>{missing} sans kilométrage, hors graphique</span>}
      </div>

      {current ? (
        <a
          href={current.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block rounded-xl border border-ink-line bg-ink px-3 py-2.5 active:bg-ink-line"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[13px] text-zinc-100">{current.title}</div>
              <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                {[
                  current.year,
                  `${current.km.toLocaleString('fr-FR')} km`,
                  current.version,
                  current.location,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[14px] font-semibold text-white">{formatPrice(current.price)}</div>
              <div className="text-[11px] text-accent">Voir ↗</div>
            </div>
          </div>
        </a>
      ) : (
        <p className="mt-3 px-1 text-[11px] text-zinc-600">Touche un point pour voir l’annonce.</p>
      )}
    </div>
  );
}

function ticks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const result: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) result.push(value);
  return result;
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2);
}

function niceFloor(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.floor(value / (magnitude / 2)) * (magnitude / 2);
}

function compactPrice(value: number): string {
  if (value >= 1000) {
    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k€`;
  }
  return `${Math.round(value)}€`;
}
