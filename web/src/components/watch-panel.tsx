'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/client';
import { NotificationsToggle } from './notifications-toggle';

interface WatchItem {
  id: string;
  queryId: string;
  label: string;
  threshold: number;
  active: boolean;
  alerts: number;
}

const THRESHOLDS = [0.1, 0.15, 0.2];

/**
 * « Me prévenir des bonnes affaires » sur une estimation. La veille reprend
 * les filtres affichés — moteur, boîte — et y ajoute ce qu'on ne veut pas
 * dépasser : kilométrage, budget.
 */
export function WatchPanel({
  queryId,
  version,
  gearbox,
}: {
  queryId: string;
  version: string | null;
  gearbox: string | null;
}) {
  const { data, reload } = useApi<{ watches: WatchItem[] }>('/api/watches');
  const [open, setOpen] = useState(false);
  const [kmMax, setKmMax] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [threshold, setThreshold] = useState(0.15);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const mine = (data?.watches ?? []).filter((watch) => watch.queryId === queryId);

  async function create() {
    setBusy(true);
    setMessage(null);
    const response = await fetch('/api/watches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        queryId,
        version,
        gearbox,
        kmMax: digits(kmMax),
        priceMax: digits(priceMax),
        threshold,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error ?? `Erreur ${response.status}`);
      return;
    }
    setOpen(false);
    setKmMax('');
    setPriceMax('');
    setMessage(
      body.initial
        ? `Veille créée. ${body.initial} affaire${body.initial > 1 ? 's' : ''} déjà en ligne, à voir dans Alertes.`
        : 'Veille créée. Tu seras prévenu dès qu’une voiture sortira sous le marché.',
    );
    await reload();
  }

  return (
    <section className="mt-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-zinc-100">Me prévenir des bonnes affaires</h2>
          <p className="text-[11px] text-zinc-500">
            Ce modèle est relu toutes les deux heures en journée ; une voiture qui sort sous ses comparables
            t’arrive en notification.
          </p>
        </div>
      </div>

      {mine.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {mine.map((watch) => (
            <li key={watch.id}>
              <Link
                href="/alertes"
                className="flex items-center justify-between gap-3 rounded-xl border border-ink-line bg-ink px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-zinc-100">{watch.label}</span>
                  <span className="block text-[11px] text-zinc-500">
                    ≥ {Math.round(watch.threshold * 100)} % sous le marché · {watch.active ? 'active' : 'en pause'}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-accent">
                  {watch.alerts} alerte{watch.alerts > 1 ? 's' : ''} ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="mt-3 space-y-3">
          <p className="text-[12px] text-zinc-400">
            {[version ?? 'Toutes motorisations', gearbox ?? 'toutes boîtes'].join(' · ')}
            <span className="text-zinc-600"> — repris des filtres au-dessus</span>
          </p>
          <div className="text-[11px] text-zinc-500">Facultatif : ce que tu ne veux pas dépasser</div>
          <div className="-mt-2 grid grid-cols-2 gap-3">
            <input
              value={kmMax}
              onChange={(event) => setKmMax(grouped(event.target.value))}
              inputMode="numeric"
              placeholder="Km max"
              className={INPUT}
            />
            <input
              value={priceMax}
              onChange={(event) => setPriceMax(grouped(event.target.value))}
              inputMode="numeric"
              placeholder="Budget max"
              className={INPUT}
            />
          </div>
          <div>
            <div className="mb-1 text-[11px] text-zinc-500">Prévenir à partir de</div>
            <div className="flex gap-1.5">
              {THRESHOLDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setThreshold(value)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-[13px] ${
                    threshold === value ? 'border-accent bg-accent/10 text-accent' : 'border-ink-line text-zinc-400'
                  }`}
                >
                  −{Math.round(value * 100)} %
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={create}
              disabled={busy}
              className="flex-1 rounded-xl bg-accent py-2.5 text-[14px] font-semibold text-black disabled:opacity-50"
            >
              {busy ? 'Création…' : 'Créer la veille'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-ink-line px-4 text-[14px] text-zinc-400"
            >
              Annuler
            </button>
          </div>
          <NotificationsToggle compact />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 w-full rounded-xl border border-accent/50 py-2.5 text-[14px] font-medium text-accent"
        >
          {mine.length ? 'Ajouter une autre veille' : 'Surveiller ce modèle'}
        </button>
      )}

      {message && <p className="mt-2 text-[12px] text-zinc-400">{message}</p>}
    </section>
  );
}

const INPUT =
  'w-full rounded-xl border border-ink-line bg-ink px-3 py-2.5 text-[15px] text-zinc-100 placeholder:text-zinc-600 focus:border-accent focus:outline-none';

function grouped(raw: string): string {
  const value = raw.replace(/\D/g, '').slice(0, 7);
  return value ? Number(value).toLocaleString('fr-FR') : '';
}

function digits(text: string): number | null {
  const value = Number(text.replace(/\D/g, ''));
  return value > 0 ? value : null;
}
