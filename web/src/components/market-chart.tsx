'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatPrice } from '@/lib/format';

/**
 * Nuage de marché : chaque point est une annonce en ligne, le prix en
 * abscisse, une grandeur qui le fait varier en ordonnée — le kilométrage
 * d'une voiture, la surface d'un logement.
 *
 * Il se manipule comme une carte : la molette ou le trackpad zoome là où se
 * trouve le curseur, le pincement aussi (trackpad comme écran tactile), le
 * glisser déplace la vue. Revenir tout en arrière rend la molette à la page,
 * qui défile de nouveau normalement.
 *
 * Commun aux voitures et à l'immobilier : chaque domaine dit ce qu'il porte
 * en ordonnée, comment colorer ses points et ce qu'en montre la fiche.
 */
export interface ChartPoint {
  lbcId: string;
  title: string;
  url: string;
  price: number;
  /** Grandeur verticale : kilométrage, surface. Sans elle, l'annonce reste hors graphique. */
  y: number | null;
  /** Série de couleur : motorisation, nombre de pièces, classe du DPE. */
  group?: string | null;
  /** Valeur continue du dégradé : l'année. */
  shade?: number | null;
  /** Caractéristiques de la fiche, dans l'ordre où on les lit. */
  details: (string | number | null | undefined)[];
  /** Ligne secondaire de la fiche : la motorisation d'une voiture. */
  subtitle?: string | null;
  imageUrl?: string | null;
  sellerType?: 'pro' | 'private' | null;
  location?: string | null;
  /** Ce qui met l'annonce à part : dessinée en creux, hors calculs. */
  flags?: string[];
  /** Ce qui explique son prix sans la mettre à part : travaux, neuf. */
  tags?: string[];
}

/** Médiane par tranche de la grandeur verticale ; `group` à null pour l'ensemble affiché. */
export interface ChartTrend {
  group: string | null;
  points: { y: number; price: number }[];
}

export type Coloring =
  | {
      by: 'group';
      groups: { name: string; color: string }[];
      /** Couleur des séries absentes de la légende. */
      other: string;
      /** Montrer « autres » en légende : des séries n'y ont pas trouvé place. */
      others?: boolean;
      onPick?: (name: string) => void;
    }
  | { by: 'shade'; from: number[]; to: number[]; missing: string };

export interface ChartAxis {
  /** Repère de l'axe vertical : « km ↑ », « m² ↑ ». */
  label: string;
  tick: (value: number) => string;
  /** Plus serré, un zoom ne montrerait plus qu'une ou deux annonces. */
  minSpan: number;
  /** « à ce km », « à cette surface » : où se lit l'écart à la médiane. */
  gapAt: string;
  /** « sans kilométrage » : pourquoi des annonces manquent au graphique. */
  missing: string;
}

type Plotted = ChartPoint & { y: number };
/** Fenêtre affichée, en euros (horizontal) et dans l'unité verticale. */
type Domain = { x0: number; x1: number; y0: number; y1: number };

const PADDING = { top: 16, right: 14, bottom: 30, left: 58 };
const HEIGHT = 340;
const CARD_WIDTH = 236;
const TREND = '#e4e4e7';
const TARGET = '#ffffff';

