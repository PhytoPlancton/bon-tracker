'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CollectProgress, type Activity } from '@/components/collect-progress';
import { ConfirmButton } from '@/components/confirm-button';
import { MarketChart, type ChartPoint } from '@/components/market-chart';
import { useApi } from '@/lib/client';
import { formatPrice, relativeTime } from '@/lib/format';
import {
  analyze,
  energyGroup,
  estimate,
  grossYield,
  plausible,
  roomsGroup,
  type Gap,
  type ImmoAdView,
} from '@/lib/immo/estimation';
import { criteriaLabel, formatPerM2, marketTitle } from '@/lib/immo/labels';
import type { Place, PropertyType, Transaction } from '@/lib/immo/types';

interface Detail {
  estimation: {
    id: string;
    transaction: Transaction;
    propertyType: PropertyType;
    place: Place;
    radiusKm: number;
    surface: number | null;
    surfaceMin: number | null;
    surfaceMax: number | null;
    status: 'queued' | 'running' | 'done' | 'error';
    pages: number;
    ads: number;
    error: string | null;
    collectedAt: string | null;
    activity?: Activity | null;
    stopRequested?: boolean;
  };
  ads: ImmoAdView[];
  counterpart: {
    transaction: Transaction;
    perM2: number;
    count: number;
    collectedAt: string;
    id: string | null;
  } | null;
}

const ALL = '__all__';
const ROOMS_ORDER = ['1 pièce', '2 pièces', '3 pièces', '4 pièces', '5 pièces et +', 'Non précisé'];
const ROOM_COLORS = ['#38bdf8', '#4ade80', '#facc15', '#c084fc', '#f472b6', '#71717a'];
/** Les couleurs de l'étiquette énergie, que tout acheteur a déjà vues. */
const DPE_COLORS: Record<string, string> = {
  A: '#009c6d',
  B: '#52b153',
  C: '#a5cc74',
  D: '#f4e70f',
  E: '#f0b40f',
  F: '#eb8235',
  G: '#d7221f',
  'DPE inconnu': '#52525b',
};
const ENERGY_GROUPS = ['A à C', 'D et E', 'F et G'];

type ColorBy = 'rooms' | 'energy';

