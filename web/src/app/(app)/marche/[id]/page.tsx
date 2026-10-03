'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CollectProgress, type Activity } from '@/components/collect-progress';
import { PriceKmChart, type ColorBy } from '@/components/price-km-chart';
import { useApi } from '@/lib/client';
import { analyze, estimate, plausible, type Ad } from '@/lib/estimation';
import { formatPrice, relativeTime, criteriaLabel } from '@/lib/format';

interface Detail {
  estimation: {
    id: string;
    brand: string;
    model: string;
    yearMin: number | null;
    yearMax: number | null;
    powerMin?: number | null;
    powerMax?: number | null;
    status: 'queued' | 'running' | 'done' | 'error';
    pages: number;
    ads: number;
    error: string | null;
    collectedAt: string | null;
    activity?: Activity | null;
  };
  ads: Ad[];
}

const ALL = '__all__';
const UNKNOWN = 'Non précisée';

export default function EstimationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, loading, error, reload } = useApi<Detail>(`/api/estimations/${id}`);

  const [version, setVersion] = useState(ALL);
  const [gearbox, setGearbox] = useState(ALL);
  const [year, setYear] = useState('');
  const [km, setKm] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [colorBy, setColorBy] = useState<ColorBy>('version');

  const status = data?.estimation.status;
  const collecting = status === 'queued' || status === 'running';

  useEffect(() => {
    if (!collecting) return;
    // Assez souvent pour que l'écran de collecte paraisse vivant.
    const timer = setInterval(() => void reload(), 2000);
    return () => clearInterval(timer);
  }, [collecting, reload]);

  const ads = useMemo(() => data?.ads ?? [], [data]);
  const overall = useMemo(() => analyze(ads), [ads]);
  // Épaves, pièces et prix aberrants écrasent le graphique et faussent tout.
  const allKept = useMemo(() => plausible(ads).kept, [ads]);
  // Les annonces à risque restent visibles, mais hors de tout calcul.
  const allRisky = useMemo(() => ads.filter((ad) => ad.flags?.length && ad.price >= 500), [ads]);

  const gearboxes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ad of allKept) if (ad.gearbox) counts.set(ad.gearbox, (counts.get(ad.gearbox) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [allKept]);

  // La boîte change le prix d'une même voiture : filtrée, elle vaut pour tout
  // le reste de la page, estimation comprise.
  const kept = useMemo(() => withGearbox(allKept, gearbox), [allKept, gearbox]);
  const risky = useMemo(() => withGearbox(allRisky, gearbox), [allRisky, gearbox]);

  // Le filtre de motorisation recalcule tout : médiane, courbe et affaires
  // n'ont de sens qu'entre voitures du même moteur.
  const filtered = useMemo(() => withVersion(kept, version), [kept, version]);
  const shown = useMemo(() => [...filtered, ...withVersion(risky, version)], [filtered, risky, version]);
  const analysis = useMemo(() => analyze(filtered), [filtered]);

  const versionOrder = useMemo(() => overall?.versions.map((item) => item.name) ?? [], [overall]);
  const several = versionOrder.length > 1;
  // Colorer par moteur n'a de sens que lorsque plusieurs sont affichés.
  const shownColor: ColorBy = version === ALL && several ? colorBy : 'year';

  // Une médiane qui mêle deux moteurs zigzague de l'un à l'autre et ne
  // décrit aucune voiture réelle : une courbe par motorisation, ou aucune.
  const trends = useMemo(() => {
    if (version !== ALL || !several) {
      return analysis ? [{ version: null, points: analysis.trend }] : [];
    }
    if (shownColor !== 'version') return [];
    return versionOrder.slice(0, 6).map((name) => ({
      version: name,
      points: analyze(kept.filter((ad) => (ad.version ?? UNKNOWN) === name))?.trend ?? [],
    }));
  }, [version, several, shownColor, versionOrder, kept, analysis]);

  const target = useMemo(() => {
    const kmValue = Number(km.replace(/\D/g, '')) || null;
    const yearValue = Number(year) >= 1900 ? Number(year) : null;
    if (kmValue === null && yearValue === null) return null;
    return { km: kmValue, year: yearValue, version: version === ALL || version === UNKNOWN ? null : version };
  }, [km, year, version]);

  const valuation = useMemo(() => (target ? estimate(target, kept) : null), [target, kept]);

  async function refresh() {
    setRefreshing(true);
    await fetch(`/api/estimations/${id}`, { method: 'POST' });
    await reload();
    setRefreshing(false);
  }

  async function remove() {
    if (!confirm('Supprimer cette estimation ?')) return;
    await fetch(`/api/estimations/${id}`, { method: 'DELETE' });
    router.push('/marche');
  }

  if (loading) {
    return <div className="mt-4 h-80 animate-pulse rounded-2xl border border-ink-line bg-ink-soft" />;
  }
  if (!data) {
    return (
      <p className="mt-8 text-center text-sm text-zinc-500">
        {error === 'Erreur 404' ? 'Estimation introuvable.' : error}{' '}
        <Link href="/marche" className="text-accent">
          Retour
        </Link>
      </p>
    );
  }

  const { estimation } = data;

  return (
    <>
      <header className="pb-3 pt-1">
        <Link href="/marche" className="text-[13px] text-accent">
          ‹ Marché
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {estimation.brand} {estimation.model}
        </h1>
        <p className="text-xs text-zinc-500">
          {criteriaLabel(estimation)}
          {estimation.collectedAt && ` · relevé ${relativeTime(estimation.collectedAt)}`}
        </p>
      </header>

      {collecting && (
        <CollectProgress
          label={`${estimation.brand} ${estimation.model}`}
          status={status === 'queued' ? 'queued' : 'running'}
          pages={estimation.pages}
          ads={estimation.ads}
          activity={estimation.activity}
        />
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
              ? `Seulement ${ads.length} annonce${ads.length > 1 ? 's' : ''} exploitable${ads.length > 1 ? 's' : ''} : trop peu pour une cote.`
              : 'Aucune annonce trouvée pour ce modèle. Vérifie l’orthographe de la marque et du modèle.'}
          </div>
        )
      ) : (
        <>
          <section className="rounded-2xl border border-ink-line bg-ink-soft p-4">
            <label className="block">
              <span className="sr-only">Motorisation</span>
              <select
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                className="w-full rounded-xl border border-ink-line bg-ink px-3 py-2.5 text-[14px] text-zinc-100 focus:border-accent focus:outline-none"
              >
                <option value={ALL}>Toutes motorisations ({overall.count})</option>
                {overall.versions.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name} ({item.count})
                  </option>
                ))}
              </select>
            </label>

            {gearboxes.length > 1 && (
              <label className="mt-2 block">
                <span className="sr-only">Boîte</span>
                <select
                  value={gearbox}
                  onChange={(event) => setGearbox(event.target.value)}
                  className="w-full rounded-xl border border-ink-line bg-ink px-3 py-2.5 text-[14px] text-zinc-100 focus:border-accent focus:outline-none"
                >
                  <option value={ALL}>Toutes boîtes</option>
                  {gearboxes.map(([name, count]) => (
                    <option key={name} value={name}>
                      {name} ({count})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {analysis ? (
              <>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-zinc-600">
                      Prix médian{version === ALL && several ? ', tous moteurs' : ''}
                    </div>
                    <div className="text-3xl font-semibold tracking-tight text-white">
                      {formatPrice(analysis.median)}
                    </div>
                  </div>
                  <div className="pb-1 text-right text-[12px] text-zinc-400">
                    moitié entre
                    <br />
                    <span className="text-zinc-200">
                      {formatPrice(analysis.p25)} et {formatPrice(analysis.p75)}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-zinc-600">
                  {analysis.count} annonces
                  {overall.excluded > 0 &&
                    version === ALL &&
                    gearbox === ALL &&
                    ` · ${overall.excluded} écartée${overall.excluded > 1 ? 's' : ''} (prix aberrants)`}
                  {risky.length > 0 &&
                    ` · ${risky.length} à risque hors calculs (volant à droite, accident, panne)`}
                </p>

                {version === ALL && several && (
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
                    Couleur
                    <div className="flex rounded-lg border border-ink-line p-0.5">
                      {(['version', 'year'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setColorBy(mode)}
                          className={`rounded-md px-2.5 py-1 outline-none ${
                            colorBy === mode ? 'bg-ink-line text-zinc-100' : 'text-zinc-500'
                          }`}
                        >
                          {mode === 'version' ? 'Motorisation' : 'Année'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 -mx-1">
                  <PriceKmChart
                    points={shown}
                    trends={trends}
                    colorBy={shownColor}
                    versionOrder={versionOrder}
                    onPickVersion={setVersion}
                    target={
                      valuation && target?.km !== null && target?.km !== undefined
                        ? { km: target.km, price: valuation.median }
                        : null
                    }
                  />
                </div>
              </>
            ) : (
              <p className="mt-4 text-[13px] text-zinc-500">
                Trop peu d’annonces pour cette motorisation : {filtered.length}.
              </p>
            )}
          </section>

          <section className="mt-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
            <h2 className="text-[15px] font-medium text-zinc-100">Ta voiture</h2>
            <p className="mb-3 text-[11px] text-zinc-500">
              Sa valeur d’après les annonces qui lui ressemblent le plus
              {[version !== ALL && version !== UNKNOWN ? version : null, gearbox !== ALL ? gearbox : null]
                .filter(Boolean)
                .map((part) => ` · ${part}`)
                .join('')}
              .
            </p>
            <div className="grid grid-cols-2 gap-3">
              <input
                value={year}
                onChange={(event) => setYear(event.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                placeholder="Année"
                className={INPUT}
              />
              <input
                value={km}
                onChange={(event) => setKm(formatKm(event.target.value))}
                inputMode="numeric"
                placeholder="Kilométrage"
                className={INPUT}
              />
            </div>

            {target &&
              (valuation ? (
                <div className="mt-4">
                  <div className="text-3xl font-semibold tracking-tight text-white">
                    {formatPrice(valuation.median)}
                  </div>
                  <div className="text-[12px] text-zinc-400">
                    entre {formatPrice(valuation.p25)} et {formatPrice(valuation.p75)}
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-600">
                    {valuation.count} voitures comparables : ±{valuation.tolerance.years} an
                    {valuation.tolerance.years > 1 ? 's' : ''}
                    {valuation.tolerance.km > 0 &&
                      `, ±${valuation.tolerance.km.toLocaleString('fr-FR')} km`}
                    {valuation.tolerance.sameVersion ? ', même motorisation' : ', toutes motorisations'}.
                  </p>
                  <ul className="mt-3 divide-y divide-ink-line">
                    {valuation.comparables.slice(0, 5).map((ad) => (
                      <AdRow key={ad.lbcId} ad={ad} />
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-3 text-[12px] text-zinc-500">
                  Pas assez de voitures comparables pour chiffrer celle-ci, même en élargissant.
                </p>
              ))}
          </section>

          {analysis && analysis.deals.length > 0 && (
            <section className="mt-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
              <h2 className="text-[15px] font-medium text-zinc-100">Sous leurs comparables</h2>
              <p className="mb-2 text-[11px] text-zinc-500">
                Au moins 15 % moins chères que des voitures d’années et kilométrages proches. Souvent
                pour une raison : à vérifier.
              </p>
              <ul className="divide-y divide-ink-line">
                {analysis.deals.map((deal) => (
                  <AdRow
                    key={deal.lbcId}
                    ad={deal}
                    note={`${Math.round(deal.ratio * 100)} % sous ${formatPrice(deal.reference)}`}
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
        <button
          onClick={remove}
          className="rounded-xl border border-ink-line bg-ink-soft px-4 py-2.5 text-[14px] text-zinc-500"
        >
          Supprimer
        </button>
      </div>

      <p className="mt-4 px-1 text-[11px] leading-relaxed text-zinc-600">
        Ce sont des prix demandés, pas des prix de vente : une voiture se négocie souvent un peu
        sous son annonce. L’état, l’historique et les options comptent autant que les chiffres.
      </p>
    </>
  );
}

function withGearbox(list: Ad[], gearbox: string): Ad[] {
  return gearbox === ALL ? list : list.filter((ad) => ad.gearbox === gearbox);
}

function withVersion(list: Ad[], version: string): Ad[] {
  return version === ALL ? list : list.filter((ad) => (ad.version ?? UNKNOWN) === version);
}

const INPUT =
  'w-full rounded-xl border border-ink-line bg-ink px-3 py-2.5 text-[15px] text-zinc-100 placeholder:text-zinc-600 focus:border-accent focus:outline-none';

function formatKm(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 7);
  return digits ? Number(digits).toLocaleString('fr-FR') : '';
}

function AdRow({ ad, note }: { ad: Ad; note?: string }) {
  return (
    <li>
      <a
        href={ad.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between gap-3 py-2.5"
      >
        <div className="min-w-0">
          <div className="truncate text-[13px] text-zinc-200">{ad.title}</div>
          <div className="truncate text-[11px] text-zinc-500">
            {[
              ad.year,
              ad.km !== null ? `${ad.km.toLocaleString('fr-FR')} km` : null,
              ad.version ? `${ad.version}${ad.versionGuessed ? ' (titre)' : ''}` : null,
              ad.gearbox,
              ad.location,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[13px] font-medium text-white">{formatPrice(ad.price)}</div>
          {note && <div className="text-[11px] text-down">{note}</div>}
        </div>
      </a>
    </li>
  );
}