export function MarketChart({
  points,
  trends,
  target,
  coloring,
  axis,
  priceMinSpan = 800,
  targetLabel,
  flaggedLabel = 'à risque, hors calculs',
}: {
  points: ChartPoint[];
  trends: ChartTrend[];
  target?: { y: number; price: number } | null;
  coloring: Coloring;
  axis: ChartAxis;
  /** Écart de prix le plus serré qu'un zoom puisse montrer. */
  priceMinSpan?: number;
  /** « ta voiture », « ton bien ». */
  targetLabel: string;
  flaggedLabel?: string;
}) {
  // Ref de rappel : les écouteurs s'attachent à l'élément réellement monté.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<Domain | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Les identifiants de React portent des caractères qu'une référence
  // « url(#…) » ne sait pas lire.
  const clipId = `zone-${useId().replace(/[^\w-]/g, '')}`;

  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const plotted = useMemo(() => points.filter((point): point is Plotted => point.y !== null), [points]);

  // Un autre filtre, c'est un autre nuage : la vue et la fiche repartent de zéro.
  useEffect(() => {
    setPinned(null);
    setHovered(null);
    setView(null);
  }, [points]);

  const shades = useMemo(() => {
    const known = plotted.map((point) => point.shade).filter((value): value is number => value !== null && value !== undefined);
    return known.length ? { min: Math.min(...known), max: Math.max(...known) } : null;
  }, [plotted]);

  /** Le nuage entier, cible comprise : la limite du dézoom. */
  const full = useMemo<Domain | null>(() => {
    if (!plotted.length) return null;
    const prices = plotted.map((point) => point.price);
    const values = plotted.map((point) => point.y);
    if (target) {
      prices.push(target.price);
      values.push(target.y);
    }
    const x0 = niceFloor(Math.min(...prices) * 0.94);
    const x1 = niceCeil(Math.max(...prices) * 1.03);
    const y0 = niceFloor(Math.min(...values) * 0.9);
    const y1 = niceCeil(Math.max(...values) * 1.04);
    return { x0, x1: x1 > x0 ? x1 : x0 + priceMinSpan, y0, y1: y1 > y0 ? y1 : y0 + axis.minSpan };
  }, [plotted, target, priceMinSpan, axis.minSpan]);

  const domain = view ?? full;
  const innerWidth = Math.max(1, width - PADDING.left - PADDING.right);
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

  // Les gestionnaires natifs (molette, pincement) lisent l'état du moment
  // sans se réabonner à chaque rendu.
  const live = useRef({ domain, full, innerWidth, innerHeight, view });
  live.current = { domain, full, innerWidth, innerHeight, view };

  /** Zoome d'un facteur autour d'un point de l'écran (facteur < 1 : on se rapproche). */
  function zoomAt(factor: number, px: number, py: number) {
    const { domain: d, full: f, innerWidth: w, innerHeight: h } = live.current;
    if (!d || !f) return;
    const cx = d.x0 + ((px - PADDING.left) / w) * (d.x1 - d.x0);
    const cy = d.y1 - ((py - PADDING.top) / h) * (d.y1 - d.y0);
    let spanX = (d.x1 - d.x0) * factor;
    let spanY = (d.y1 - d.y0) * factor;
    if (spanX >= f.x1 - f.x0 && spanY >= f.y1 - f.y0) {
      setView(null);
      return;
    }
    spanX = Math.min(Math.max(spanX, priceMinSpan), f.x1 - f.x0);
    spanY = Math.min(Math.max(spanY, axis.minSpan), f.y1 - f.y0);
    const shareX = (cx - d.x0) / (d.x1 - d.x0);
    const shareY = (cy - d.y0) / (d.y1 - d.y0);
    setView(contain({ x0: cx - shareX * spanX, x1: cx + (1 - shareX) * spanX, y0: cy - shareY * spanY, y1: cy + (1 - shareY) * spanY }, f));
  }

  function panBy(dxPixels: number, dyPixels: number) {
    const { domain: d, full: f, innerWidth: w, innerHeight: h, view: v } = live.current;
    if (!d || !f || !v) return;
    const dx = (-dxPixels / w) * (d.x1 - d.x0);
    const dy = (dyPixels / h) * (d.y1 - d.y0);
    setView(contain({ x0: d.x0 + dx, x1: d.x1 + dx, y0: d.y0 + dy, y1: d.y1 + dy }, f));
  }

  const actions = useRef({ zoomAt, panBy });
  actions.current = { zoomAt, panBy };

  // Molette et trackpad. L'écouteur doit être actif (non passif) pour que la
  // page ne défile pas pendant qu'on zoome — sauf quand on dézoome déjà au
  // maximum : la page reprend alors la main.
  useEffect(() => {
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const zoomingOut = event.deltaY > 0;
      if (zoomingOut && !live.current.view && !event.ctrlKey) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const px = event.clientX - box.left;
      const py = event.clientY - box.top;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && live.current.view) {
        actions.current.panBy(-event.deltaX, 0);
        return;
      }
      // Pincer au trackpad arrive en molette avec Ctrl : plus ample, plus doux.
      const speed = event.ctrlKey ? 0.012 : 0.0022;
      actions.current.zoomAt(Math.exp(event.deltaY * speed), px, py);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [element]);

  // Glisser pour se déplacer, pincer à deux doigts pour zoomer.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, distance: 0, pointerType: 'mouse' });

  function position(event: { clientX: number; clientY: number }) {
    const box = element?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  }
  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    gesture.current.pointerType = event.pointerType;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.current.set(event.pointerId, position(event));
    gesture.current.moved = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.distance = Math.hypot(a.x - b.x, a.y - b.y);
    }
    // Capturer tout de suite volerait le clic aux points : on attend que
    // le glisser commence réellement.
  }
  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const current = position(event);
    pointers.current.set(event.pointerId, current);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.distance > 0) {
        zoomAt(gesture.current.distance / distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      gesture.current.distance = distance;
      gesture.current.moved = true;
      return;
    }

    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    if (!gesture.current.moved && Math.hypot(dx, dy) < 3) {
      pointers.current.set(event.pointerId, previous);
      return;
    }
    if (!gesture.current.moved) {
      gesture.current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setHovered(null);
      setDragging(true);
    }
    panBy(dx, dy);
  }
  function onPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current.distance = 0;
    if (!pointers.current.size) setDragging(false);
  }

  const groupColor = (name: string | null | undefined): string => {
    if (coloring.by !== 'group') return TREND;
    return coloring.groups.find((group) => group.name === name)?.color ?? coloring.other;
  };

  const colorOf = (point: ChartPoint) => {
    if (coloring.by === 'group') return groupColor(point.group);
    const { shade } = point;
    if (shade === null || shade === undefined || !shades) return coloring.missing;
    const share = shades.max === shades.min ? 1 : (shade - shades.min) / (shades.max - shades.min);
    const mix = coloring.from.map((channel, index) => Math.round(channel + (coloring.to[index] - channel) * share));
    return `rgb(${mix.join(',')})`;
  };

  /** Écart à la médiane de la même série, au même niveau de la grandeur verticale. */
  const gapOf = (point: Plotted): number | null => {
    const trend =
      trends.find((item) => item.group !== null && item.group === point.group) ??
      trends.find((item) => item.group === null);
    const reference = trend ? interpolate(trend.points, point.y) : null;
    return reference ? (point.price - reference) / reference : null;
  };

  if (!domain || !full) {
    return <div ref={setElement} style={{ height: HEIGHT }} />;
  }

  const x = (price: number) => PADDING.left + ((price - domain.x0) / (domain.x1 - domain.x0)) * innerWidth;
  const y = (value: number) => PADDING.top + innerHeight - ((value - domain.y0) / (domain.y1 - domain.y0)) * innerHeight;
  const visible = plotted.filter(
    (point) =>
      point.price >= domain.x0 && point.price <= domain.x1 && point.y >= domain.y0 && point.y <= domain.y1,
  );
  const zoomLevel = (full.x1 - full.x0) / (domain.x1 - domain.x0);
  const radius = Math.min(8, (visible.length > 250 ? 3 : visible.length > 100 ? 3.8 : 4.6) * Math.sqrt(Math.min(zoomLevel, 3)));

  const active = plotted.find((point) => point.lbcId === (hovered ?? pinned)) ?? null;
  const card = plotted.find((point) => point.lbcId === pinned) ?? null;
  const missing = points.length - plotted.length;
  const flaggedCount = points.filter((point) => point.flags?.length).length;

  function enter(point: Plotted, pointerType: string) {
    if (pointerType !== 'mouse' || dragging) return;
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setHovered(point.lbcId);
  }
  function leave() {
    leaveTimer.current = setTimeout(() => setHovered(null), 150);
  }

  return (
    <div>
      <div ref={setElement} className="relative w-full" style={{ height: HEIGHT }}>
        <svg
          width={width}
          height={HEIGHT}
          className="block select-none"
          style={{
            touchAction: view ? 'none' : 'pan-y',
            cursor: dragging ? 'grabbing' : view ? 'grab' : 'default',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(event) => {
            const at = position(event);
            zoomAt(0.5, at.x, at.y);
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={PADDING.left} y={PADDING.top} width={innerWidth} height={innerHeight} />
            </clipPath>
          </defs>

          {ticks(domain.y0, domain.y1, 5).map((tick) => (
            <g key={`y${tick}`}>
              <line x1={PADDING.left} x2={width - PADDING.right} y1={y(tick)} y2={y(tick)} stroke="#23272e" />
              <text x={PADDING.left - 6} y={y(tick) + 3} textAnchor="end" className="fill-zinc-500 text-[10px]">
                {axis.tick(tick)}
              </text>
            </g>
          ))}
          {ticks(domain.x0, domain.x1, width < 420 ? 4 : 6)
            // Une graduation collée au bord se lirait coupée.
            .filter((tick) => x(tick) <= width - PADDING.right - 44 && x(tick) >= PADDING.left + 4)
            .map((tick) => (
              <g key={`x${tick}`}>
                <line x1={x(tick)} x2={x(tick)} y1={PADDING.top} y2={PADDING.top + innerHeight} stroke="#1a1d22" />
                <text x={x(tick)} y={HEIGHT - 10} textAnchor="middle" className="fill-zinc-500 text-[10px]">
                  {compactPrice(tick)}
                </text>
              </g>
            ))}
          <text x={width - PADDING.right} y={HEIGHT - 10} textAnchor="end" className="fill-zinc-600 text-[10px]">
            prix →
          </text>
          <text x={PADDING.left - 6} y={10} textAnchor="end" className="fill-zinc-600 text-[10px]">
            {axis.label}
          </text>

          <g clipPath={`url(#${clipId})`}>
            {trends
              .filter((trend) => trend.points.length > 1)
              .map((trend) => (
                <polyline
                  key={trend.group ?? 'all'}
                  points={trend.points.map((step) => `${x(step.price)},${y(step.y)}`).join(' ')}
                  fill="none"
                  stroke={trend.group === null ? TREND : groupColor(trend.group)}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
              ))}

            {visible.map((point) => {
              const isActive = active?.lbcId === point.lbcId;
              const flagged = Boolean(point.flags?.length);
              const color = colorOf(point);
              return (
                <circle
                  key={point.lbcId}
                  cx={x(point.price)}
                  cy={y(point.y)}
                  r={isActive ? radius + 3 : radius}
                  fill={flagged ? 'transparent' : color}
                  fillOpacity={active && !isActive ? 0.4 : 0.9}
                  stroke={isActive ? '#fff' : flagged ? color : 'none'}
                  strokeWidth={flagged && !isActive ? 1.5 : 2}
                  strokeOpacity={active && !isActive ? 0.5 : 1}
                  style={{ cursor: dragging ? 'grabbing' : 'pointer' }}
                  onPointerEnter={(event) => enter(point, event.pointerType)}
                  onPointerLeave={leave}
                  onClick={() => {
                    // La fin d'un glisser n'est pas un clic.
                    if (gesture.current.moved) return;
                    if (gesture.current.pointerType !== 'mouse') setPinned(pinned === point.lbcId ? null : point.lbcId);
                    else window.open(point.url, '_blank', 'noopener,noreferrer');
                  }}
                />
              );
            })}

            {target && (
              <g pointerEvents="none">
                <circle cx={x(target.price)} cy={y(target.y)} r={9} fill="none" stroke={TARGET} strokeWidth={2} />
                <circle cx={x(target.price)} cy={y(target.y)} r={4} fill={TARGET} />
              </g>
            )}
          </g>
        </svg>

        <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-lg border border-ink-line bg-ink/80 backdrop-blur">
          <button
            type="button"
            aria-label="Zoomer"
            onClick={() => zoomAt(0.6, PADDING.left + innerWidth / 2, PADDING.top + innerHeight / 2)}
            className="h-8 w-8 text-[16px] text-zinc-300 outline-none hover:bg-ink-line"
          >
            +
          </button>
          <button
            type="button"
            aria-label="Dézoomer"
            disabled={!view}
            onClick={() => zoomAt(1 / 0.6, PADDING.left + innerWidth / 2, PADDING.top + innerHeight / 2)}
            className="h-8 w-8 border-t border-ink-line text-[16px] text-zinc-300 outline-none hover:bg-ink-line disabled:text-zinc-700"
          >
            −
          </button>
          {view && (
            <button
              type="button"
              aria-label="Revenir à la vue complète"
              title="Revenir à la vue complète"
              onClick={() => setView(null)}
              className="h-8 w-8 border-t border-ink-line text-[13px] text-zinc-300 outline-none hover:bg-ink-line"
            >
              ⤢
            </button>
          )}
        </div>

        {hovered && active && !dragging && (
          <div className="pointer-events-none absolute z-20" style={cardPosition(x(active.price), y(active.y), width)}>
            <AdCard point={active} gap={gapOf(active)} gapAt={axis.gapAt} compact />
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-zinc-500">
        {coloring.by === 'group' &&
          coloring.groups.map(({ name, color }) => (
            <button
              key={name}
              type="button"
              onClick={() => coloring.onPick?.(name)}
              className="flex items-center gap-1.5 outline-none hover:text-zinc-300"
            >
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
              {name}
            </button>
          ))}
        {coloring.by === 'group' && coloring.others && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: coloring.other }} />
            autres
          </span>
        )}
        {coloring.by === 'shade' && shades && (
          <span className="flex items-center gap-1.5">
            {shades.min}
            <span
              className="inline-block h-2 w-16 rounded-full"
              style={{ background: `linear-gradient(90deg, rgb(${coloring.from.join(',')}), rgb(${coloring.to.join(',')}))` }}
            />
            {shades.max}
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
            {targetLabel}
          </span>
        )}
        {flaggedCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-zinc-400" />
            {flaggedLabel} ({flaggedCount})
          </span>
        )}
        {missing > 0 && (
          <span>
            {missing} {axis.missing}, hors graphique
          </span>
        )}
      </div>

      {card ? (
        <div className="mt-3">
          <AdCard point={card} gap={gapOf(card)} gapAt={axis.gapAt} />
        </div>
      ) : (
        <p className="mt-3 px-1 text-[11px] text-zinc-600">
          Molette, trackpad ou pincement pour zoomer · glisser pour se déplacer · survole un point pour voir l’annonce.
        </p>
      )}
    </div>
  );
}

