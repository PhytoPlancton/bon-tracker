'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDate, formatDateTime, formatPrice } from '@/lib/format';

export interface PricePoint {
  price: number;
  observedAt: string;
}

const SERIES = '#ff8f45';
const DOWN = '#4ade80';
const UP = '#f87171';

const PADDING = { top: 18, right: 14, bottom: 26, left: 52 };
const HEIGHT = 240;

/**
 * Historique de prix en marches d'escalier : un prix reste celui affiché
 * jusqu'au changement suivant, une interpolation linéaire inventerait des
 * valeurs intermédiaires qui n'ont jamais existé.
 */
export function PriceChart({ points, until }: { points: PricePoint[]; until: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const series = useMemo(() => {
    const parsed = points
      .map((point) => ({ price: point.price, time: new Date(point.observedAt).getTime() }))
      .sort((a, b) => a.time - b.time);
    if (!parsed.length) return [];
    // Le dernier prix court jusqu'à la dernière observation de l'annonce.
    const end = Math.max(new Date(until).getTime(), parsed[parsed.length - 1].time);
    return [...parsed, { price: parsed[parsed.length - 1].price, time: end, isNow: true }];
  }, [points, until]);

  const geometry = useMemo(() => {
    if (!width || series.length < 2) return null;

    const innerWidth = width - PADDING.left - PADDING.right;
    const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;
    const times = series.map((item) => item.time);
    const prices = series.map((item) => item.price);

    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const spanTime = Math.max(maxTime - minTime, 1);

    const rawMin = Math.min(...prices);
    const rawMax = Math.max(...prices);
    // Un prix constant garde une bande lisible plutôt qu'une ligne collée au bord.
    const pad = rawMax === rawMin ? Math.max(rawMax * 0.05, 1) : (rawMax - rawMin) * 0.18;
    const minPrice = rawMin - pad;
    const maxPrice = rawMax + pad;

    const x = (time: number) => PADDING.left + ((time - minTime) / spanTime) * innerWidth;
    const y = (price: number) =>
      PADDING.top + innerHeight - ((price - minPrice) / (maxPrice - minPrice)) * innerHeight;

    let path = `M ${x(series[0].time)} ${y(series[0].price)}`;
    for (let i = 1; i < series.length; i += 1) {
      path += ` L ${x(series[i].time)} ${y(series[i - 1].price)}`;
      path += ` L ${x(series[i].time)} ${y(series[i].price)}`;
    }
    const area = `${path} L ${x(series[series.length - 1].time)} ${PADDING.top + innerHeight} L ${x(
      series[0].time,
    )} ${PADDING.top + innerHeight} Z`;

    return { x, y, path, area, minTime, maxTime, rawMin, rawMax, innerHeight };
  }, [series, width]);

  const locate = useCallback(
    (clientX: number) => {
      const element = containerRef.current;
      if (!element || !geometry) return;
      const bounds = element.getBoundingClientRect();
      const position = clientX - bounds.left;
      let closest = 0;
      let best = Infinity;
      // On ne propose que les vrais changements de prix, pas le point « aujourd'hui ».
      for (let i = 0; i < points.length; i += 1) {
        const distance = Math.abs(geometry.x(series[i].time) - position);
        if (distance < best) {
          best = distance;
          closest = i;
        }
      }
      setHover(closest);
    },
    [geometry, points.length, series],
  );

  if (series.length < 2 || !geometry) {
    return (
      <div
        ref={containerRef}
        className="flex h-[240px] items-center justify-center rounded-2xl border border-ink-line bg-ink-soft text-sm text-zinc-500"
      >
        {points.length ? 'Un seul relevé pour l’instant' : 'Aucun relevé'}
      </div>
    );
  }

  const active = hover !== null ? points[hover] : null;
  const previous = hover !== null && hover > 0 ? points[hover - 1] : null;
  const delta = active && previous ? active.price - previous.price : null;

  return (
    <div className="rounded-2xl border border-ink-line bg-ink-soft p-1">
      <div
        ref={containerRef}
        className="relative touch-pan-y select-none"
        onMouseMove={(event) => locate(event.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(event) => locate(event.touches[0].clientX)}
        onTouchMove={(event) => locate(event.touches[0].clientX)}
        onTouchEnd={() => setHover(null)}
      >
        <svg width={width || '100%'} height={HEIGHT} role="img" aria-label="Évolution du prix">
          <defs>
            <linearGradient id="price-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity="0.28" />
              <stop offset="100%" stopColor={SERIES} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Repères horizontaux volontairement discrets. */}
          {[geometry.rawMax, geometry.rawMin].map((price) => (
            <g key={price}>
              <line
                x1={PADDING.left}
                x2={width - PADDING.right}
                y1={geometry.y(price)}
                y2={geometry.y(price)}
                stroke="#23272e"
                strokeWidth="1"
              />
              <text
                x={PADDING.left - 8}
                y={geometry.y(price) + 4}
                textAnchor="end"
                className="fill-zinc-500 text-[10px]"
              >
                {formatPrice(price)}
              </text>
            </g>
          ))}

          <path d={geometry.area} fill="url(#price-area)" />
          <path
            d={geometry.path}
            fill="none"
            stroke={SERIES}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {points.map((point, index) => {
            const previousPrice = index > 0 ? points[index - 1].price : null;
            const color =
              previousPrice === null ? SERIES : point.price < previousPrice ? DOWN : UP;
            const isActive = hover === index;
            return (
              <circle
                key={`${point.observedAt}-${index}`}
                cx={geometry.x(new Date(point.observedAt).getTime())}
                cy={geometry.y(point.price)}
                r={isActive ? 6 : 4.5}
                fill={color}
                stroke="#14161a"
                strokeWidth="2"
              />
            );
          })}

          {active && (
            <line
              x1={geometry.x(new Date(active.observedAt).getTime())}
              x2={geometry.x(new Date(active.observedAt).getTime())}
              y1={PADDING.top}
              y2={PADDING.top + geometry.innerHeight}
              stroke="#3f4650"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}

          <text x={PADDING.left} y={HEIGHT - 8} className="fill-zinc-600 text-[10px]">
            {formatDate(new Date(geometry.minTime))}
          </text>
          <text
            x={width - PADDING.right}
            y={HEIGHT - 8}
            textAnchor="end"
            className="fill-zinc-600 text-[10px]"
          >
            {formatDate(new Date(geometry.maxTime))}
          </text>
        </svg>

        {active && (
          <div
            className="pointer-events-none absolute top-1 rounded-xl border border-ink-line bg-ink/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
            style={{
              left: Math.min(
                Math.max(geometry.x(new Date(active.observedAt).getTime()) - 70, 4),
                Math.max(width - 148, 4),
              ),
            }}
          >
            <div className="font-semibold text-zinc-100">{formatPrice(active.price)}</div>
            <div className="text-[10px] text-zinc-500">{formatDateTime(active.observedAt)}</div>
            {delta !== null && delta !== 0 && (
              <div
                className="mt-0.5 text-[10px] font-medium"
                style={{ color: delta < 0 ? DOWN : UP }}
              >
                {delta < 0 ? '↓' : '↑'} {formatPrice(Math.abs(delta))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
