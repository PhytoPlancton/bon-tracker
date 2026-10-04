import type { Browser, Page } from 'playwright';
import type { ScrapedListing } from './api.js';
import { connectToChrome, mainContext } from './browser.js';
import { collectListings } from './scrape.js';

/** Au-delà, une recherche couvre déjà plusieurs centaines d'annonces. */
export const MAX_PAGES = 20;

/**
 * Une page de résultats se lit en une demi-minute environ, pause comprise.
 * Sans nouvelle page depuis ce délai, la collecte est bloquée — page qui ne
 * répond plus, vérification anti-robot — et doit le dire plutôt que laisser
 * l'application attendre sans fin. Un plafond sur la durée totale coupait au
 * contraire une collecte longue mais saine : seize pages lues, rien gardé.
 */
const STALL_TIMEOUT_MS = 3 * 60 * 1000;

/** Annonce montrée sur l'écran d'attente : ce qui la situe d'un coup d'œil. */
export interface Recent {
  title: string;
  price: number;
  imageUrl: string | null;
  location: string | null;
  km?: number | null;
  year?: number | null;
  surface?: number | null;
  rooms?: number | null;
}

/** Remonte une étape à l'écran d'attente. */
export type Say = (step: string, extra?: { recent?: Recent[]; total?: number | null }) => Promise<unknown>;

/**
 * Ce qu'une collecte a de propre à son domaine — voitures ou immobilier :
 * comment ouvrir la recherche, tourner les pages, et quelles annonces garder.
 * Le reste est commun et vit ici.
 */
export interface CollectPlan {
  /** « [marché] Porsche Boxster », en tête de chaque ligne du journal. */
  tag: string;
  /** Remonte l'avancement ; `stop` dit que l'application a demandé l'arrêt. */
  report(patch: Record<string, unknown>): Promise<{ stop?: boolean }>;
  /**
   * Ouvre la recherche et lit sa première page. Ce qu'elle a appris en chemin
   * (codes d'un modèle, forme d'un lieu) est remonté avec la page 1.
   */
  open(page: Page, say: Say): Promise<{ ads: ScrapedListing[]; learned?: Record<string, unknown> }>;
  /** Adresse de la page n, une fois la recherche établie. */
  pageUrl(number: number): string;
  /** Les dernières annonces lues, pour l'écran d'attente. */
  preview(ads: ScrapedListing[]): Recent[];
  /** Trie les annonces lues, verse celles à garder, et dit combien. */
  keep(ads: ScrapedListing[], say: Say): Promise<number>;
}

/** L'application a demandé l'arrêt : on garde ce qui a été lu. */
class StopRequested extends Error {}

/**
 * Mène une collecte paginée de bout en bout : première page, pages suivantes
 * jusqu'à ce qu'elles n'apportent plus rien, tri, versement.
 *
 * Un arrêt demandé ou un blocage en cours de route ne perd pas ce qui a déjà
 * été lu : des centaines d'annonces valent mieux qu'un échec.
 */
