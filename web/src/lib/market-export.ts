/**
 * Export d'une estimation en CSV, pour l'analyser ailleurs (ChatGPT, tableur).
 *
 * Deux fichiers :
 * - les annonces, une ligne chacune, avec tout ce que la base en connaît et ce
 *   que l'application en déduit (comparables, écart, baisses, durée en ligne) ;
 * - la synthèse, par motorisation et par boîte.
 *
 * Toutes les annonces partent, y compris celles que les calculs écartent : une
 * colonne dit pourquoi. Mieux vaut que l'outil d'analyse voie tout et sache ce
 * qui a été mis de côté que de travailler sur un tri qu'il ignore.
 *
 * Séparateur « ; » et marque d'ordre des octets : un tableur français ouvre le
 * fichier tel quel, et les outils d'analyse le lisent sans réglage.
 */
import { engineOf, estimate, plausible, powerFrom, quantile, screen, SUSPICIOUS_FLAG, type Ad } from './estimation';
import { signalsFor, type GoneAd } from './signals';
import type { MarketAd, MarketQuery } from './types';

const DAY = 24 * 60 * 60 * 1000;
const DEAL_RATIO = 0.15;

/**
 * Caractéristiques déjà exportées dans des colonnes dédiées, sous une forme
 * plus lisible : inutile de les répéter brutes.
 */
const DEDICATED = new Set(['u_car_brand', 'u_car_model', 'u_car_version', 'regdate', 'mileage', 'fuel', 'gearbox']);

type Row = Record<string, string | number | null>;

