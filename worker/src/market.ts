import type { Browser, Page } from 'playwright';
import { LBC_ORIGIN } from './config.js';
import { ingestMarketAds, updateMarketQuery, type ScrapedListing } from './api.js';
import { connectToChrome, mainContext } from './browser.js';
import { collectListings } from './scrape.js';

/** Ce qu'on cherche : un modèle, éventuellement une tranche d'années. */
export interface MarketSpec {
  queryId: string;
  brand: string;
  model: string;
  yearMin: number | null;
  yearMax: number | null;
  /** Codes du site pour ce modèle, s'ils ont déjà été établis. */
  codes: { brand: string; model: string } | null;
}

/** Au-delà, une recherche couvre déjà plusieurs centaines d'annonces. */
const MAX_PAGES = 20;

/**
 * Vingt pages à six secondes près tiennent en quatre minutes. Au double, la
 * collecte est bloquée — page qui ne répond plus, vérification anti-robot —
 * et doit le dire plutôt que laisser l'application attendre sans fin.
 */
const JOB_TIMEOUT_MS = 8 * 60 * 1000;

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
  await updateMarketQuery(spec.queryId, { status: 'running', pages: 0, ads: 0 });

  log(`[marché] ${label} : ouverture de la recherche`);

  // Fermer l'onglet interrompt toute action en cours dessus : c'est le seul
  // moyen sûr de débloquer une navigation qui ne rend jamais la main.
  let browser: Browser | null = null;
  let page: Page | null = null;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void page?.close().catch(() => undefined);
  }, JOB_TIMEOUT_MS);

  // La connexion au navigateur est dans le bloc surveillé : un Chrome fermé
  // doit se lire comme un échec dans l'application, pas comme une collecte
  // qui n'avance plus.
  try {
    browser = await connectToChrome();
    page = await mainContext(browser).newPage();

    let codes = spec.codes;
    let first = await collectListings(page, searchUrl(spec, codes, 1));

    if (!codes) {
      codes = resolveCodes(first, spec.model);
      if (codes) {
        log(`[marché] ${label} : codes du site ${codes.brand} / ${codes.model}`);
        await pause();
        first = await collectListings(page, searchUrl(spec, codes, 1));
      } else {
        log(`[marché] ${label} : codes introuvables, recherche libre`);
      }
    }

    const all = new Map<string, ScrapedListing>();
    add(all, first);
    await updateMarketQuery(spec.queryId, { pages: 1, ads: all.size, codes });

    for (let number = 2; number <= MAX_PAGES; number += 1) {
      await pause();
      const before = all.size;
      add(all, await collectListings(page, searchUrl(spec, codes, number)));
      const gained = all.size - before;
      log(`[marché] ${label} : page ${number}, ${gained} nouvelles (${all.size} au total)`);
      await updateMarketQuery(spec.queryId, { pages: number, ads: all.size });
      // Une page sans rien de neuf : on a fait le tour.
      if (gained === 0) break;
    }

    const kept = [...all.values()].filter((ad) => belongs(ad, spec, codes));
    for (let i = 0; i < kept.length; i += 200) {
      await ingestMarketAds(spec.queryId, kept.slice(i, i + 200));
    }

    await updateMarketQuery(spec.queryId, { status: 'done', ads: kept.length });
    log(`[marché] ${label} : ${kept.length} annonces retenues sur ${all.size} vues`);
  } catch (cause) {
    const message = timedOut
      ? `Collecte interrompue après ${JOB_TIMEOUT_MS / 60_000} minutes sans aboutir. Vérifie la fenêtre Chrome dédiée (vérification anti-robot ?) puis relance.`
      : cause instanceof Error
        ? cause.message
        : String(cause);
    log(`[marché] ${label} : échec — ${message}`);
    await updateMarketQuery(spec.queryId, { status: 'error', error: message.slice(0, 500) }).catch(
      () => undefined,
    );
  } finally {
    clearTimeout(deadline);
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

function searchUrl(
  spec: MarketSpec,
  codes: { brand: string; model: string } | null,
  page: number,
): string {
  const params = new URLSearchParams({ category: '2' });
  if (codes) {
    params.set('u_car_brand', codes.brand);
    params.set('u_car_model', codes.model);
  } else {
    params.set('text', `${spec.brand} ${spec.model}`.trim());
  }
  if (spec.yearMin || spec.yearMax) {
    params.set('regdate', `${spec.yearMin ?? 'min'}-${spec.yearMax ?? 'max'}`);
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
  const code = ad.attributes?.u_car_model;
  if (codes && code) return code === codes.model;
  // Sans code, le titre fait foi : tous les mots du modèle doivent y figurer.
  const title = normalize(ad.title);
  return normalize(spec.model)
    .split(' ')
    .filter(Boolean)
    .every((word) => title.includes(word));
}

function add(target: Map<string, ScrapedListing>, ads: ScrapedListing[]): void {
  for (const ad of ads) target.set(ad.lbcId, ad);
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Une pause irrégulière entre deux pages, comme le ferait quelqu'un qui lit. */
function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 3000 + Math.random() * 3000));
}

