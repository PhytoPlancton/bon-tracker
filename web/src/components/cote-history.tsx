'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatPrice } from '@/lib/format';

export interface Snapshot {
  day: string;
  count: number;
  median: number;
  p25: number;
  p75: number;
  versions: { name: string; count: number; median: number }[];
}

const HEIGHT = 150;
const PADDING = { top: 12, right: 10, bottom: 22, left: 48 };
const DAY = 24 * 60 * 60 * 1000;

/**
 * La cote d'une motorisation au fil des relevés : sa médiane de chaque jour. Une photo par jour de
 * relevé ; les veilles en prennent une chaque jour, d'où l'intérêt d'en poser
 * une sur un modèle qu'on suit.
 */
export function CoteHistory({ snapshots, version }: { snapshots: Snapshot[]; version: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  // Toujours une seule motorisation : toutes confondues, la médiane suivrait
  // le mélange des annonces en ligne (plus de 2.7 un jour, plus de 3.2 S le
  // lendemain), pas l'évolution des prix.
  const points = useMemo(
    () =>
      snapshots
        .map((snapshot) => {
          const own = snapshot.versions.find((item) => item.name === version);
          return own && own.count >= 3 ? { day: snapshot.day, median: own.median, count: own.count } : null;
        })
        .filter((point): point is NonNullable<typeof point> => point !== null),
    [snapshots, version],
  );

  const change = useMemo(() => variation(points), [points]);

  if (points.length < 2) {
    return (
      <p className="text-[12px] text-zinc-500">
        {points.length === 1
          ? `Une seule photo pour l’instant (${formatPrice(points[0].median)} le ${shortDay(points[0].day)}).`
          : 'Pas encore de photo de la cote.'}{' '}
        La courbe se dessine à chaque relevé ; une veille sur ce modèle en prend une par jour.
      </p>
    );
  }

  const times = points.map((point) => new Date(point.day).getTime());
  const values = points.map((point) => point.median);
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const v0 = Math.min(...values) * 0.97;
  const v1 = Math.max(...values) * 1.03;
  const innerWidth = Math.max(1, width - PADDING.left - PADDING.right);
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const x = (time: number) => PADDING.left + ((time - t0) / (t1 - t0 || 1)) * innerWidth;
  const y = (value: number) => PADDING.top + innerHeight - ((value - v0) / (v1 - v0 || 1)) * innerHeight;
  const line = points.map((point, index) => `${x(times[index])},${y(point.median)}`).join(' ');

  return (
    <div>
      {change && (
        <p className="mb-2 text-[13px] text-zinc-200">
          {/* Neutre : une hausse inquiète l'acheteur et réjouit le vendeur. */}
          <span className="font-semibold text-zinc-100">
            {change.ratio > 0 ? '+' : ''}
            {(change.ratio * 100).toFixed(1).replace('.', ',')} %
          </span>{' '}
          <span className="text-zinc-500">
            en {change.days} jours ({formatPrice(change.from)} → {formatPrice(change.to)})
          </span>
        </p>
      )}
      <div ref={ref} style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} className="block">
            {[v0 + (v1 - v0) * 0.15, (v0 + v1) / 2, v1 - (v1 - v0) * 0.15].map((value) => (
              <g key={value}>
                <line x1={PADDING.left} x2={width - PADDING.right} y1={y(value)} y2={y(value)} stroke="#23272e" />
                <text x={PADDING.left - 6} y={y(value) + 3} textAnchor="end" className="fill-zinc-500 text-[10px]">
                  {`${(value / 1000).toFixed(1).replace('.0', '')}k€`}
                </text>
              </g>
            ))}
            <polyline points={line} fill="none" stroke="#ff8f45" strokeWidth={2} strokeLinejoin="round" />
            {points.map((point, index) => (
              <circle key={point.day} cx={x(times[index])} cy={y(point.median)} r={3} fill="#ff8f45">
                <title>{`${shortDay(point.day)} : ${formatPrice(point.median)} (${point.count} annonces)`}</title>
              </circle>
            ))}
            <text x={PADDING.left} y={HEIGHT - 6} className="fill-zinc-500 text-[10px]">
              {shortDay(points[0].day)}
            </text>
            <text x={width - PADDING.right} y={HEIGHT - 6} textAnchor="end" className="fill-zinc-500 text-[10px]">
              {shortDay(points[points.length - 1].day)}
            </text>
          </svg>
        )}
      </div>
      <p className="mt-1 text-[11px] text-zinc-600">
        Médiane des prix demandés pour cette motorisation, à chaque relevé.
      </p>
    </div>
  );
}

/**
 * Variation de la médiane : la dernière photo face à celle d'il y a environ
 * trente jours, ou la plus ancienne si l'historique est plus court (au moins
 * une semaine, sans quoi le bruit l'emporterait).
 */
function variation(points: { day: string; median: number }[]) {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const lastTime = new Date(last.day).getTime();
  const reference =
    [...points].reverse().find((point) => lastTime - new Date(point.day).getTime() >= 30 * DAY) ?? points[0];
  const days = Math.round((lastTime - new Date(reference.day).getTime()) / DAY);
  if (days < 7) return null;
  return { ratio: (last.median - reference.median) / reference.median, days, from: reference.median, to: last.median };
}

function shortDay(day: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(day));
}