/** Fiche d'une annonce : photo, prix, et ce qui la situe parmi les autres. */
function AdCard({ point, gap, gapAt, compact = false }: { point: Plotted; gap: number | null; gapAt: string; compact?: boolean }) {
  const image = largerImage(point.imageUrl);
  const details = point.details.filter((detail) => detail !== null && detail !== undefined && detail !== '');

  return (
    <a
      href={point.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block overflow-hidden rounded-xl border border-ink-line bg-ink shadow-2xl shadow-black/60 outline-none active:bg-ink-line ${
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
        <div className="text-[17px] font-semibold text-white">{formatPrice(point.price)}</div>
        {gap !== null && Math.abs(gap) >= 0.01 && (
          <div className={`text-[11px] ${gap < 0 ? 'text-down' : 'text-zinc-400'}`}>
            {Math.round(Math.abs(gap) * 100)} % {gap < 0 ? 'sous' : 'au-dessus de'} la médiane {gapAt}
          </div>
        )}
        <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-zinc-200">{point.title}</div>
        <div className="mt-1 text-[11px] text-zinc-400">{details.join(' · ')}</div>
        {point.subtitle && <div className="text-[11px] text-zinc-500">{point.subtitle}</div>}
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
          {point.tags?.map((tag) => (
            <span key={tag} className="rounded bg-ink-line px-1.5 py-0.5 text-zinc-300">
              {tag}
            </span>
          ))}
          {point.location && <span className="truncate">{point.location}</span>}
        </div>
        {!compact && <div className="mt-1.5 text-[11px] text-accent">Voir l’annonce ↗</div>}
      </div>
    </a>
  );
}

/** Garde la fenêtre à l'intérieur du nuage entier, en la décalant au besoin. */
function contain(d: Domain, f: Domain): Domain {
  const spanX = d.x1 - d.x0;
  const spanY = d.y1 - d.y0;
  const x0 = Math.min(Math.max(d.x0, f.x0), f.x1 - spanX);
  const y0 = Math.min(Math.max(d.y0, f.y0), f.y1 - spanY);
  return { x0, x1: x0 + spanX, y0, y1: y0 + spanY };
}

/** Hauteur approchée de la fiche, photo comprise. */
const CARD_HEIGHT = 250;

/**
 * Place la fiche juste au-dessus du point, centrée sur lui ; en dessous
 * seulement quand le point est trop haut pour qu'elle tienne. Elle ne
 * recouvre ainsi jamais le point, et reste dans la largeur du graphique.
 */
function cardPosition(px: number, py: number, width: number): React.CSSProperties {
  const left = Math.min(Math.max(0, px - CARD_WIDTH / 2), Math.max(0, width - CARD_WIDTH));
  const above = py - 14 - CARD_HEIGHT >= -PADDING.top - 60;
  return above
    ? { left, top: py - 14, width: CARD_WIDTH, transform: 'translateY(-100%)' }
    : { left, top: py + 14, width: CARD_WIDTH };
}

/** Les vignettes du site sont minuscules ; la même photo existe en plus grand. */
function largerImage(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/rule=ad-(thumb|small|listing-thumb)/, 'rule=ad-image');
}

function interpolate(steps: { y: number; price: number }[], value: number): number | null {
  if (steps.length < 2 || value < steps[0].y || value > steps[steps.length - 1].y) return null;
  for (let i = 1; i < steps.length; i += 1) {
    if (value <= steps[i].y) {
      const a = steps[i - 1];
      const b = steps[i];
      const share = (value - a.y) / (b.y - a.y || 1);
      return a.price + (b.price - a.price) * share;
    }
  }
  return null;
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

/** « 18k€ », « 1.25M€ » : un appartement dépasse souvent le million là où une voiture jamais. */
function compactPrice(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : Number(millions.toFixed(2))}M€`;
  }
  if (value >= 1000) {
    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k€`;
  }
  return `${Math.round(value)}€`;
}