export default function ImmoEstimationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, loading, error, reload } = useApi<Detail>(`/api/immo/estimations/${id}`);

  const [rooms, setRooms] = useState(ALL);
  const [energy, setEnergy] = useState(ALL);
  const [age, setAge] = useState(ALL);
  const [colorBy, setColorBy] = useState<ColorBy>('rooms');
  const [surfaceInput, setSurfaceInput] = useState<string | null>(null);
  const [targetRooms, setTargetRooms] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [crossing, setCrossing] = useState(false);

  const status = data?.estimation.status;
  const collecting = status === 'queued' || status === 'running';

  useEffect(() => {
    if (!collecting) return;
    // Assez souvent pour que l'écran de collecte paraisse vivant.
    const timer = setInterval(() => void reload(), 2000);
    return () => clearInterval(timer);
  }, [collecting, reload]);

  const transaction = data?.estimation.transaction ?? 'vente';
  const ads = useMemo(() => data?.ads ?? [], [data]);
  const overall = useMemo(() => analyze(ads, transaction), [ads, transaction]);
  const allKept = useMemo(() => plausible(ads, transaction).kept, [ads, transaction]);

  // Pièces, DPE, neuf : chaque filtre vaut pour toute la page, estimation comprise.
  const filtered = useMemo(
    () =>
      ads.filter(
        (ad) =>
          (rooms === ALL || roomsGroup(ad.rooms) === rooms) &&
          (energy === ALL || energyGroup(ad.energy) === energy) &&
          (age === ALL || (age === 'neuf' ? ad.isNew === true : ad.isNew !== true)),
      ),
    [ads, rooms, energy, age],
  );
  const analysis = useMemo(() => analyze(filtered, transaction), [filtered, transaction]);
  const kept = useMemo(() => plausible(filtered, transaction).kept, [filtered, transaction]);

  const energyCounts = useMemo(() => countBy(allKept, (ad) => energyGroup(ad.energy)), [allKept]);
  const newCount = allKept.filter((ad) => ad.isNew === true).length;

  // Le graphique compte les annonces sans surface, mais laisse de côté celles
  // mises à part : un bouquet de viager à 60 000 € écraserait tout le nuage
  // vers la droite. Elles restent comptées sous le prix médian.
  const shown = useMemo(() => {
    const keptIds = new Set(kept.map((ad) => ad.lbcId));
    return filtered.filter((ad) => keptIds.has(ad.lbcId) || (ad.surface === null && !ad.flags?.length));
  }, [filtered, kept]);

  const surfaceText = surfaceInput ?? (data?.estimation.surface ? String(data.estimation.surface) : '');
  const targetSurface = Number(surfaceText) || null;
  const targetRoomsValue = targetRooms ? Number(targetRooms) : null;
  const valuation = useMemo(
    () => (targetSurface ? estimate({ surface: targetSurface, rooms: targetRoomsValue }, kept, transaction) : null),
    [targetSurface, targetRoomsValue, kept, transaction],
  );

  const points = useMemo<ChartPoint[]>(
    () =>
      shown.map((ad) => ({
        lbcId: ad.lbcId,
        title: ad.title,
        url: ad.url,
        price: ad.price,
        y: ad.surface,
        group: colorBy === 'rooms' ? roomsGroup(ad.rooms) : (ad.energy ?? 'DPE inconnu'),
        details: [
          ad.surface !== null ? `${ad.surface.toLocaleString('fr-FR')} m²` : null,
          ad.rooms ? `${ad.rooms} p.` : null,
          ad.perM2 !== null ? formatPerM2(ad.perM2, transaction) : null,
          ad.energy ? `DPE ${ad.energy}` : null,
        ],
        imageUrl: ad.imageUrl,
        sellerType: ad.sellerType,
        location: ad.location,
        flags: ad.flags,
        tags: ad.tags,
      })),
    [shown, colorBy, transaction],
  );
  const groups = useMemo(() => {
    const present = new Set(points.map((point) => point.group));
    return colorBy === 'rooms'
      ? ROOMS_ORDER.filter((name) => present.has(name)).map((name) => ({ name, color: ROOM_COLORS[ROOMS_ORDER.indexOf(name)] }))
      : Object.keys(DPE_COLORS).filter((name) => present.has(name)).map((name) => ({ name, color: DPE_COLORS[name] }));
  }, [points, colorBy]);

  function pickRooms(name: string) {
    if (name !== 'Non précisé') setRooms(name);
  }

  async function refresh() {
    setRefreshing(true);
    await fetch(`/api/immo/estimations/${id}`, { method: 'POST' });
    await reload();
    setRefreshing(false);
  }

  async function stop() {
    setStopping(true);
    await fetch(`/api/immo/estimations/${id}/stop`, { method: 'POST' });
    await reload();
    setStopping(false);
  }

  async function remove() {
    await fetch(`/api/immo/estimations/${id}`, { method: 'DELETE' });
    router.push('/immo');
  }

  /** Le même bien, de l'autre côté du marché : les loyers face aux prix, ou l'inverse. */
  async function crossMarket() {
    if (!data) return;
    setCrossing(true);
    const { estimation } = data;
    const response = await fetch('/api/immo/estimations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        transaction: estimation.transaction === 'vente' ? 'location' : 'vente',
        propertyType: estimation.propertyType,
        place: estimation.place,
        radiusKm: estimation.radiusKm,
        surface: estimation.surface,
      }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setCrossing(false);
    if (response?.ok && body.id) router.push(`/immo/${body.id}`);
  }

  if (loading) {
    return <div className="mt-4 h-80 animate-pulse rounded-2xl border border-ink-line bg-ink-soft" />;
  }
  if (!data) {
    return (
      <p className="mt-8 text-center text-sm text-zinc-500">
        {error === 'Erreur 404' ? 'Estimation introuvable.' : error}{' '}
        <Link href="/immo" className="text-accent">
          Retour
        </Link>
      </p>
    );
  }

  const { estimation, counterpart } = data;
  const rent = transaction === 'location';
  const money = (value: number) => `${formatPrice(value)}${rent ? ' /mois' : ''}`;
  const own = estimation.propertyType === 'maison' ? 'Ta maison' : 'Ton appartement';
  const salePerM2 = rent ? counterpart?.perM2 : overall?.perM2.median;
  const rentPerM2 = rent ? overall?.perM2.median : counterpart?.perM2;
  const yieldRate = salePerM2 && rentPerM2 ? grossYield(salePerM2, rentPerM2) : null;

  return (
    <>
      <header className="pb-3 pt-1">
        <Link href="/immo" className="text-[13px] text-accent">
          ‹ Marché
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{marketTitle(estimation)}</h1>
        <p className="text-xs text-zinc-500">
          {criteriaLabel(estimation)}
          {estimation.collectedAt && ` · relevé ${relativeTime(estimation.collectedAt)}`}
        </p>
      </header>

      {collecting && (
        <CollectProgress
          label={marketTitle(estimation)}
          status={status === 'queued' ? 'queued' : 'running'}
          pages={estimation.pages}
          ads={estimation.ads}
          activity={estimation.activity}
        />
      )}

      {collecting && (
        <button
          onClick={stop}
          disabled={stopping || estimation.stopRequested}
          className="mb-3 w-full rounded-xl border border-ink-line bg-ink-soft py-2.5 text-[14px] text-zinc-200 disabled:opacity-50"
        >
          {estimation.stopRequested
            ? 'Arrêt demandé : fin de la page en cours…'
            : status === 'queued'
              ? 'Annuler cette collecte'
              : 'Arrêter et garder ce qui a été lu'}
        </button>
      )}

      {status === 'error' && (
        <div className="mb-3 rounded-2xl border border-up/40 bg-up/10 px-4 py-3 text-[13px] text-up">
          {estimation.error ?? 'La collecte a échoué.'}
          {estimation.collectedAt && (
            <span className="mt-0.5 block text-[11px] text-zinc-400">
              Les chiffres ci-dessous datent de la collecte précédente.
            </span>
          )}
        </div>
      )}

      {!overall ? (
        !collecting && (
          <div className="rounded-2xl border border-dashed border-ink-line px-5 py-10 text-center text-sm text-zinc-500">
            {ads.length
              ? `Seulement ${ads.length} annonce${ads.length > 1 ? 's' : ''}, dont trop peu comparables pour une cote. Élargis le rayon ou la surface.`
              : 'Aucune annonce trouvée pour ce marché. Élargis le rayon, ou essaie sans surface.'}
          </div>
        )
      ) : (
        <>
          <section className="rounded-2xl border border-ink-line bg-ink-soft p-4">
            <div className="grid grid-cols-2 gap-2">
              <Select value={rooms} onChange={setRooms} label="Pièces">
                <option value={ALL}>Toutes pièces</option>
                {overall.rooms.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name} ({item.count})
                  </option>
                ))}
              </Select>
              <Select value={energy} onChange={setEnergy} label="DPE">
                <option value={ALL}>Tous DPE</option>
                {ENERGY_GROUPS.filter((name) => energyCounts.get(name)).map((name) => (
                  <option key={name} value={name}>
                    DPE {name} ({energyCounts.get(name)})
                  </option>
                ))}
              </Select>
            </div>
            {newCount > 0 && newCount < allKept.length && (
              <div className="mt-2">
                <Select value={age} onChange={setAge} label="Neuf ou ancien">
                  <option value={ALL}>Ancien et neuf</option>
                  <option value="ancien">Ancien seulement ({allKept.length - newCount})</option>
                  <option value="neuf">Neuf seulement ({newCount})</option>
                </Select>
              </div>
            )}

            {analysis ? (
              <>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-zinc-600">
                      {rent ? 'Loyer médian au m²' : 'Prix médian au m²'}
                    </div>
                    <div className="text-3xl font-semibold tracking-tight text-white">
                      {formatPerM2(analysis.perM2.median, transaction)}
                    </div>
                  </div>
                  <div className="pb-1 text-right text-[12px] text-zinc-400">
                    moitié entre
                    <br />
                    <span className="text-zinc-200">
                      {formatPerM2(analysis.perM2.p25, transaction).replace(' €/m²', '')} et{' '}
                      {formatPerM2(analysis.perM2.p75, transaction)}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-[12px] text-zinc-400">
                  {rent ? 'Loyer médian' : 'Prix médian'} {money(analysis.median)} · {analysis.surface.median} m² médian
                </p>
                <p className="mt-1 text-[11px] text-zinc-600">
                  {analysis.count} annonces
                  {overall.excluded > 0 && rooms === ALL && energy === ALL && age === ALL &&
                    ` · ${overall.excluded} écartée${overall.excluded > 1 ? 's' : ''} (prix aberrants)`}
                  {analysis.flagged > 0 &&
                    ` · ${analysis.flagged} à part, hors calculs (${rent ? 'colocation, courte durée…' : 'viager, enchères…'})`}
                  {analysis.unmeasured > 0 && ` · ${analysis.unmeasured} sans surface`}
                </p>

                <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
                  Couleur
                  <div className="flex rounded-lg border border-ink-line p-0.5">
                    {(['rooms', 'energy'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setColorBy(mode)}
                        className={`rounded-md px-2.5 py-1 outline-none ${
                          colorBy === mode ? 'bg-ink-line text-zinc-100' : 'text-zinc-500'
                        }`}
                      >
                        {mode === 'rooms' ? 'Pièces' : 'DPE'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 -mx-1">
                  <MarketChart
                    points={points}
                    trends={[{ group: null, points: analysis.trend.map((step) => ({ y: step.surface, price: step.price })) }]}
                    target={valuation && targetSurface ? { y: targetSurface, price: valuation.value } : null}
                    coloring={{
                      by: 'group',
                      groups,
                      other: '#71717a',
                      // Un clic sur une légende de pièces filtre la page sur ce nombre de pièces.
                      onPick: colorBy === 'rooms' ? pickRooms : undefined,
                    }}
                    axis={{ label: 'm² ↑', tick: (value) => `${Math.round(value)} m²`, minSpan: 6, gapAt: 'à cette surface', missing: 'sans surface' }}
                    priceMinSpan={rent ? 60 : 8000}
                    targetLabel={own.toLowerCase()}
                    flaggedLabel="à part, hors calculs"
                  />
                </div>
              </>
            ) : (
              <p className="mt-4 text-[13px] text-zinc-500">Trop peu d’annonces avec ces filtres : {filtered.length}.</p>
            )}
          </section>

          <section className="mt-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
            <h2 className="text-[15px] font-medium text-zinc-100">{own}</h2>
            <p className="mb-3 text-[11px] text-zinc-500">
              {rent ? 'Son loyer' : 'Sa valeur'} d’après les biens qui lui ressemblent le plus : même nombre de pièces,
              surface proche.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <input
                value={surfaceText}
                onChange={(event) => setSurfaceInput(event.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                placeholder="Surface (m²)"
                aria-label="Surface en m²"
                className={INPUT}
              />
              <select
                value={targetRooms}
                onChange={(event) => setTargetRooms(event.target.value)}
                aria-label="Nombre de pièces"
                className={INPUT}
              >
                <option value="">Pièces : toutes</option>
                {[1, 2, 3, 4, 5].map((count) => (
                  <option key={count} value={count}>
                    {count === 5 ? '5 pièces et +' : count === 1 ? '1 pièce' : `${count} pièces`}
                  </option>
                ))}
              </select>
            </div>

            {targetSurface &&
              (valuation ? (
                <div className="mt-4">
                  <div className="text-3xl font-semibold tracking-tight text-white">{money(valuation.value)}</div>
                  <div className="text-[12px] text-zinc-400">
                    entre {formatPrice(valuation.low)} et {money(valuation.high)} ·{' '}
                    {formatPerM2(valuation.perM2.median, transaction)}
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-600">
                    {valuation.count} biens comparables : ±{valuation.tolerance.surface} m²
                    {valuation.tolerance.sameRooms ? ', même nombre de pièces' : ''}.
                  </p>
                  <ul className="mt-3 divide-y divide-ink-line">
                    {valuation.comparables.slice(0, 5).map((ad) => (
                      <AdRow key={ad.lbcId} ad={ad} transaction={transaction} />
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-3 text-[12px] text-zinc-500">
                  Pas assez de biens comparables pour chiffrer celui-ci, même en élargissant.
                </p>
              ))}
          </section>

          <Insights analysis={overall} transaction={transaction} />

          <section className="mt-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
            <h2 className="text-[15px] font-medium text-zinc-100">Rendement</h2>
            {counterpart && yieldRate !== null ? (
              <>
                <div className="mt-2 text-3xl font-semibold tracking-tight text-white">
                  ≈ {(yieldRate * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % brut
                </div>
                <p className="mt-1 text-[12px] text-zinc-400">
                  Loyer médian {formatPerM2(rentPerM2 ?? null, 'location')} par mois, prix médian{' '}
                  {formatPerM2(salePerM2 ?? null, 'vente')}.
                </p>
                <p className="mt-1 text-[11px] text-zinc-600">
                  Douze mois de loyer rapportés au prix d’achat, avant charges, taxe foncière et mois sans
                  locataire. {rent ? 'Prix de vente' : 'Loyers'} relevés {relativeTime(counterpart.collectedAt)} sur{' '}
                  {counterpart.count} annonces.
                </p>
                {counterpart.id && (
                  <Link href={`/immo/${counterpart.id}`} className="mt-2 inline-block text-[12px] text-accent">
                    {rent ? 'Voir les prix de vente' : 'Voir les loyers'} ›
                  </Link>
                )}
              </>
            ) : (
              <>
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                  {rent
                    ? 'Estime aussi les prix de vente ici : rapportés aux loyers, ils donnent le rendement d’un achat pour louer.'
                    : 'Estime aussi les loyers ici : rapportés aux prix, ils donnent le rendement d’un achat pour louer.'}
                </p>
                <button
                  type="button"
                  onClick={() => void crossMarket()}
                  disabled={crossing}
                  className="mt-3 w-full rounded-xl border border-accent/60 py-2.5 text-[14px] text-accent disabled:opacity-50"
                >
                  {crossing ? 'Envoi…' : rent ? 'Estimer les prix de vente ici' : 'Estimer les loyers ici'}
                </button>
              </>
            )}
          </section>

          {analysis && analysis.deals.length > 0 && (
            <section className="mt-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
              <h2 className="text-[15px] font-medium text-zinc-100">Sous leurs comparables</h2>
              <p className="mb-2 text-[11px] text-zinc-500">
                Au moins 15 % sous le {rent ? 'loyer' : 'prix'} au m² de biens comparables : même nombre de pièces,
                surface proche. Souvent pour une raison — travaux, DPE, étage — : à vérifier.
              </p>
              <ul className="divide-y divide-ink-line">
                {analysis.deals.map((deal) => (
                  <AdRow
                    key={deal.lbcId}
                    ad={deal}
                    transaction={transaction}
                    note={`${Math.round(deal.ratio * 100)} % sous ${formatPerM2(deal.referencePerM2, transaction)}`}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={refresh}
          disabled={collecting || refreshing}
          className="flex-1 rounded-xl border border-ink-line bg-ink-soft py-2.5 text-[14px] text-zinc-200 disabled:opacity-40"
        >
          {collecting ? 'Collecte en cours…' : 'Actualiser'}
        </button>
        <ConfirmButton
          onConfirm={remove}
          label="Supprimer"
          confirmLabel="Confirmer"
          className="rounded-xl border border-ink-line bg-ink-soft px-4 py-2.5 text-[14px] text-zinc-500"
        />
      </div>

      <p className="mt-4 px-1 text-[11px] leading-relaxed text-zinc-600">
        {rent
          ? 'Ce sont des loyers demandés, charges comprises ou non selon l’annonce. L’état, l’étage et l’exposition comptent autant que les chiffres.'
          : 'Ce sont des prix demandés, pas des prix de vente : un bien se négocie souvent sous son annonce. Les ventes réellement conclues sont publiques (base DVF, sur data.gouv.fr).'}
      </p>
    </>
  );
}

/** Ce qui fait le prix ici : la taille, le DPE, le neuf. */
function Insights({ analysis, transaction }: { analysis: NonNullable<ReturnType<typeof analyze>>; transaction: Transaction }) {
  const rent = transaction === 'location';
  if (analysis.rooms.length < 2 && !analysis.energyGap && !analysis.newGap) return null;
  return (
    <section className="mt-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
      <h2 className="text-[15px] font-medium text-zinc-100">Ce qui fait le prix</h2>
      {analysis.rooms.length > 1 && (
        <table className="mt-2 w-full text-[12px]">
          <tbody className="divide-y divide-ink-line">
            {analysis.rooms.map((row) => (
              <tr key={row.name}>
                <td className="py-1.5 text-zinc-300">{row.name}</td>
                <td className="py-1.5 text-right text-zinc-500">{row.count}</td>
                <td className="py-1.5 text-right text-zinc-300">
                  {formatPrice(row.median)}
                  {rent ? ' /mois' : ''}
                </td>
                <td className="py-1.5 text-right text-zinc-100">{formatPerM2(row.perM2, transaction)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {analysis.energyGap && (
        <GapLine gap={analysis.energyGap} label="Passoires (DPE F et G)" against="logements classés A à D" />
      )}
      {analysis.newGap && <GapLine gap={analysis.newGap} label="Neuf" against="l’ancien" />}
    </section>
  );
}

function GapLine({ gap, label, against }: { gap: Gap; label: string; against: string }) {
  const percent = Math.round(gap.ratio * 100);
  if (percent === 0) {
    return (
      <p className="mt-2 text-[12px] text-zinc-400">
        {label} : même prix au m² que {against} de taille proche.
      </p>
    );
  }
  return (
    <p className="mt-2 text-[12px] text-zinc-400">
      {label} :{' '}
      {/* Signe et mot : l'écart ne repose jamais sur la couleur seule. */}
      <span className={percent < 0 ? 'text-down' : 'text-zinc-200'}>
        {percent < 0 ? '−' : '+'}
        {Math.abs(percent)} % au m²
      </span>{' '}
      face {against === 'l’ancien' ? 'à' : 'aux'} {against} de taille proche ({gap.count} et {gap.referenceCount} annonces).
    </p>
  );
}

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-ink-line bg-ink px-3 py-2.5 text-[14px] text-zinc-100 focus:border-accent focus:outline-none"
      >
        {children}
      </select>
    </label>
  );
}

const INPUT =
  'w-full rounded-xl border border-ink-line bg-ink px-3 py-2.5 text-[15px] text-zinc-100 placeholder:text-zinc-600 focus:border-accent focus:outline-none';

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function AdRow({ ad, note, transaction }: { ad: ImmoAdView; note?: string; transaction: Transaction }) {
  return (
    <li>
      <a href={ad.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] text-zinc-200">{ad.title}</div>
          <div className="truncate text-[11px] text-zinc-500">
            {[
              ad.surface !== null ? `${ad.surface.toLocaleString('fr-FR')} m²` : null,
              ad.rooms ? `${ad.rooms} p.` : null,
              ad.energy ? `DPE ${ad.energy}` : null,
              ...(ad.tags ?? []),
              ad.location,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[13px] font-medium text-white">{formatPrice(ad.price)}</div>
          <div className="text-[11px] text-zinc-500">{formatPerM2(ad.perM2, transaction)}</div>
          {note && <div className="text-[11px] text-down">{note}</div>}
        </div>
      </a>
    </li>
  );
}
