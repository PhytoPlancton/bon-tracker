'use client';

import { useEffect, useRef, useState } from 'react';
import { placeLabel } from '@/lib/immo/labels';
import type { Place } from '@/lib/immo/types';

/**
 * Saisie d'une commune : nom ou code postal, avec les communes du
 * référentiel officiel proposées au fil de la frappe. Seule une commune
 * choisie dans la liste est retenue — c'est elle qui porte les codes postaux
 * et le centre dont la collecte a besoin.
 */
export function PlacePicker({
  value,
  onChange,
  inputClassName,
}: {
  value: Place | null;
  onChange: (place: Place | null) => void;
  inputClassName: string;
}) {
  const [text, setText] = useState(value ? placeLabel(value) : '');
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState('');
  const request = useRef(0);

  useEffect(() => {
    if (value) return;
    const query = text.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    const ticket = (request.current += 1);
    // Une requête par pause dans la frappe, pas une par lettre.
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/immo/places?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
        const body = (await response.json().catch(() => ({}))) as { places?: Place[]; error?: string };
        if (ticket !== request.current) return;
        setSuggestions(body.places ?? []);
        setError(response.ok ? null : (body.error ?? 'Recherche de commune impossible.'));
        setSearched(query);
        setOpen(true);
      } catch {
        if (ticket === request.current) setError('Recherche de commune impossible.');
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [text, value]);

  function choose(place: Place) {
    onChange(place);
    setText(placeLabel(place));
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          // Modifier le texte, c'est renoncer à la commune choisie.
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Nantes, 75011…"
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="search"
        className={inputClassName}
        aria-label="Commune ou code postal"
      />
      {value && (
        <button
          type="button"
          aria-label="Changer de commune"
          onClick={() => {
            onChange(null);
            setText('');
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-[13px] text-zinc-500"
        >
          ✕
        </button>
      )}
      {open && !value && suggestions.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-ink-line bg-ink-soft shadow-2xl shadow-black/60">
          {suggestions.map((place) => (
            <li key={place.code}>
              <button
                type="button"
                // Avant la perte de focus du champ, qui fermerait la liste.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(place)}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left active:bg-ink-line"
              >
                <span className="truncate text-[14px] text-zinc-100">{placeLabel(place)}</span>
                <span className="shrink-0 text-[11px] text-zinc-500">
                  {place.postalCodes.length > 1 ? `${place.postalCodes[0]}…` : place.postalCodes[0]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && !value && <p className="mt-1 text-[11px] text-up">{error}</p>}
      {!error && !value && suggestions.length === 0 && searched && searched === text.trim() && (
        <p className="mt-1 text-[11px] text-zinc-500">Aucune commune de ce nom. Essaie le code postal.</p>
      )}
    </div>
  );
}
