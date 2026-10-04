'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PlacePicker } from '@/components/place-picker';
import { Segmented } from '@/components/segmented';
import { useApi } from '@/lib/client';
import { relativeTime } from '@/lib/format';
import { searchBand } from '@/lib/immo/estimation';
import { criteriaLabel, marketTitle } from '@/lib/immo/labels';
import type { Place, PropertyType, Transaction } from '@/lib/immo/types';

interface Estimation {
  id: string;
  transaction: Transaction;
  propertyType: PropertyType;
  place: Place;
  radiusKm: number;
  surfaceMin: number | null;
  surfaceMax: number | null;
  status: 'queued' | 'running' | 'done' | 'error';
  pages: number;
  ads: number;
  error: string | null;
  collectedAt: string | null;
}

const RADII = [
  { value: 0, label: 'Commune' },
  { value: 5, label: '+ 5 km' },
  { value: 10, label: '+ 10 km' },
  { value: 20, label: '+ 20 km' },
];

export default function ImmoMarketPage() {
  const router = useRouter();
  const { data, loading, reload } = useApi<{ estimations: Estimation[] }>('/api/immo/estimations');

  const [transaction, setTransaction] = useState<Transaction>('vente');
  const [propertyType, setPropertyType] = useState<PropertyType>('appartement');
  const [place, setPlace] = useState<Place | null>(null);
  const [radiusKm, setRadiusKm] = useState(0);
  const [surface, setSurface] = useState('');
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

  // Sans centre connu (commune saisie par son seul code postal), pas de rayon.
  const canWiden = place !== null && place.lat !== null && place.lng !== null;
  useEffect(() => {
    if (!canWiden) setRadiusKm(0);
  }, [canWiden]);

  const size = Number(surface) || null;
  const band = searchBand(size);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!place) {
      setMessage('Choisis une commune dans la liste.');
      return;
    }
    setSending(true);
    setMessage(null);
    try {
      const response = await fetch('/api/immo/estimations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transaction, propertyType, place, radiusKm, surface: size }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(body.error ?? `Erreur ${response.status}`);
        return;
      }
      router.push(`/immo/${body.id}`);
    } catch {
      setMessage('Le serveur ne répond pas. Réessaie dans un instant.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <header className="pb-4 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">Marché</h1>
        <p className="text-xs text-zinc-500">
          Ce que vaut un bien, d’après toutes les annonces leboncoin du coin.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
        <Segmented
          label="Achat ou location"
          value={transaction}
          onChange={setTransaction}
          options={[
            { value: 'vente', label: 'Acheter' },
            { value: 'location', label: 'Louer' },
          ]}
        />
        <Segmented
          label="Type de bien"
          value={propertyType}
          onChange={setPropertyType}
          options={[
            { value: 'appartement', label: 'Appartement' },
            { value: 'maison', label: 'Maison' },
          ]}
        />

        {/* Pas d'étiquette englobante : la liste de suggestions contient des boutons. */}
        <div>
          <span className="mb-1 block text-[11px] text-zinc-500">Commune ou code postal</span>
          <PlacePicker value={place} onChange={setPlace} inputClassName={INPUT} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Rayon">
            <select
              value={radiusKm}
              onChange={(event) => setRadiusKm(Number(event.target.value))}
              disabled={!canWiden}
              className={`${INPUT} disabled:opacity-50`}
            >
              {RADII.map((radius) => (
                <option key={radius.value} value={radius.value}>
                  {radius.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Surface du bien (m²)">
            <input
              value={surface}
              onChange={(event) => setSurface(event.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              placeholder="45"
              className={INPUT}
            />
          </Field>
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-500">
          {band.min && band.max
            ? `On relève les biens de ${band.min} à ${band.max} m² : assez pour voir comment le prix au m² suit la taille, et chiffrer le tien.`
            : 'Sans surface, on relève toutes les tailles. Avec la tienne, on resserre sur les biens comparables.'}
        </p>

        {message && <p className="text-[12px] text-up">{message}</p>}

        <button
          type="submit"
          disabled={sending}
          className="w-full rounded-xl bg-accent py-3 text-[15px] font-semibold text-black disabled:opacity-50"
        >
          {sending ? 'Envoi…' : transaction === 'vente' ? 'Estimer les prix' : 'Estimer les loyers'}
        </button>
      </form>

      <h2 className="mb-2 mt-6 px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        Mes estimations
      </h2>

      {loading ? (
        <div className="h-20 animate-pulse rounded-2xl border border-ink-line bg-ink-soft" />
      ) : estimations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-line px-5 py-8 text-center text-sm text-zinc-500">
          Aucune pour l’instant. Choisis un bien ci-dessus.
        </div>
      ) : (
        <ul className="space-y-2">
          {estimations.map((item) => (
            <li key={item.id}>
              <Link
                href={`/immo/${item.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-ink-line bg-ink-soft px-4 py-3 active:bg-ink-line"
              >
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-medium text-zinc-100">{marketTitle(item)}</div>
                  <div className="truncate text-[11px] text-zinc-500">{criteriaLabel(item)}</div>
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
