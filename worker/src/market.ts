import { LBC_ORIGIN } from './config.js';
import { ingestMarketAds, updateMarketQuery, type ScrapedListing } from './api.js';
import { pause, runCollection, type Recent } from './collect.js';
import { collectListings } from './scrape.js';

/** Ce qu'on cherche : un modèle, éventuellement une tranche d'années. */
export interface MarketSpec {
  queryId: string;
  /** Envoi de l'application que cette collecte sert. */
  runId?: string;
  brand: string;
  model: string;
  yearMin: number | null;
  yearMax: number | null;
  /** Puissance DIN en chevaux, pour isoler une motorisation dans un modèle très diffusé. */
  powerMin: number | null;
  powerMax: number | null;
  /** Codes du site pour ce modèle, s'ils ont déjà été établis. */
  codes: { brand: string; model: string } | null;
  /**
   * « full » relit tout le modèle ; « fresh » ne lit que les annonces les plus
   * récentes, pour repérer vite une nouvelle affaire sans tout reparcourir.
   */
  mode?: 'full' | 'fresh';
}

/** Les plus récentes tiennent sur deux pages entre deux passages d'une veille. */
const FRESH_PAGES = 2;

/**
 * Relève toutes les annonces d'un modèle.
 *
 * Première page en recherche libre (« boxster »), qui ramène des annonces
 * portant les codes internes du site pour la marque et le modèle. Dès qu'on
 * les connaît, on repart avec ces filtres exacts : la recherche libre manque
 * les annonces qui ne citent pas le nom, et en ramène d'autres qui le citent
 * en passant. Puis on tourne les pages jusqu'à ce qu'elles n'apportent plus
 * rien.
 */
export async function runMarketJob(spec: MarketSpec, log: (message: string) => void): Promise<void> {
  const label = `${spec.brand} ${spec.model}`.trim();
  const mode = spec.mode ?? 'full';
  let codes = spec.codes;

  await runCollection(
    {
      tag: `[marché] ${label}${mode === 'fresh' ? ' (nouveautés)' : ''}`,
      start: { mode },
      maxPages: mode === 'fresh' ? FRESH_PAGES : undefined,
      report: (patch) => updateMarketQuery(spec.queryId, { runId: spec.runId, ...patch }),

      async open(page, say) {
        await say(codes ? `Recherche des ${label} sur leboncoin` : `Recherche de « ${label} » sur leboncoin`);
        let first = await collectListings(page, searchUrl(spec, codes, 1, mode));

        if (!codes) {
          codes = resolveCodes(first, spec.model);
          if (codes) {
            log(`[marché] ${label} : codes du site ${codes.brand} / ${codes.model}`);
            await say(`Modèle identifié chez leboncoin : on relance une recherche précise`, {
              recent: preview(first),
            });
            await pause();
            first = await collectListings(page, searchUrl(spec, codes, 1, mode));
          } else {
            log(`[marché] ${label} : codes introuvables, recherche libre`);
          }
        }
        return { ads: first, learned: { codes } };
      },

      pageUrl: (number) => searchUrl(spec, codes, number, mode),
      preview,

      async keep(ads, say) {
        const kept = ads.filter((ad) => belongs(ad, spec, codes));
        await say(`Tri de ${ads.length} annonces : ${kept.length} sont bien des ${label}`);
        for (let i = 0; i < kept.length; i += 200) {
          await ingestMarketAds(spec.queryId, kept.slice(i, i + 200));
        }
        return kept.length;
      },
    },
    log,
  );
}

function searchUrl(
  spec: MarketSpec,
  codes: { brand: string; model: string } | null,
  page: number,
  mode: 'full' | 'fresh',
): string {
  const params = new URLSearchParams({ category: '2' });
  // Un relevé frais veut les dernières arrivées en tête, quel que soit le tri
  // que le site propose par défaut.
  if (mode === 'fresh') {
    params.set('sort', 'time');
    params.set('order', 'desc');
  }
  if (codes) {
    params.set('u_car_brand', codes.brand);
    params.set('u_car_model', codes.model);
  } else {
    params.set('text', `${spec.brand} ${spec.model}`.trim());
  }
  if (spec.yearMin || spec.yearMax) {
    params.set('regdate', `${spec.yearMin ?? 'min'}-${spec.yearMax ?? 'max'}`);
  }
  if (spec.powerMin || spec.powerMax) {
    params.set('horse_power_din', `${spec.powerMin ?? 'min'}-${spec.powerMax ?? 'max'}`);
  }
  if (page > 1) params.set('page', String(page));
  return `${LBC_ORIGIN}/recherche?${params.toString()}`;
}

/**
 * Déduit les codes internes du modèle des annonces de la première page :
 * le couple le plus fréquent parmi celles dont le titre cite bien le modèle.
 */
function resolveCodes(
  ads: ScrapedListing[],
  model: string,
): { brand: string; model: string } | null {
  const wanted = normalize(model);
  const counts = new Map<string, number>();

  for (const ad of ads) {
    const brand = ad.attributes?.u_car_brand;
    const code = ad.attributes?.u_car_model;
    if (!brand || !code) continue;
    if (!normalize(ad.title).includes(wanted) && !normalize(code).includes(wanted)) continue;
    const key = `${brand}\u0000${code}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!best || best[1] < 2) return null;
  const [brand, code] = best[0].split('\u0000');
  return { brand, model: code };
}

/** L'annonce relève-t-elle bien du modèle demandé ? */
function belongs(
  ad: ScrapedListing,
  spec: MarketSpec,
  codes: { brand: string; model: string } | null,
): boolean {
  if (ad.price === null) return false;
  if (!withinPower(ad, spec)) return false;
  const code = ad.attributes?.u_car_model;
  if (codes && code) return code === codes.model;
  // Sans code, le titre fait foi : tous les mots du modèle doivent y figurer.
  const title = normalize(ad.title);
  return normalize(spec.model)
    .split(' ')
    .filter(Boolean)
    .every((word) => title.includes(word));
}

/**
 * La puissance publiée tient-elle dans la fourchette demandée ? Le site filtre
 * déjà la recherche ; on revérifie ce qu'il rend, sans écarter une annonce
 * muette sur sa puissance.
 */
function withinPower(ad: ScrapedListing, spec: MarketSpec): boolean {
  const power = wholeNumber(ad.attributes?.horse_power_din);
  if (power === null) return true;
  if (spec.powerMin !== null && power < spec.powerMin) return false;
  if (spec.powerMax !== null && power > spec.powerMax) return false;
  return true;
}

/**
 * Ce que l'application montre pendant la collecte : les dernières annonces
 * lues, pour qu'on voie le travail avancer plutôt qu'un compteur.
 */
function preview(ads: ScrapedListing[]): Recent[] {
  return ads
    .filter((ad) => ad.price !== null)
    .slice(0, 8)
    .map((ad) => ({
      title: ad.title.slice(0, 120),
      price: ad.price as number,
      km: wholeNumber(ad.attributes?.mileage ?? ad.attributes?.kilometrage),
      year: wholeNumber(ad.attributes?.regdate ?? ad.attributes?.annee),
      imageUrl: ad.imageUrl ?? null,
      location: ad.location ?? null,
    }));
}

function wholeNumber(value?: string): number | null {
  const digits = value?.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