export async function runCollection(plan: CollectPlan, log: (message: string) => void): Promise<void> {
  const start = await plan.report({ status: 'running', pages: 0, ads: 0 });
  // Annulée pendant qu'elle attendait son tour : rien à faire.
  if (start.stop) {
    log(`${plan.tag} : annulée avant de commencer`);
    return;
  }

  log(`${plan.tag} : ouverture de la recherche`);
  const say: Say = (step, extra = {}) =>
    plan.report({ activity: { step, recent: [], total: null, ...extra } }).catch(() => undefined);
  let total: number | null = null;
  await say('Connexion au navigateur');

  // Fermer l'onglet interrompt toute action en cours dessus : c'est le seul
  // moyen sûr de débloquer une navigation qui ne rend jamais la main.
  let browser: Browser | null = null;
  let page: Page | null = null;
  let timedOut = false;
  let deadline: NodeJS.Timeout | undefined;
  const watch = () => {
    clearTimeout(deadline);
    deadline = setTimeout(() => {
      timedOut = true;
      void page?.close().catch(() => undefined);
    }, STALL_TIMEOUT_MS);
  };
  watch();

  const all = new Map<string, ScrapedListing>();
  let pagesRead = 0;

  const finish = async () => {
    const kept = await plan.keep([...all.values()], (step, extra) => say(step, { total, ...extra }));
    await plan.report({ status: 'done', ads: kept });
    log(`${plan.tag} : ${kept} annonces retenues sur ${all.size} vues`);
  };

  // La connexion au navigateur est dans le bloc surveillé : un Chrome fermé
  // doit se lire comme un échec dans l'application, pas comme une collecte
  // qui n'avance plus.
  try {
    browser = await connectToChrome(log);
    page = await mainContext(browser).newPage();

    const opened = await plan.open(page, say);
    total = await readTotal(page, opened.ads.length);

    add(all, opened.ads);
    pagesRead = 1;
    watch();
    const firstReport = await plan.report({
      pages: 1,
      ads: all.size,
      ...(opened.learned ?? {}),
      activity: { step: `Page 1 lue · ${opened.ads.length} annonces`, recent: plan.preview(opened.ads), total },
    });
    if (firstReport.stop) throw new StopRequested();

    for (let number = 2; number <= MAX_PAGES; number += 1) {
      await pause();
      const before = all.size;
      const found = await collectListings(page, plan.pageUrl(number));
      const fresh = found.filter((ad) => !all.has(ad.lbcId));
      add(all, found);
      pagesRead = number;
      watch();
      const gained = all.size - before;
      log(`${plan.tag} : page ${number}, ${gained} nouvelles (${all.size} au total)`);
      const report = await plan.report({
        pages: number,
        ads: all.size,
        activity: {
          step: gained ? `Page ${number} lue · ${gained} nouvelles annonces` : `Page ${number} : plus rien de neuf`,
          recent: plan.preview(fresh),
          total,
        },
      });
      if (report.stop) throw new StopRequested();
      // Une page sans rien de neuf : on a fait le tour.
      if (gained === 0) break;
    }

    await finish();
  } catch (cause) {
    if (cause instanceof StopRequested) {
      log(`${plan.tag} : arrêtée à la demande après ${pagesRead} page(s)`);
      await finish().catch(() => undefined);
      return;
    }
    // Des centaines d'annonces déjà lues valent mieux qu'un échec : on garde
    // ce qui a été vu avant le blocage.
    if (timedOut && all.size) {
      log(`${plan.tag} : bloqué après ${pagesRead} page(s), on garde ce qui a été lu`);
      const saved = await finish().then(
        () => true,
        () => false,
      );
      if (saved) return;
    }
    const message = timedOut
      ? `Aucune page lue en ${STALL_TIMEOUT_MS / 60_000} minutes. Vérifie la fenêtre Chrome dédiée (vérification anti-robot ?) puis relance.`
      : cause instanceof Error
        ? cause.message
        : String(cause);
    log(`${plan.tag} : échec — ${message}`);
    await plan.report({ status: 'error', error: message.slice(0, 500) }).catch(() => undefined);
  } finally {
    clearTimeout(deadline);
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

function add(target: Map<string, ScrapedListing>, ads: ScrapedListing[]): void {
  for (const ad of ads) target.set(ad.lbcId, ad);
}

/**
 * Nombre d'annonces annoncé par la page de résultats, pour situer
 * l'avancement. Lecture approximative : écartée si elle contredit ce qu'on
 * voit déjà sur la première page.
 */
async function readTotal(page: Page, firstPage: number): Promise<number | null> {
  const text = await page
    .evaluate(() => {
      const heading = document.querySelector('h1, h2');
      return `${heading?.textContent ?? ''}\n${document.body.innerText.slice(0, 4000)}`;
    })
    .catch(() => '');
  const match = text.match(/(\d[\d\s  .]{0,8})\s+annonces?\b/i);
  const total = match ? Number(match[1].replace(/[^\d]/g, '')) : NaN;
  return Number.isFinite(total) && total >= firstPage && total < 100_000 ? total : null;
}

/** Une pause irrégulière entre deux pages, comme le ferait quelqu'un qui lit. */
export function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 3000 + Math.random() * 3000));
}
