'use client';

import { useEffect, useRef, useState } from 'react';
import { formatPrice } from '@/lib/format';

const NORMAL = '#ff8f45';
const DEAL = '#4ade80';

const HEIGHT = 96;
const PADDING = { left: 10, right: 10, top: 22, bottom: 20 };

export interface PricePoint {
  lbcId: string;
  price: number;
  title: string;
  url: string;
}

/**
 * Situe chaque annonce du segment sur une échelle de prix.
 *
 * Un point par annonce plutôt qu'un histogramme : on ne cherche pas la forme
 * de la distribution mais où se trouve telle voiture, et ce qui dépasse à
 * gauche. La bande grise couvre la moitié centrale du marché ; ce qui en sort
 * par la gauche mérite un appel.
 */
export function PriceDistribution({
  prices,
  median,
  p25,
  p75,
  highlight,
}: {
  prices: PricePoint[];
  median: number;
  p25: number;
  p75: number;
  highlight?: string | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<PricePoint | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!prices.length) return null;

  const values = prices.map((point) => point.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const inner = Math.max(width - PADDING.left - PADDING.right, 1);
  const x = (price: number) => PADDING.left + ((price - min) / span) * inner;

  return (
    <div ref={container} className="relative">
      <svg width={width || '100%'} height={HEIGHT} role="img" aria-label="Répartition des prix du segment">
        {/* Moitié centrale du marché : au-delà, on s'éloigne de l'ordinaire. */}
        <rect
          x={x(p25)}
          width={Math.max(x(p75) - x(p25), 1)}
          y={PADDING.top - 6}
          height={HEIGHT - PADDING.top - PADDING.bottom + 12}
          fill="#23272e"
          rx="4"
        />

        <line
          x1={x(median)}
          x2={x(median)}
          y1={PADDING.top - 10}
          y2={HEIGHT - PADDING.bottom + 6}
          stroke="#6b7280"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
        <text x={x(median)} y={12} textAnchor="middle" className="fill-zinc-400 text-[10px]">
          médiane {formatPrice(median)}
        </text>

        {prices.map((point, index) => {
          const isDeal = point.price < p25;
          const isHighlighted = highlight === point.lbcId;
          // Léger étagement vertical : sans lui, des prix voisins se cachent.
          const row = (index % 3) - 1;
          return (
            <a
              key={point.lbcId}
              href={point.url}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`${point.title} — ${formatPrice(point.price)}`}
            >
              {/* Cible tactile plus large que le point lui-même. */}
              <circle
                cx={x(point.price)}
                cy={(HEIGHT - PADDING.bottom + PADDING.top) / 2 + row * 9}
                r={12}
                fill="transparent"
                onMouseEnter={() => setHover(point)}
                onMouseLeave={() => setHover(null)}
                onTouchStart={() => setHover(point)}
              />
              <circle
                cx={x(point.price)}
                cy={(HEIGHT - PADDING.bottom + PADDING.top) / 2 + row * 9}
                r={isHighlighted ? 6 : 4.5}
                fill={isDeal ? DEAL : NORMAL}
                fillOpacity={isHighlighted ? 1 : 0.85}
                stroke={isHighlighted ? '#fff' : '#14161a'}
                strokeWidth={isHighlighted ? 2 : 1.5}
                className="pointer-events-none"
              />
            </a>
          );
        })}

        <text x={PADDING.left} y={HEIGHT - 4} className="fill-zinc-600 text-[10px]">
          {formatPrice(min)}
        </text>
        <text
          x={width - PADDING.right}
          y={HEIGHT - 4}
          textAnchor="end"
          className="fill-zinc-600 text-[10px]"
        >
          {formatPrice(max)}
        </text>
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute top-0 max-w-[70%] rounded-lg border border-ink-line bg-ink/95 px-2 py-1 shadow"
          style={{ left: Math.min(Math.max(x(hover.price) - 60, 0), Math.max(width - 140, 0)) }}
        >
          <div className="text-[11px] font-semibold text-zinc-100">{formatPrice(hover.price)}</div>
          <div className="truncate text-[10px] text-zinc-500">{hover.title}</div>
        </div>
      )}
    </div>
  );
}
