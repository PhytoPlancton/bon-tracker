'use client';

import { useEffect, useRef, useState } from 'react';
import { formatPrice } from '@/lib/format';

export interface Activity {
  step: string;
  recent: {
    title: string;
    price: number;
    km: number | null;
    year: number | null;
    imageUrl: string | null;
    location: string | null;
  }[];
  total: number | null;
}

type FeedItem = Activity['recent'][number] & { key: number };

/** Pas de page vide pendant l'attente : on montre ce que fait le collecteur. */
const REVEAL_EVERY_MS = 420;
const FEED_SIZE = 6;
const PAGE_STEP = /^Page \d+/;

/**
 * Écran de collecte en direct. Le collecteur remonte, page après page, ce
 * qu'il fait et les annonces qu'il vient de lire ; on les fait défiler une à
 * une, pour qu'on voie le travail avancer plutôt qu'un compteur figé.
 */
export function CollectProgress({
  label,
  status,
  pages,
  ads,
  activity,
}: {
  label: string;
  status: 'queued' | 'running';
  pages: number;
  ads: number;
  activity: Activity | null | undefined;
}) {
  const [steps, setSteps] = useState<string[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const queue = useRef<FeedItem[]>([]);
  const seen = useRef(new Set<string>());
  const counter = useRef(0);
  const shown = useCountUp(ads);

  // Chaque étape nouvelle s'ajoute au fil ; les annonces rejoignent la file
  // d'affichage sans doublon d'un rafraîchissement à l'autre.
  useEffect(() => {
    if (!activity) return;
    setSteps((current) => {
      const last = current[current.length - 1];
      if (last === activity.step) return current;
      // Les pages se succèdent sur une seule ligne : le fil garde les étapes,
      // pas un empilement de « page 5 », « page 6 »…
      if (last && PAGE_STEP.test(last) && PAGE_STEP.test(activity.step)) {
        return [...current.slice(0, -1), activity.step];
      }
      return [...current, activity.step].slice(-5);
    });
    for (const item of activity.recent) {
      const id = `${item.title}|${item.price}`;
      if (seen.current.has(id)) continue;
      seen.current.add(id);
      queue.current.push({ ...item, key: (counter.current += 1) });
    }
  }, [activity]);

  useEffect(() => {
    const timer = setInterval(() => {
      const next = queue.current.shift();
      if (next) setFeed((current) => [next, ...current].slice(0, FEED_SIZE));
    }, REVEAL_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  const total = activity?.total ?? null;
  const share = total ? Math.min(1, ads / total) : null;

  if (status === 'queued') {
    return (
      <section className="mb-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
        <div className="flex items-center gap-2 text-[14px] text-zinc-200">
          <Pulse /> En file d’attente
        </div>
        <p className="mt-1 text-[12px] text-zinc-500">
          Le collecteur termine une autre tâche, la tienne démarre juste après.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-3 overflow-hidden rounded-2xl border border-ink-line bg-ink-soft">
      <div className="px-4 pt-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-accent">Collecte en direct</div>
            <div className="truncate text-[15px] font-medium text-zinc-100">
              On passe leboncoin au peigne fin : {label}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-2xl font-semibold tabular-nums text-white">{shown}</div>
            <div className="text-[11px] text-zinc-500">
              annonces{total && ads <= total ? ` sur ≈ ${total}` : ''} · page {Math.max(pages, 1)}
            </div>
          </div>
        </div>

        <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-ink-line">
          {share !== null ? (
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max(4, share * 100)}%` }}
            />
          ) : (
            <div className="animate-sweep absolute inset-y-0 w-1/3 rounded-full bg-accent/80" />
          )}
        </div>

        <ol className="mt-3 space-y-1">
          {(steps.length ? steps : ['Démarrage du collecteur']).map((step, index, list) => {
            const current = index === list.length - 1;
            return (
              <li
                key={step.replace(/^Page \d+.*/, 'page')}
                className={`animate-feed-in flex items-center gap-2 text-[12px] ${
                  current ? 'text-zinc-100' : 'text-zinc-500'
                }`}
              >
                {current ? <Pulse /> : <span className="w-2 text-center text-down">✓</span>}
                {step}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mt-3 border-t border-ink-line">
        {feed.length === 0 ? (
          <p className="px-4 py-3 text-[12px] text-zinc-600">Les premières annonces arrivent…</p>
        ) : (
          <ul className="divide-y divide-ink-line">
            {feed.map((item) => (
              <li key={item.key} className="animate-feed-in flex items-center gap-3 px-4 py-2">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-9 w-12 shrink-0 rounded-md bg-ink object-cover"
                  />
                ) : (
                  <div className="h-9 w-12 shrink-0 rounded-md bg-ink" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-zinc-200">{item.title}</div>
                  <div className="truncate text-[11px] text-zinc-500">
                    {[item.year, item.km !== null ? `${item.km.toLocaleString('fr-FR')} km` : null, item.location]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className="shrink-0 text-[12px] font-medium text-white">{formatPrice(item.price)}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="px-4 pb-3 pt-2 text-[11px] text-zinc-600">
          Quelques secondes de pause entre deux pages, comme quelqu’un qui lit : c’est ce qui
          garde le collecteur discret.
        </p>
      </div>
    </section>
  );
}

function Pulse() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
    </span>
  );
}

/** Le compteur monte jusqu'à sa valeur plutôt que de sauter. */
function useCountUp(target: number): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const share = Math.min(1, (now - start) / 800);
      const next = Math.round(origin + (target - origin) * (1 - (1 - share) ** 3));
      setValue(next);
      from.current = next;
      if (share < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}
