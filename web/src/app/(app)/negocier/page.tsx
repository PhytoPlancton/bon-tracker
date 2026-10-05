'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/client';
import { formatPrice, relativeTime } from '@/lib/format';

interface Item {
  id: string;
  lbcId: string;
  status: 'reading' | 'collecting' | 'ready' | 'error';
  error: string | null;
  updatedAt: string;
  ad: { title: string; price: number; imageUrl: string | null } | null;
}

export default function NegotiationsPage() {
  const router = useRouter();
  const { data, loading } = useApi<{ negotiations: Item[] }>('/api/negociations');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const response = await fetch('/api/negociations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ annonce: link }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error ?? `Erreur ${response.status}`);
      return;
    }
    router.push(`/negocier/${body.id}`);
  }

  async function paste() {
    try {
      setLink(await navigator.clipboard.readText());
    } catch {
      // Presse-papiers refusé : on colle à la main.
    }
  }

  const items = data?.negotiations ?? [];

  return (
    <>
      <header className="pb-4 pt-1">
        <Link href="/marche" className="text-[13px] text-accent">
          ‹ Marché
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Négocier</h1>
        <p className="text-xs text-zinc-500">
          Une annonce face à ses comparables : le juste prix, quoi proposer, et pourquoi.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
        <label className="block">
          <span className="mb-1 block text-[11px] text-zinc-500">Lien de l’annonce leboncoin</span>
          <div className="flex gap-2">
            <input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://www.leboncoin.fr/ad/voitures/…"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              className="min-w-0 flex-1 rounded-xl border border-ink-line bg-ink px-3 py-2.5 text-[15px] text-zinc-100 placeholder:text-zinc-600 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={paste}
              className="shrink-0 rounded-xl border border-ink-line px-3 text-[13px] text-zinc-300"
            >
              Coller
            </button>
          </div>
        </label>
        {message && <p className="text-[12px] text-up">{message}</p>}
        <button
          type="submit"
          disabled={busy || link.trim().length < 6}
          className="w-full rounded-xl bg-accent py-3 text-[15px] font-semibold text-black disabled:opacity-50"
        >
          {busy ? 'Analyse…' : 'Préparer la négociation'}
        </button>
      </form>

      <h2 className="mb-2 mt-6 px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Mes négociations</h2>
      {loading ? (
        <div className="h-16 animate-pulse rounded-2xl border border-ink-line bg-ink-soft" />
      ) : items.length === 0 ? (
        <p className="px-1 text-[12px] text-zinc-500">
          Aucune pour l’instant. Le bouton « Négocier » apparaît aussi sur les alertes et les bonnes affaires.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/negocier/${item.id}`}
                className="flex items-center gap-3 rounded-2xl border border-ink-line bg-ink-soft p-3 active:bg-ink-line"
              >
                {item.ad?.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.ad.imageUrl} alt="" referrerPolicy="no-referrer" className="h-12 w-16 rounded-lg bg-ink object-cover" />
                ) : (
                  <div className="h-12 w-16 rounded-lg bg-ink" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-zinc-100">{item.ad?.title ?? `Annonce ${item.lbcId}`}</div>
                  <div className="text-[11px] text-zinc-500">
                    {item.ad ? `${formatPrice(item.ad.price)} · ` : ''}
                    {item.status === 'ready'
                      ? `fiche prête · ${relativeTime(item.updatedAt)}`
                      : item.status === 'error'
                        ? 'échec'
                        : 'en préparation…'}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
