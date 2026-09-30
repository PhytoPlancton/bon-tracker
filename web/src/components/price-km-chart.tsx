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
  imageUrl?: string | null;
  sellerType?: 'pro' | 'private' | null;
  gearbox?: string | null;
  versionGuessed?: boolean;
  flags?: string[];
}

type Plotted = KmPoint & { km: number };
type Trend = { version: string | null; points: { km: number; price: number }[] };

const PADDING = { top: 14, right: 12, bottom: 28, left: 50 };
const HEIGHT = 320;
const CARD_WIDTH = 236;

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

type Zoom = 'all' | 'core' | 'target' | { kmMin: number; kmMax: number };

/**
 * Nuage prix / kilométrage : chaque point est une annonce en ligne.
 *
 * Au survol, une fiche montre la photo et l'essentiel de l'annonce ; au
 * doigt, où le survol n'existe pas, un toucher l'affiche sous le graphique.
 * Le zoom se choisit comme une période en bourse — tout, le cœur du marché,
 * autour de sa voiture — ou en glissant horizontalement sur le graphique.
 * L'axe des prix suit toujours les seuls points visibles : c'est ce qui
 * écarte réellement les points d'un nuage tassé.
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
  trends: Trend[];
  target?: { km: number; price: number } | null;
  colorBy?: ColorBy;
  versionOrder?: string[];
  onPickVersion?: (name: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<Zoom>('all');
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [brush, setBrush] = useState<{ from: number; to: number } | null>(null);
  const pointerType = useRef<string>('mouse');
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotted = useMemo(
    () => points.filter((point): point is Plotted => point.km !== null),
    [points],
  );

  // Un filtre qui retire la voiture épinglée, ou une cible qui disparaît, ne
  // doit pas laisser une fiche ou une vue orpheline.
  useEffect(() => {
    if (zoom === 'target' && !target) setZoom('all');
  }, [target, zoom]);
  useEffect(() => {
    setPinned(null);
    setHovered(null);
  }, [points]);

  const years = useMemo(() => {
    const known = plotted.map((point) => point.year).filter((year): year is number => year !== null);
    return known.length ? { min: Math.min(...known), max: Math.max(...known) } : null;
  }, [plotted]);

  const geometry = useMemo(() => {
    if (!width || !plotted.length) return null;
    const innerWidth = width - PADDING.left - PADDING.right;
    const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

    const kms = plotted.map((point) => point.km).sort((a, b) => a - b);
    let kmMin: number;
    let kmMax: number;
    if (typeof zoom === 'object') {
      ({ kmMin, kmMax } = zoom);
    } else if (zoom === 'core') {
      kmMin = niceFloor(at(kms, 0.05));
      kmMax = niceCeil(at(kms, 0.95));
    } else if (zoom === 'target' && target) {
      const spread = Math.max(25_000, target.km * 0.25);
      kmMin = Math.max(0, target.km - spread);
      kmMax = target.km + spread;
    } else {
      const all = target ? [...kms, target.km] : kms;
      kmMin = niceFloor(Math.min(...all) * 0.9);
      kmMax = niceCeil(Math.max(...all) * 1.04);
    }
    if (kmMax <= kmMin) kmMax = kmMin + 1000;

    const inside = plotted.filter((point) => point.km >= kmMin && point.km <= kmMax);
    let prices = inside.map((point) => point.price).sort((a, b) => a - b);
    if (!prices.length) prices = plotted.map((point) => point.price).sort((a, b) => a - b);
    // Au cœur du marché, les quelques annonces extrêmes sortent du cadre :
    // ce sont elles qui écrasaient tout le reste.
    let rawMin = zoom === 'core' ? at(prices, 0.03) : prices[0];
    let rawMax = zoom === 'core' ? at(prices, 0.97) : prices[prices.length - 1];
    if (target && target.km >= kmMin && target.km <= kmMax) {
      rawMin = Math.min(rawMin, target.price);
      rawMax = Math.max(rawMax, target.price);
    }
    const pad = rawMax === rawMin ? rawMax * 0.1 : (rawMax - rawMin) * 0.08;
    const minPrice = Math.max(0, rawMin - pad);
    const maxPrice = rawMax + pad;

    const x = (km: number) => PADDING.left + ((km - kmMin) / (kmMax - kmMin)) * innerWidth;
    const y = (price: number) =>
      PADDING.top + innerHeight - ((price - minPrice) / (maxPrice - minPrice || 1)) * innerHeight;
    const kmAt = (px: number) => kmMin + ((px - PADDING.left) / innerWidth) * (kmMax - kmMin);

    return {
      x,
      y,
      kmAt,
      innerWidth,
      innerHeight,
      visible: inside.filter((point) => point.price >= minPrice && point.price <= maxPrice),
      xTicks: ticks(kmMin, kmMax, width < 420 ? 4 : 6),
      yTicks: ticks(minPrice, maxPrice, 5),
    };
  }, [plotted, target, width, zoom]);

  const colorOf = (point: KmPoint) => {
    if (colorBy === 'version') return versionColor(versionOrder, point.version ?? 'Non précisée');
    const { year } = point;
    if (year === null || !years) return NO_YEAR;
    const share = years.max === years.min ? 1 : (year - years.min) / (years.max - years.min);
    const mix = OLD.map((channel, index) => Math.round(channel + (RECENT[index] - channel) * share));
    return `rgb(${mix.join(',')})`;
  };

  /** Écart à la médiane des voitures du même moteur, au même kilométrage. */
  const gapOf = (point: Plotted): number | null => {
    const trend =
      trends.find((item) => item.version !== null && item.version === point.version) ??
      trends.find((item) => item.version === null);
    const reference = trend ? interpolate(trend.points, point.km) : null;
    return reference ? (point.price - reference) / reference : null;
  };

  const visibleCount = geometry?.visible.length ?? 0;
  const radius = visibleCount > 300 ? 3 : visibleCount > 120 ? 3.8 : visibleCount > 40 ? 4.8 : 6;
  const missing = points.length - plotted.length;
  const flaggedCount = points.filter((point) => point.flags?.length).length;

  const active = plotted.find((point) => point.lbcId === (hovered ?? pinned)) ?? null;
  const card = plotted.find((point) => point.lbcId === pinned) ?? null;

  function onBackgroundDown(event: React.PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const from = event.clientX - box.left;
    event.currentTarget.setPointerCapture(event.pointerId);
    setBrush({ from, to: from });
  }
  function onBackgroundMove(event: React.PointerEvent<SVGRectElement>) {
    if (!brush) return;
    const box = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    setBrush({ ...brush, to: event.clientX - box.left });
  }
  function onBackgroundUp() {
    if (!brush || !geometry) {
      setBrush(null);
      return;
    }
    const low = Math.min(brush.from, brush.to);
    const high = Math.max(brush.from, brush.to);
    setBrush(null);
    // Un simple toucher du fond referme la fiche plutôt que de zoomer.
    if (high - low < 16) {
      setPinned(null);
      return;
    }
    const kmMin = Math.max(0, geometry.kmAt(low));
    const kmMax = geometry.kmAt(high);
    if (kmMax - kmMin >= 2_000) setZoom({ kmMin, kmMax });
  }

  function enter(point: Plotted) {
    if (pointerType.current !== 'mouse') return;
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setHovered(point.lbcId);
  }
  function leave() {
    leaveTimer.current = setTimeout(() => setHovered(null), 150);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
        <ZoomChip active={zoom === 'all'} onClick={() => setZoom('all')}>
          Tout
        </ZoomChip>
        <ZoomChip active={zoom === 'core'} onClick={() => setZoom('core')}>
          Cœur du marché
        </ZoomChip>
        {target && (
          <ZoomChip active={zoom === 'target'} onClick={() => setZoom('target')}>
            Autour de ta voiture
          </ZoomChip>
        )}
        {typeof zoom === 'object' && (
          <ZoomChip active onClick={() => setZoom('all')}>
            {Math.round(zoom.kmMin / 1000)}–{Math.round(zoom.kmMax / 1000)}k km ✕
          </ZoomChip>
        )}
      </div>

      <div ref={containerRef} className="relative w-full" style={{ height: HEIGHT }}>
        {geometry && (
          <svg width={width} height={HEIGHT} className="block select-none" style={{ touchAction: 'pan-y' }}>
            <defs>
              <clipPath id="plot-area">
                <rect
                  x={PADDING.left}
                  y={PADDING.top - 8}
                  width={geometry.innerWidth + 8}
                  height={geometry.innerHeight + 16}
                />
              </clipPath>
            </defs>

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
            {geometry.xTicks
              // Une graduation collée au bord se lirait coupée, ou chevaucherait
              // sa voisine une fois repoussée : on s'en passe.
              .filter((tick) => geometry.x(tick) <= width - PADDING.right - 22)
              .map((tick) => (
                <text
                  key={`x${tick}`}
                  x={geometry.x(tick)}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-zinc-500 text-[10px]"
                >
                  {`${Math.round(tick / 1000)}k km`}
                </text>
              ))}

            {/* Fond sensible au glisser : c'est lui qui trace la zone à zoomer. */}
            <rect
              x={PADDING.left}
              y={PADDING.top}
              width={geometry.innerWidth}
              height={geometry.innerHeight}
              fill="transparent"
              className="cursor-crosshair"
              onPointerDown={onBackgroundDown}
              onPointerMove={onBackgroundMove}
              onPointerUp={onBackgroundUp}
              onPointerCancel={() => setBrush(null)}
            />

            <g clipPath="url(#plot-area)">
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

              {geometry.visible.map((point) => {
                const isActive = active?.lbcId === point.lbcId;
                const flagged = Boolean(point.flags?.length);
                const color = colorOf(point);
                return (
                  <circle
                    key={point.lbcId}
                    cx={geometry.x(point.km)}
                    cy={geometry.y(point.price)}
                    r={isActive ? radius + 3 : radius}
                    fill={flagged ? 'transparent' : color}
                    fillOpacity={active && !isActive ? 0.4 : 0.9}
                    stroke={isActive ? '#fff' : flagged ? color : 'none'}
                    strokeWidth={flagged && !isActive ? 1.5 : 2}
                    strokeOpacity={active && !isActive ? 0.5 : 1}
                    className="cursor-pointer"
                    onPointerDown={(event) => {
                      pointerType.current = event.pointerType;
                    }}
                    onPointerEnter={(event) => {
                      pointerType.current = event.pointerType;
                      enter(point);
                    }}
                    onPointerLeave={leave}
                    onClick={() => {
                      if (pointerType.current === 'mouse') {
                        window.open(point.url, '_blank', 'noopener,noreferrer');
                      } else {
                        setPinned(pinned === point.lbcId ? null : point.lbcId);
                      }
                    }}
                  />
                );
              })}

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
            </g>

            {brush && Math.abs(brush.to - brush.from) > 4 && (
              <rect
                x={Math.min(brush.from, brush.to)}
                y={PADDING.top}
                width={Math.abs(brush.to - brush.from)}
                height={geometry.innerHeight}
                fill="#ff8f45"
                fillOpacity={0.12}
                stroke="#ff8f45"
                strokeOpacity={0.5}
                pointerEvents="none"
              />
            )}
          </svg>
        )}

        {geometry && hovered && active && (
          <div
            className="absolute z-10"
            style={cardPosition(geometry.x(active.km), geometry.y(active.price), width)}
            onMouseEnter={() => {
              if (leaveTimer.current) clearTimeout(leaveTimer.current);
            }}
            onMouseLeave={leave}
          >
            <AdCard point={active} gap={gapOf(active)} compact />
          </div>
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
        {flaggedCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-zinc-400" />
            à risque, hors calculs ({flaggedCount})
          </span>
        )}
        {missing > 0 && <span>{missing} sans kilométrage, hors graphique</span>}
      </div>

      {card ? (
        <div className="mt-3">
          <AdCard point={card} gap={gapOf(card)} />
        </div>
      ) : (
        <p className="mt-3 px-1 text-[11px] text-zinc-600">
          Survole ou touche un point pour voir l’annonce · glisse horizontalement pour zoomer.
        </p>
      )}
    </div>
  );
}

function ZoomChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-[11px] ${
        active ? 'bg-ink-line text-zinc-100' : 'text-zinc-500 active:bg-ink-line'
      }`}
    >
      {children}
    </button>
  );
}

/** Fiche d'une annonce : photo, prix, et ce qui la situe parmi les autres. */
function AdCard({ point, gap, compact = false }: { point: Plotted; gap: number | null; compact?: boolean }) {
  const image = largerImage(point.imageUrl);
  const details = [point.year, `${point.km.toLocaleString('fr-FR')} km`, point.gearbox].filter(Boolean);

  return (
    <a
      href={point.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block overflow-hidden rounded-xl border border-ink-line bg-ink shadow-2xl shadow-black/60 active:bg-ink-line ${
        compact ? '' : 'sm:flex'
      }`}
      style={compact ? { width: CARD_WIDTH } : undefined}
    >
      {image ? (
        // Photo servie par le site d'annonces, sans lui transmettre de référent.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className={`w-full bg-ink-soft object-cover ${compact ? 'h-32' : 'h-44 sm:h-auto sm:w-48'}`}
        />
      ) : (
        <div
          className={`flex w-full items-center justify-center bg-ink-soft text-[11px] text-zinc-600 ${
            compact ? 'h-12' : 'h-16 sm:h-auto sm:w-48'
          }`}
        >
          Pas de photo
        </div>
      )}
      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[17px] font-semibold text-white">{formatPrice(point.price)}</span>
          {gap !== null && Math.abs(gap) >= 0.01 && (
            <span className={`text-right text-[11px] ${gap < 0 ? 'text-down' : 'text-zinc-400'}`}>
              {Math.round(Math.abs(gap) * 100)} % {gap < 0 ? 'sous' : 'au-dessus de'} la médiane
            </span>
          )}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-zinc-200">{point.title}</div>
        <div className="mt-1 text-[11px] text-zinc-400">{details.join(' · ')}</div>
        {point.version && (
          <div className="text-[11px] text-zinc-500">
            {point.version}
            {point.versionGuessed && ' (déduite du titre)'}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
          {point.sellerType && (
            <span className="rounded bg-ink-line px-1.5 py-0.5 text-zinc-300">
              {point.sellerType === 'pro' ? 'Pro' : 'Particulier'}
            </span>
          )}
          {point.flags?.map((flag) => (
            <span key={flag} className="rounded bg-up/15 px-1.5 py-0.5 text-up">
              {flag}
            </span>
          ))}
          {point.location && <span className="truncate">{point.location}</span>}
        </div>
        {!compact && <div className="mt-1.5 text-[11px] text-accent">Voir l’annonce ↗</div>}
      </div>
    </a>
  );
}

/** Place la fiche à côté du point, du côté où elle tient. */
function cardPosition(px: number, py: number, width: number): React.CSSProperties {
  const right = px + 16 + CARD_WIDTH <= width;
  const left = right ? px + 16 : Math.max(0, px - 16 - CARD_WIDTH);
  const top = Math.min(Math.max(0, py - 90), HEIGHT - 150);
  return { left, top, width: CARD_WIDTH };
}

/** Les vignettes du site sont minuscules ; la même photo existe en plus grand. */
function largerImage(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/rule=ad-(thumb|small|listing-thumb)/, 'rule=ad-image');
}

function interpolate(steps: { km: number; price: number }[], km: number): number | null {
  if (steps.length < 2 || km < steps[0].km || km > steps[steps.length - 1].km) return null;
  for (let i = 1; i < steps.length; i += 1) {
    if (km <= steps[i].km) {
      const a = steps[i - 1];
      const b = steps[i];
      const share = (km - a.km) / (b.km - a.km || 1);
      return a.price + (b.price - a.price) * share;
    }
  }
  return null;
}

function at(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
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
