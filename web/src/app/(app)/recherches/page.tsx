'use client';

import { useState } from 'react';
import { useApi } from '@/lib/client';
import { relativeTime } from '@/lib/format';

interface SearchesResponse {
  searches: {
    lbcSearchId: string;
    name: string;
    url: string;
    category: string | null;
    tracked: boolean;
    lastRunAt: string | null;
    itemCount: number;
  }[];
}

export default function SearchesPage() {
  const { data, loading, reload } = useApi<SearchesResponse>('/api/searches');
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(id: string, tracked: boolean) {
    setPending(id);
    await fetch(`/api/searches/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tracked }),
    });
    await reload();
    setPending(null);
  }

  const searches = data?.searches ?? [];

  return (
    <>
      <header className="pb-4 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">Recherches</h1>
        <p className="text-xs text-zinc-500">
          Active une recherche pour suivre le prix de toutes ses annonces.
        </p>
      </header>

      {loading ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-[76px] animate-pulse rounded-2xl border border-ink-line bg-ink-soft" />
          ))}
        </div>
      ) : searches.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-line px-5 py-10 text-center text-sm text-zinc-500">
          Aucune recherche sauvegardée détectée. Elles apparaîtront après le prochain relevé.
        </div>
      ) : (
        <div className="space-y-2.5">
          {searches.map((search) => (
            <div
              key={search.lbcSearchId}
              className="flex items-center gap-3 rounded-2xl border border-ink-line bg-ink-soft p-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-zinc-100">{search.name}</div>
                <div className="mt-0.5 text-[11px] text-zinc-600">
                  {search.category ?? 'toutes catégories'}
                  {search.tracked && ` · relevé ${relativeTime(search.lastRunAt)}`}
                </div>
              </div>

              <Toggle
                checked={search.tracked}
                disabled={pending === search.lbcSearchId}
                onChange={(value) => void toggle(search.lbcSearchId, value)}
                label={`Suivre ${search.name}`}
              />
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 px-1 text-[11px] leading-relaxed text-zinc-600">
        Une recherche large génère beaucoup d’annonces éphémères : l’historique n’a de valeur
        que sur celles qui restent en ligne plusieurs jours.
      </p>
    </>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-accent' : 'bg-ink-line'
      }`}
    >
      <span
        className={`absolute left-0 top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}
