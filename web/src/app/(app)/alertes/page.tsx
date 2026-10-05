'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ConfirmButton } from '@/components/confirm-button';
import { NegotiateButton } from '@/components/negotiate-button';
import { NotificationsToggle } from '@/components/notifications-toggle';
import { useApi } from '@/lib/client';
import { formatPrice, relativeTime } from '@/lib/format';

interface AlertItem {
  id: string;
  watchId: string;
  lbcId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  location: string | null;
  price: number;
  reference: number;
  ratio: number;
  comparables: number;
  km: number | null;
  year: number | null;
  version: string | null;
  initial: boolean;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
}

interface WatchItem {
  id: string;
  queryId: string;
  label: string;
  threshold: number;
  active: boolean;
  checkedAt: string | null;
  alerts: number;
}

export default function AlertsPage() {
  return (
    <Suspense>
      <Alerts />
    </Suspense>
  );
}

function Alerts() {
  const params = useSearchParams();
  const highlighted = params.get('ouvrir');
  const { data, loading, reload } = useApi<{ alerts: AlertItem[]; unread: number }>('/api/alerts');
  const { data: watchData, reload: reloadWatches } = useApi<{ watches: WatchItem[] }>('/api/watches');

  const alerts = data?.alerts ?? [];
  const watches = watchData?.watches ?? [];
  const labels = new Map(watches.map((watch) => [watch.id, watch.label]));

  // Vues, elles sont lues : la pastille de l'onglet s'éteint au passage suivant.
  useEffect(() => {
    if (!data?.unread) return;
    const timer = setTimeout(() => void fetch('/api/alerts/read', { method: 'POST' }), 1500);
    return () => clearTimeout(timer);
  }, [data?.unread]);

  useEffect(() => {
    if (!highlighted || !alerts.length) return;
    document.getElementById(`alerte-${highlighted}`)?.scrollIntoView({ block: 'center' });
  }, [highlighted, alerts.length]);

  async function toggle(watch: WatchItem) {
    await fetch(`/api/watches/${watch.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: !watch.active }),
    });
    await reloadWatches();
  }

  async function remove(watch: WatchItem) {
    await fetch(`/api/watches/${watch.id}`, { method: 'DELETE' });
    await Promise.all([reloadWatches(), reload()]);
  }

  return (
    <>
      <header className="pb-4 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">Alertes</h1>
        <p className="text-xs text-zinc-500">Les voitures qui sortent nettement sous leurs comparables.</p>
      </header>

      <NotificationsToggle />

      <h2 className="mb-2 mt-6 px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Affaires repérées</h2>
      {loading ? (
        <div className="h-24 animate-pulse rounded-2xl border border-ink-line bg-ink-soft" />
      ) : alerts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-line px-5 py-8 text-center text-sm text-zinc-500">
          {watches.length
            ? 'Rien pour l’instant. Les modèles surveillés sont relus toutes les deux heures environ, en journée.'
            : 'Aucune veille. Ouvre une estimation dans Marché et touche « Me prévenir des bonnes affaires ».'}
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              id={`alerte-${alert.id}`}
              className={`overflow-hidden rounded-2xl border bg-ink-soft ${
                alert.id === highlighted ? 'border-accent' : !alert.readAt ? 'border-accent/40' : 'border-ink-line'
              }`}
            >
              <a href={alert.url} target="_blank" rel="noopener noreferrer" className="flex gap-3 p-3">
                {alert.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={larger(alert.imageUrl)}
                    alt=""
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="h-20 w-24 shrink-0 rounded-lg bg-ink object-cover"
                  />
                ) : (
                  <div className="h-20 w-24 shrink-0 rounded-lg bg-ink" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[16px] font-semibold text-white">{formatPrice(alert.price)}</span>
                    <span className="shrink-0 text-[12px] font-medium text-down">
                      {Math.round(alert.ratio * 100)} % sous le marché
                    </span>
                  </div>
                  <div className="truncate text-[13px] text-zinc-200">{alert.title}</div>
                  <div className="truncate text-[11px] text-zinc-500">
                    {[alert.year, alert.km !== null ? `${alert.km.toLocaleString('fr-FR')} km` : null, alert.version, alert.location]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-600">
                    {alert.comparables} comparables autour de {formatPrice(alert.reference)} ·{' '}
                    {alert.initial ? 'déjà en ligne' : relativeTime(alert.updatedAt)}
                  </div>
                </div>
              </a>
              <div className="flex items-center justify-between gap-2 border-t border-ink-line px-3 py-2">
                <span className="truncate text-[11px] text-zinc-600">{labels.get(alert.watchId) ?? ''}</span>
                <NegotiateButton lbcId={alert.lbcId} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 mt-6 px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Mes veilles</h2>
      {watches.length === 0 ? (
        <p className="px-1 text-[12px] text-zinc-500">
          Une veille se crée depuis une estimation, dans{' '}
          <Link href="/marche" className="text-accent">
            Marché
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-2">
          {watches.map((watch) => (
            <li key={watch.id} className="rounded-2xl border border-ink-line bg-ink-soft px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/marche/${watch.queryId}`} className="min-w-0">
                  <div className={`truncate text-[14px] font-medium ${watch.active ? 'text-zinc-100' : 'text-zinc-500'}`}>
                    {watch.label}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    au moins {Math.round(watch.threshold * 100)} % sous les comparables · {watch.alerts} alerte
                    {watch.alerts > 1 ? 's' : ''} · {watch.active ? `relu ${relativeTime(watch.checkedAt)}` : 'en pause'}
                  </div>
                </Link>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggle(watch)}
                    className="rounded-lg border border-ink-line px-2.5 py-1 text-[12px] text-zinc-300"
                  >
                    {watch.active ? 'Pause' : 'Reprendre'}
                  </button>
                  {/* Second appui plutôt qu'une boîte native : ouverte dans le
                      Chrome dédié, elle figerait le collecteur. */}
                  <ConfirmButton
                    onConfirm={() => remove(watch)}
                    label="✕"
                    confirmLabel="Supprimer ?"
                    className="rounded-lg border border-ink-line px-2.5 py-1 text-[12px] text-zinc-500"
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 px-1 text-[11px] leading-relaxed text-zinc-600">
        Une affaire se juge face aux voitures du même moteur, d’années et de kilométrages proches. Un prix
        très bas l’est parfois pour une raison : la fiche de négociation aide à le vérifier.
      </p>
    </>
  );
}

function larger(url: string): string {
  return url.replace(/rule=ad-(thumb|small|listing-thumb)/, 'rule=ad-image');
}
