'use client';

import { useState } from 'react';
import { useApi } from '@/lib/client';
import { formatDateTime, relativeTime } from '@/lib/format';

interface StatusResponse {
  lastRun: {
    startedAt: string;
    finishedAt: string | null;
    status: 'ok' | 'error' | 'needs_session' | 'running';
    stats: { seen: number; created: number; priceChanges: number; deactivated: number };
    error: string | null;
  } | null;
  hasSession: boolean;
  sessionUpdatedAt: string | null;
  activeListings: number;
  trackedSearches: number;
}

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  ok: { text: 'Collecte OK', className: 'text-down' },
  error: { text: 'Dernier relevé en échec', className: 'text-up' },
  needs_session: { text: 'Session leboncoin à rétablir', className: 'text-accent' },
  running: { text: 'Relevé en cours', className: 'text-zinc-400' },
};

export default function SettingsPage() {
  const { data, reload } = useApi<StatusResponse>('/api/status');
  const [cookieHeader, setCookieHeader] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectMessage, setCollectMessage] = useState<string | null>(null);

  /**
   * Demande un relevé, puis surveille l'état jusqu'à ce qu'un nouveau passage
   * soit enregistré. Un relevé complet prend plusieurs minutes : sans cette
   * attente, l'écran semblerait ne rien faire.
   */
  async function collectNow() {
    setCollecting(true);
    setCollectMessage('Relevé lancé…');

    const before = data?.lastRun?.finishedAt ?? null;
    const response = await fetch('/api/refresh', { method: 'POST' });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      setCollectMessage(body.error ?? 'Le relevé n’a pas pu démarrer.');
      setCollecting(false);
      return;
    }

    const started = Date.now();
    const timer = setInterval(async () => {
      const fresh = await fetch('/api/status', { cache: 'no-store' })
        .then((res) => res.json() as Promise<StatusResponse>)
        .catch(() => null);

      const done = fresh?.lastRun?.finishedAt && fresh.lastRun.finishedAt !== before;
      // Le relevé continue peut-être, mais on cesse de l'attendre à l'écran.
      const tooLong = Date.now() - started > 8 * 60 * 1000;

      if (done || tooLong) {
        clearInterval(timer);
        setCollecting(false);
        setCollectMessage(
          done
            ? `Terminé : ${fresh?.lastRun?.stats.seen ?? 0} annonces vues, ` +
                `${fresh?.lastRun?.stats.priceChanges ?? 0} changement(s) de prix.`
            : 'Le relevé prend plus de temps que prévu, il continue en arrière-plan.',
        );
        void reload();
      }
    }, 4000);
  }

  async function submitSession(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const response = await fetch('/api/lbc-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookieHeader }),
    });
    const body = await response.json().catch(() => ({}));

    setMessage(
      response.ok
        ? `Session enregistrée (${body.cookies} cookies). Elle sera utilisée au prochain relevé.`
        : (body.error ?? 'Enregistrement impossible'),
    );
    if (response.ok) setCookieHeader('');
    setPending(false);
    void reload();
  }

  const status = data?.lastRun?.status ?? (data?.hasSession ? 'running' : 'needs_session');
  const label = STATUS_LABEL[status] ?? STATUS_LABEL.running;

  return (
    <>
      <header className="pb-4 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">Réglages</h1>
      </header>

      <section className="mb-4 rounded-2xl border border-ink-line bg-ink-soft p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400">État de la collecte</span>
          <span className={`text-sm font-medium ${label.className}`}>{label.text}</span>
        </div>

        <dl className="mt-3 space-y-1.5 text-[13px]">
          <Row
            label="Dernier relevé"
            value={data?.lastRun?.finishedAt ? relativeTime(data.lastRun.finishedAt) : 'jamais'}
          />
          <Row label="Annonces suivies" value={String(data?.activeListings ?? 0)} />
          <Row label="Recherches actives" value={String(data?.trackedSearches ?? 0)} />
          <Row
            label="Session leboncoin"
            value={
              data?.sessionUpdatedAt ? `posée ${relativeTime(data.sessionUpdatedAt)}` : 'absente'
            }
          />
        </dl>

        <button
          onClick={() => void collectNow()}
          disabled={collecting}
          className="mt-4 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {collecting ? 'Relevé en cours…' : 'Relever les prix maintenant'}
        </button>
        {collectMessage && <p className="mt-2 text-[12px] text-zinc-400">{collectMessage}</p>}

        {data?.lastRun && (
          <p className="mt-3 border-t border-ink-line pt-3 text-[11px] leading-relaxed text-zinc-600">
            {formatDateTime(data.lastRun.startedAt)} · {plural(data.lastRun.stats.seen, 'annonce vue', 'annonces vues')} ·{' '}
            {plural(data.lastRun.stats.created, 'nouvelle', 'nouvelles')} ·{' '}
            {plural(data.lastRun.stats.priceChanges, 'changement de prix', 'changements de prix')}
            {data.lastRun.error && (
              <span className="mt-1 block text-up">{data.lastRun.error}</span>
            )}
          </p>
        )}
      </section>

      <section className="mb-4 rounded-2xl border border-ink-line bg-ink-soft p-4">
        <h2 className="text-sm font-medium text-zinc-200">Session leboncoin de secours</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
          Le worker se connecte seul. Si leboncoin réclame une vérification, colle ici l’en-tête
          <code className="mx-1 rounded bg-ink px-1 py-0.5 text-[11px] text-zinc-400">Cookie</code>
          relevé depuis un navigateur déjà connecté.
        </p>

        <button
          onClick={() => setShowHelp((value) => !value)}
          className="mt-2 text-[12px] font-medium text-accent"
        >
          {showHelp ? 'Masquer la marche à suivre' : 'Comment le récupérer ?'}
        </button>

        {showHelp && (
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-zinc-500">
            <li>Sur ordinateur, ouvre leboncoin.fr connecté à ton compte.</li>
            <li>Ouvre les outils de développement, onglet Réseau.</li>
            <li>Recharge la page et clique la première requête vers leboncoin.fr.</li>
            <li>
              Dans les en-têtes de requête, copie toute la valeur de <code>Cookie</code>.
            </li>
            <li>Colle-la ci-dessous.</li>
          </ol>
        )}

        <form onSubmit={submitSession} className="mt-3 space-y-2">
          <textarea
            value={cookieHeader}
            onChange={(event) => setCookieHeader(event.target.value)}
            rows={4}
            placeholder="datadome=…; luat=…; …"
            className="w-full resize-none rounded-xl border border-ink-line bg-ink px-3 py-2.5 font-mono text-[11px] outline-none placeholder:text-zinc-700 focus:border-accent"
          />
          <button
            type="submit"
            disabled={pending || cookieHeader.trim().length < 10}
            className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-ink disabled:opacity-40"
          >
            {pending ? 'Enregistrement…' : 'Enregistrer la session'}
          </button>
          {message && <p className="text-[12px] text-zinc-400">{message}</p>}
        </form>
      </section>

      <button
        onClick={async () => {
          await fetch('/api/auth/logout', { method: 'POST' });
          window.location.href = '/login';
        }}
        className="w-full rounded-xl border border-ink-line bg-ink-soft px-4 py-3.5 text-sm font-medium text-zinc-400"
      >
        Se déconnecter
      </button>
    </>
  );
}

/** Accorde le nom au nombre : « 1 changement » et non « 1 changements ». */
function plural(count: number, singular: string, many: string): string {
  return `${count} ${count > 1 ? many : singular}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-300">{value}</dd>
    </div>
  );
}
