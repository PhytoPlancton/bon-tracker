'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/client';
import { relativeTime, yearsLabel } from '@/lib/format';

interface Estimation {
  id: string;
  brand: string;
  model: string;
  yearMin: number | null;
  yearMax: number | null;
  status: 'queued' | 'running' | 'done' | 'error';
  pages: number;
  ads: number;
  error: string | null;
  collectedAt: string | null;
}

export default function MarketPage() {
  const router = useRouter();
  const { data, loading, reload } = useApi<{ estimations: Estimation[] }>('/api/estimations');
  const { data: catalogue } = useApi<{ brands: { brand: string; models: string[] }[] }>(
    '/api/estimations/catalogue',
  );

  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const estimations = data?.estimations ?? [];
  const busy = estimations.some((item) => item.status === 'queued' || item.status === 'running');

  // Tant qu'une collecte avance, la liste se rafraîchit d'elle-même.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void reload(), 4000);
    return () => clearInterval(timer);
  }, [busy, reload]);

  const models =
    catalogue?.brands.find((item) => item.brand.toLowerCase() === brand.trim().toLowerCase())?.models ?? [];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setMessage(null);
    try {
      const response = await fetch('/api/estimations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brand,
          model,
          yearMin: yearMin ? Number(yearMin) : null,
          yearMax: yearMax ? Number(yearMax) : null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(body.error ?? `Erreur ${response.status}`);
        return;
      }
      router.push(`/marche/${body.id}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <header className="pb-4 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">Marché</h1>
        <p className="text-xs text-zinc-500">
          Combien vaut vraiment une voiture, d’après toutes ses annonces leboncoin.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Marque">
            <input
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              list="brands"
              placeholder="Porsche"
              required
              autoCapitalize="words"
              className={INPUT}
            />
          </Field>
          <Field label="Modèle">
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              list="models"
              placeholder="Boxster"
              required
              autoCapitalize="words"
              className={INPUT}
            />
          </Field>
          <Field label="Année min.">
            <input
              value={yearMin}
              onChange={(event) => setYearMin(event.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              placeholder="1997"
              className={INPUT}
            />
          </Field>
          <Field label="Année max.">
            <input
              value={yearMax}
              onChange={(event) => setYearMax(event.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              placeholder="2004"
              className={INPUT}
            />
          </Field>
        </div>

        <datalist id="brands">
          {catalogue?.brands.map((item) => <option key={item.brand} value={item.brand} />)}
        </datalist>
        <datalist id="models">
          {models.map((name) => <option key={name} value={name} />)}
        </datalist>

        <p className="text-[11px] leading-relaxed text-zinc-500">
          Les années cernent la génération (ex. Boxster 986 : 1997–2004). La motorisation se
          choisit ensuite, sur le graphique.
        </p>

        {message && <p className="text-[12px] text-up">{message}</p>}

        <button
          type="submit"
          disabled={sending}
          className="w-full rounded-xl bg-accent py-3 text-[15px] font-semibold text-black disabled:opacity-50"
        >
          {sending ? 'Envoi…' : 'Estimer ce modèle'}
        </button>
      </form>

      <h2 className="mb-2 mt-6 px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        Mes estimations
      </h2>

      {loading ? (
        <div className="h-20 animate-pulse rounded-2xl border border-ink-line bg-ink-soft" />
      ) : estimations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-line px-5 py-8 text-center text-sm text-zinc-500">
          Aucune pour l’instant. Choisis une voiture ci-dessus.
        </div>
      ) : (
        <ul className="space-y-2">
          {estimations.map((item) => (
            <li key={item.id}>
              <Link
                href={`/marche/${item.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-ink-line bg-ink-soft px-4 py-3 active:bg-ink-line"
              >
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-medium text-zinc-100">
                    {item.brand} {item.model}
                  </div>
                  <div className="truncate text-[11px] text-zinc-500">{yearsLabel(item)}</div>
                </div>
                <StatusBadge item={item} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const INPUT =
  'w-full rounded-xl border border-ink-line bg-ink px-3 py-2.5 text-[15px] text-zinc-100 placeholder:text-zinc-600 focus:border-accent focus:outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function StatusBadge({ item }: { item: Estimation }) {
  if (item.status === 'queued') {
    return <span className="shrink-0 text-[11px] text-zinc-400">En attente…</span>;
  }
  if (item.status === 'running') {
    return (
      <span className="shrink-0 text-[11px] text-accent">
        {item.pages === 0 ? 'Ouverture…' : `Collecte · p.${item.pages} · ${item.ads}`}
      </span>
    );
  }
  if (item.status === 'error' && !item.collectedAt) {
    return <span className="shrink-0 text-[11px] text-up">Échec</span>;
  }
  return (
    <span className="shrink-0 text-right text-[11px] text-zinc-400">
      {item.ads} annonces
      <br />
      <span className="text-zinc-600">{relativeTime(item.collectedAt)}</span>
    </span>
  );
}