export function exportFilename(query: Pick<MarketQuery, 'brand' | 'model' | 'yearMin' | 'yearMax'>, kind: string, now: Date): string {
  const years = query.yearMin || query.yearMax ? `-${query.yearMin ?? ''}-${query.yearMax ?? ''}` : '';
  const slug = `${query.brand}-${query.model}${years}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `cote-${slug}-${kind}-${now.toISOString().slice(0, 10)}.csv`;
}

// ---------------------------------------------------------------------------
// Annonces
// ---------------------------------------------------------------------------

export function adsCsv(docs: MarketAd[], now = new Date(), gone: GoneAd[] = []): string {
  const raw = docs.map(toExportAd);
  const ads = screen(raw);
  const { kept } = plausible(ads);
  const keptIds = new Set(kept.map((ad) => ad.lbcId));
  const byId = new Map(docs.map((doc) => [doc.lbcId, doc]));

  // Les caractéristiques publiées varient d'une annonce à l'autre : une
  // colonne par caractéristique rencontrée, son libellé lisible de préférence.
  const attributeKeys = [
    ...new Set(
      docs.flatMap((doc) => Object.keys(doc.attributes ?? {}).map((key) => key.replace(/_label$/, ''))),
    ),
  ]
    .filter((key) => !DEDICATED.has(key))
    .sort();

  const rows: Row[] = ads.map((ad) => {
    const doc = byId.get(ad.lbcId)!;
    const status = ad.flags?.length
      ? `à risque : ${ad.flags.join(', ')}`
      : keptIds.has(ad.lbcId)
        ? 'retenue'
        : 'écartée : prix hors de la fourchette du modèle';

    const peers =
      ad.km !== null && ad.year !== null ? estimate(ad, kept, ad.lbcId) : null;
    const gap = peers ? (ad.price - peers.median) / peers.median : null;

    const history = [...(doc.priceHistory ?? [])]
      .map((step) => ({ price: step.price, at: new Date(step.at) }))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const drops = history.filter((step, index) => index > 0 && step.price < history[index - 1].price);
    const initial = history[0]?.price ?? doc.price;

    const online = doc.publishedAt ?? doc.firstSeenAt ?? null;
    const daysOnline = online ? Math.max(0, Math.floor((now.getTime() - new Date(online).getTime()) / DAY)) : null;
    const age = ad.year !== null ? Math.max(1, now.getFullYear() - ad.year) : null;
    const zip = doc.location?.match(/\b(\d{5})\b/)?.[1] ?? null;
    const { automatic } = engineOf(doc.version);

    const row: Row = {
      id_annonce: ad.lbcId,
      lien: ad.url,
      titre: ad.title,
      statut: status,
      prix_eur: ad.price,
      prix_initial_eur: initial,
      nb_baisses: drops.length,
      baisse_totale_eur: initial - ad.price > 0 ? initial - ad.price : 0,
      derniere_baisse_le: drops.length ? day(drops[drops.length - 1].at) : null,
      historique_prix: history.map((step) => `${day(step.at)} ${step.price}`).join(' > ') || null,
      annee: ad.year,
      kilometrage_km: ad.km,
      km_par_an: ad.km !== null && age ? Math.round(ad.km / age) : null,
      motorisation: ad.version,
      puissance_ch: ad.power ?? null,
      motorisation_deduite_du_titre: ad.versionGuessed ? 'oui' : ad.version ? 'non' : null,
      version_publiee: doc.version ?? null,
      boite: ad.gearbox ?? (automatic ? 'Automatique' : null),
      carburant: doc.fuel ?? null,
      marque_code: doc.brandCode ?? null,
      modele_code: doc.modelCode ?? null,
      vendeur: doc.sellerType === 'pro' ? 'professionnel' : doc.sellerType === 'private' ? 'particulier' : null,
      localisation: doc.location ?? null,
      code_postal: zip,
      departement: zip ? (zip.startsWith('97') ? zip.slice(0, 3) : zip.slice(0, 2)) : null,
      latitude: doc.lat ?? null,
      longitude: doc.lng ?? null,
      mise_en_ligne: online ? day(new Date(online)) : null,
      mise_en_ligne_source: doc.publishedAt ? 'leboncoin' : online ? 'première fois vue' : null,
      jours_en_ligne: daysOnline,
      premiere_vue: doc.firstSeenAt ? day(new Date(doc.firstSeenAt)) : null,
      derniere_vue: doc.lastSeenAt ? day(new Date(doc.lastSeenAt)) : null,
      comparables_nb: peers?.count ?? null,
      comparables_mediane_eur: peers?.median ?? null,
      comparables_p25_eur: peers?.p25 ?? null,
      comparables_p75_eur: peers?.p75 ?? null,
      comparables_criteres: peers
        ? [
            peers.tolerance.sameVersion ? 'même motorisation' : 'toutes motorisations',
            `±${peers.tolerance.years} an${peers.tolerance.years > 1 ? 's' : ''}`,
            peers.tolerance.km ? `±${peers.tolerance.km} km` : null,
          ]
            .filter(Boolean)
            .join(', ')
        : null,
      ecart_vs_comparables_pct: gap !== null ? round1(gap * 100) : null,
      affaire:
        gap !== null && peers?.tolerance.sameVersion && gap <= -DEAL_RATIO && !ad.flags?.length
          ? 'oui'
          : gap !== null && peers?.tolerance.sameVersion && gap <= -DEAL_RATIO && ad.flags?.join() === SUSPICIOUS_FLAG
            ? 'oui, prix suspect'
            : 'non',
      signaux:
        signalsFor(
          { ...ad, description: doc.description ?? null, firstSeenAt: doc.firstSeenAt },
          { median: peers?.median ?? null, gone, live: ads, now },
        )
          .map((signal) => `${signal.level === 'positive' ? '+' : '!'} ${signal.label} : ${signal.detail}`)
          .join(' | ') || null,
      photo: doc.imageUrl ?? null,
    };

    for (const key of attributeKeys) {
      const attributes = doc.attributes ?? {};
      row[`lbc_${key}`] = attributes[`${key}_label`] ?? attributes[key] ?? null;
    }
    row.description = doc.description ?? null;
    return row;
  });

  // Les plus intéressantes d'abord : celles qui sont sous leurs comparables.
  rows.sort((a, b) => numberOr(a.ecart_vs_comparables_pct, 1e9) - numberOr(b.ecart_vs_comparables_pct, 1e9));
  return toCsv(rows);
}

// ---------------------------------------------------------------------------
// Synthèse
// ---------------------------------------------------------------------------

export function summaryCsv(docs: MarketAd[], now = new Date()): string {
  const ads = screen(docs.map(toExportAd));
  const { kept } = plausible(ads);
  const risky = ads.filter((ad) => ad.flags?.length);
  const engine = (ad: Ad) => ad.version ?? 'Non précisée';
  const gearbox = (ad: Ad) => ad.gearbox ?? 'Non précisée';

  const groups: { motorisation: string; boite: string; pick: (ad: Ad) => boolean }[] = [
    { motorisation: 'Toutes', boite: 'Toutes', pick: () => true },
  ];
  const engines = [...new Set(kept.map(engine))].sort((a, b) => count(kept, b, engine) - count(kept, a, engine));
  for (const name of engines) {
    groups.push({ motorisation: name, boite: 'Toutes', pick: (ad) => engine(ad) === name });
    const boxes = [...new Set(kept.filter((ad) => engine(ad) === name).map(gearbox))];
    if (boxes.length > 1) {
      for (const box of boxes.sort()) {
        groups.push({ motorisation: name, boite: box, pick: (ad) => engine(ad) === name && gearbox(ad) === box });
      }
    }
  }

  const rows: Row[] = groups
    .map((group) => {
      const inside = kept.filter(group.pick);
      if (!inside.length) return null;
      const prices = inside.map((ad) => ad.price).sort((a, b) => a - b);
      const kms = inside.map((ad) => ad.km).filter((km): km is number => km !== null).sort((a, b) => a - b);
      const years = inside.map((ad) => ad.year).filter((year): year is number => year !== null).sort((a, b) => a - b);
      const ages = inside
        .map((ad) => (ad.onlineSince ? (now.getTime() - new Date(ad.onlineSince).getTime()) / DAY : null))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      const pros = docs.filter((doc) => inside.some((ad) => ad.lbcId === doc.lbcId) && doc.sellerType === 'pro').length;
      return {
        motorisation: group.motorisation,
        boite: group.boite,
        annonces_retenues: inside.length,
        annonces_a_risque: risky.filter(group.pick).length,
        prix_median_eur: quantile(prices, 0.5),
        prix_p25_eur: quantile(prices, 0.25),
        prix_p75_eur: quantile(prices, 0.75),
        prix_min_eur: prices[0],
        prix_max_eur: prices[prices.length - 1],
        km_median: kms.length ? quantile(kms, 0.5) : null,
        km_min: kms[0] ?? null,
        km_max: kms.length ? kms[kms.length - 1] : null,
        annee_min: years[0] ?? null,
        annee_mediane: years.length ? quantile(years, 0.5) : null,
        annee_max: years.length ? years[years.length - 1] : null,
        jours_en_ligne_median: ages.length ? Math.round(quantile(ages, 0.5)) : null,
        part_vendeurs_pro_pct: round1((pros / inside.length) * 100),
        decote_pour_10000_km_eur: slopePer10k(inside),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return toCsv(rows);
}

/**
 * Ce que coûtent 10 000 km de plus, toutes choses égales par ailleurs autant
 * qu'une droite le permet : la pente prix / km par moindres carrés.
 */
function slopePer10k(ads: Ad[]): number | null {
  const points = ads.filter((ad) => ad.km !== null) as (Ad & { km: number })[];
  if (points.length < 8) return null;
  const meanKm = points.reduce((sum, ad) => sum + ad.km, 0) / points.length;
  const meanPrice = points.reduce((sum, ad) => sum + ad.price, 0) / points.length;
  let covariance = 0;
  let variance = 0;
  for (const ad of points) {
    covariance += (ad.km - meanKm) * (ad.price - meanPrice);
    variance += (ad.km - meanKm) ** 2;
  }
  return variance ? Math.round((covariance / variance) * 10_000) : null;
}

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

function toExportAd(doc: MarketAd): Ad {
  return {
    lbcId: doc.lbcId,
    title: doc.title,
    url: doc.url,
    price: doc.price,
    km: doc.km ?? null,
    year: doc.year ?? null,
    version: doc.version ?? null,
    location: doc.location ?? null,
    imageUrl: doc.imageUrl ?? null,
    sellerType: doc.sellerType ?? null,
    gearbox: doc.gearbox ?? null,
    fuel: doc.fuel ?? null,
    onlineSince: doc.publishedAt ?? doc.firstSeenAt ?? null,
    power: doc.power ?? powerFrom(doc.attributes, doc.version, doc.title),
  };
}

function count(ads: Ad[], name: string, engine: (ad: Ad) => string): number {
  return ads.filter((ad) => engine(ad) === name).length;
}

function numberOr(value: string | number | null, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Un tableau d'objets en CSV, colonnes dans l'ordre où elles apparaissent. */
export function toCsv(rows: Row[]): string {
  const columns: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  const lines = [columns.join(';'), ...rows.map((row) => columns.map((column) => cell(row[column])).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\r?\n+/g, ' ').trim();
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
