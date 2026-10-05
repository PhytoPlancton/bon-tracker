'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CollectProgress, type Activity } from '@/components/collect-progress';
import { ConfirmButton } from '@/components/confirm-button';
import { PriceKmChart } from '@/components/price-km-chart';
import { useApi } from '@/lib/client';
import type { Ad } from '@/lib/estimation';
import { formatPrice } from '@/lib/format';
import type { Sheet } from '@/lib/negotiation';

interface View {
  negotiation: {
    id: string;
    lbcId: string;
    url: string;
    status: 'reading' | 'collecting' | 'ready' | 'error';
    error: string | null;
  };
  ad: (Ad & { priceHistory: { price: number; at: string }[] }) | null;
  query: {
    id: string;
    brand: string;
    model: string;
    status: string;
    pages: number;
    ads: number;
    activity: Activity | null;
  } | null;
  sheet: Sheet | null;
  pool: Ad[];
}

export default function NegotiationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, loading, error, reload } = useApi<View>(`/api/negociations/${id}`);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  const status = data?.negotiation.status;
  const pending = status === 'reading' || status === 'collecting';

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void reload(), 2000);
    return () => clearInterval(timer);
  }, [pending, reload]);

  const message = draft ?? data?.sheet?.message ?? '';
  // Le nuage d'un seul moteur : celui de l'annonce, quand on le connaît et
  // qu'il réunit assez de voitures pour dessiner un marché.
  const points = useMemo(() => {
    const pool = data?.pool ?? [];
    const version = data?.ad?.version;
    const same = version ? pool.filter((other) => other.version === version) : [];
    return same.length >= 8 ? same : pool;
  }, [data]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function retry() {
    if (!data) return;
    await fetch('/api/negociations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ annonce: data.negotiation.lbcId }),
    });
    await reload();
  }

  async function remove() {
    await fetch(`/api/negociations/${id}`, { method: 'DELETE' });
    router.push('/negocier');
  }

  if (loading) return <div className="mt-4 h-80 animate-pulse rounded-2xl border border-ink-line bg-ink-soft" />;
  if (!data) {
    return (
      <p className="mt-8 text-center text-sm text-zinc-500">
        {error === 'Erreur 404' ? 'Négociation introuvable.' : error}{' '}
        <Link href="/negocier" className="text-accent">
          Retour
        </Link>
      </p>
    );
  }

  const { ad, sheet, query } = data;

  return (
    <>
      <header className="pb-3 pt-1">
        <Link href="/negocier" className="text-[13px] text-accent">
          ‹ Négocier
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Fiche de négociation</h1>
      </header>

      {ad && (
        <a
          href={ad.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-3 flex gap-3 overflow-hidden rounded-2xl border border-ink-line bg-ink-soft p-3"
        >
          {ad.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={larger(ad.imageUrl)}
              alt=""
              referrerPolicy="no-referrer"
              className="h-24 w-32 shrink-0 rounded-xl bg-ink object-cover"
            />
          ) : (
            <div className="h-24 w-32 shrink-0 rounded-xl bg-ink" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-zinc-600">Prix demandé</div>
            <div className="text-2xl font-semibold tracking-tight text-white">{formatPrice(ad.price)}</div>
            <div className="line-clamp-2 text-[13px] text-zinc-200">{ad.title}</div>
            <div className="truncate text-[11px] text-zinc-500">
              {[ad.year, ad.km !== null ? `${ad.km.toLocaleString('fr-FR')} km` : null, ad.version, ad.gearbox, ad.location]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        </a>
      )}

      {status === 'reading' && (
        <p className="mb-3 flex items-center gap-2 rounded-2xl border border-ink-line bg-ink-soft px-4 py-3 text-[13px] text-zinc-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          Lecture de l’annonce sur leboncoin…
        </p>
      )}

      {status === 'collecting' && query && (
        <CollectProgress
          label={`${query.brand} ${query.model}, pour comparer`}
          status={query.status === 'queued' ? 'queued' : 'running'}
          pages={query.pages}
          ads={query.ads}
          activity={query.activity}
        />
      )}

      {status === 'error' && (
        <div className="mb-3 rounded-2xl border border-up/40 bg-up/10 px-4 py-3 text-[13px] text-up">
          {data.negotiation.error ?? 'La fiche n’a pas pu être préparée.'}
          <button type="button" onClick={retry} className="mt-2 block text-[12px] text-zinc-300 underline">
            Réessayer
          </button>
        </div>
      )}

      {sheet && ad && (
        <>
          <Verdict sheet={sheet} price={ad.price} />

          {sheet.warnings.length > 0 && (
            <div className="mt-3 rounded-2xl border border-up/40 bg-up/10 px-4 py-3">
              <div className="text-[12px] font-medium text-up">À vérifier avant tout</div>
              <ul className="mt-1 space-y-0.5 text-[12px] text-zinc-300">
                {sheet.warnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}

          {sheet.opening !== null && sheet.target !== null && sheet.ceiling !== null && (
            <section className="mt-3 grid grid-cols-3 gap-2">
              <PriceTile label="Ouvrir à" value={sheet.opening} hint="ta première offre" />
              <PriceTile
                label="Viser"
                value={sheet.target}
                hint={sheet.target === sheet.ceiling ? 'le prix du marché' : 'accord raisonnable'}
                accent
              />
              <PriceTile label="Plafond" value={sheet.ceiling} hint="au-delà, trop cher" />
            </section>
          )}

          <section className="mt-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
            <h2 className="text-[15px] font-medium text-zinc-100">Tes arguments</h2>
            <ul className="mt-2 space-y-2">
              {sheet.arguments.map((argument) => (
                <li key={argument.text} className="flex gap-2 text-[13px] leading-snug">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      argument.weight === 'strong' ? 'bg-accent' : argument.weight === 'useful' ? 'bg-zinc-400' : 'bg-zinc-700'
                    }`}
                  />
                  <span className={argument.weight === 'context' ? 'text-zinc-500' : 'text-zinc-200'}>{argument.text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-zinc-600">
              Marge retenue : {Math.round(sheet.room * 100)} % — d’après le type de vendeur, le temps passé en ligne et
              les baisses déjà consenties.
            </p>
          </section>

          {sheet.cheaper.length > 0 && (
            <section className="mt-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
              <h2 className="text-[15px] font-medium text-zinc-100">Moins chères, à citer</h2>
              <ul className="mt-1 divide-y divide-ink-line">
                {sheet.cheaper.map((other) => (
                  <li key={other.lbcId}>
                    <a
                      href={other.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-zinc-200">{other.title}</span>
                        <span className="block truncate text-[11px] text-zinc-500">
                          {[other.year, other.km !== null ? `${other.km.toLocaleString('fr-FR')} km` : null, other.location]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-[13px] font-medium text-white">{formatPrice(other.price)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {ad.km !== null && points.length >= 4 && (
            <section className="mt-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
              <h2 className="text-[15px] font-medium text-zinc-100">Parmi son marché</h2>
              <p className="mb-2 text-[11px] text-zinc-500">
                {ad.version && points.every((other) => other.version === ad.version)
                  ? `Les ${points.length} annonces ${ad.version} relevées.`
                  : `Les ${points.length} annonces du modèle relevées.`}
              </p>
              <PriceKmChart
                points={points}
                trends={[]}
                target={{ km: ad.km, price: ad.price }}
                targetLabel="cette annonce"
              />
            </section>
          )}

          <section className="mt-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-medium text-zinc-100">Message au vendeur</h2>
              <button
                type="button"
                onClick={copy}
                className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-black"
              >
                {copied ? 'Copié ✓' : 'Copier'}
              </button>
            </div>
            <textarea
              value={message}
              onChange={(event) => setDraft(event.target.value)}
              rows={10}
              className="mt-2 w-full resize-y rounded-xl border border-ink-line bg-ink px-3 py-2.5 text-[13px] leading-relaxed text-zinc-200 focus:border-accent focus:outline-none"
            />
            <a
              href={ad.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block text-center text-[12px] text-accent"
            >
              Ouvrir l’annonce pour l’envoyer ↗
            </a>
          </section>
        </>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={retry}
          disabled={pending}
          className="flex-1 rounded-xl border border-ink-line bg-ink-soft py-2.5 text-[14px] text-zinc-200 disabled:opacity-40"
        >
          {pending ? 'Préparation…' : 'Mettre à jour'}
        </button>
        <ConfirmButton
          onConfirm={remove}
          label="Supprimer"
          confirmLabel="Confirmer"
          className="rounded-xl border border-ink-line bg-ink-soft px-4 py-2.5 text-[14px] text-zinc-500"
        />
      </div>

      <p className="mt-4 px-1 text-[11px] leading-relaxed text-zinc-600">
        Des repères tirés des annonces en ligne, pas une expertise : l’état réel, l’historique d’entretien et
        l’essai priment sur tous ces chiffres.
      </p>
    </>
  );
}

function Verdict({ sheet, price }: { sheet: Sheet; price: number }) {
  if (!sheet.fair || sheet.position === null) {
    return (
      <div className="rounded-2xl border border-ink-line bg-ink-soft px-4 py-3 text-[13px] text-zinc-400">
        Pas assez de voitures comparables pour situer ce prix. Les arguments ci-dessous restent valables.
      </div>
    );
  }
  const share = Math.round(Math.abs(sheet.position) * 100);
  const tone =
    sheet.verdict === 'above'
      ? { box: 'border-up/40 bg-up/10', text: 'text-up', label: `${share} % au-dessus du marché` }
      : sheet.verdict === 'below'
        ? { box: 'border-down/40 bg-down/10', text: 'text-down', label: `${share} % sous le marché` }
        : { box: 'border-ink-line bg-ink-soft', text: 'text-zinc-100', label: 'Au prix du marché' };

  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone.box}`}>
      <div className={`text-[17px] font-semibold ${tone.text}`}>{tone.label}</div>
      <div className="text-[12px] text-zinc-400">
        {formatPrice(price)} demandés, pour une médiane de {formatPrice(sheet.fair.median)} sur {sheet.fair.count}{' '}
        comparables
        {sheet.daysOnline !== null && ` · en ligne depuis ${sheet.daysOnline} j`}
        {sheet.drops.length > 0 && ` · ${sheet.drops.length} baisse${sheet.drops.length > 1 ? 's' : ''}`}
      </div>
      {sheet.verdict === 'below' && (
        <div className="mt-1 text-[12px] text-zinc-300">Déjà bien placée : négocie peu et va vite.</div>
      )}
    </div>
  );
}

function PriceTile({ label, value, hint, accent = false }: { label: string; value: number; hint: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border px-3 py-3 ${accent ? 'border-accent/60 bg-accent/10' : 'border-ink-line bg-ink-soft'}`}>
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={`text-[17px] font-semibold tracking-tight ${accent ? 'text-accent' : 'text-white'}`}>
        {formatPrice(value)}
      </div>
      <div className="text-[10px] text-zinc-600">{hint}</div>
    </div>
  );
}

function larger(url: string): string {
  return url.replace(/rule=ad-(thumb|small|listing-thumb)/, 'rule=ad-image');
}
