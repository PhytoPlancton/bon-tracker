import type { Page, Response } from 'playwright';
import { config, LBC_ORIGIN } from './config.js';
import type { ScrapedListing } from './api.js';
import { dismissCookieBanner } from './browser.js';

/**
 * Deux voies d'extraction, dans cet ordre :
 *  1. les réponses JSON que la page consomme — format stable, insensible au
 *     remaniement du HTML ;
 *  2. à défaut, une lecture du DOM.
 * Garder les deux évite qu'une refonte visuelle du site fasse taire la collecte.
 */
export async function collectListings(page: Page, url: string): Promise<ScrapedListing[]> {
  const found = new Map<string, ScrapedListing>();

  const onResponse = async (response: Response) => {
    const type = response.headers()['content-type'] ?? '';
    if (!type.includes('json')) return;
    try {
      const payload = await response.json();
      for (const listing of harvest(payload)) {
        found.set(listing.lbcId, listing);
      }
    } catch {
      // Réponse illisible ou déjà consommée : sans conséquence.
    }
  };

  page.on('response', onResponse);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await dismissCookieBanner(page);
    await autoScroll(page);
    await page.waitForTimeout(1500);

    if (found.size === 0) {
      for (const listing of await readDom(page)) {
        found.set(listing.lbcId, listing);
      }
    }
  } finally {
    page.off('response', onResponse);
  }

  return [...found.values()];
}

/** Parcourt un JSON quelconque et en retire tout ce qui ressemble à une annonce. */
function harvest(node: unknown, accumulator: ScrapedListing[] = []): ScrapedListing[] {
  if (Array.isArray(node)) {
    for (const item of node) harvest(item, accumulator);
    return accumulator;
  }
  if (!node || typeof node !== 'object') return accumulator;

  const record = node as Record<string, unknown>;
  const id = record.list_id ?? record.listId ?? record.ad_id;
  const title = record.subject ?? record.title;

  if ((typeof id === 'number' || typeof id === 'string') && typeof title === 'string') {
    const lbcId = String(id);
    if (/^\d{6,}$/.test(lbcId)) {
      accumulator.push({
        lbcId,
        title: title.trim().slice(0, 300),
        url: typeof record.url === 'string' ? absolute(record.url) : `${LBC_ORIGIN}/ad/${lbcId}`,
        price: normalizePrice(record.price),
        imageUrl: extractImage(record),
        category: typeof record.category_name === 'string' ? record.category_name : null,
        sellerType: extractSellerType(record),
        location: extractLocation(record),
      });
    }
  }

  for (const value of Object.values(record)) harvest(value, accumulator);
  return accumulator;
}

function normalizePrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (Array.isArray(value) && value.length) return normalizePrice(value[0]);
  if (typeof value === 'string') {
    const digits = value.replace(/[^\d]/g, '');
    if (digits) return Number(digits);
  }
  return null;
}

function extractImage(record: Record<string, unknown>): string | null {
  const images = record.images as Record<string, unknown> | undefined;
  if (images) {
    if (typeof images.thumb_url === 'string') return images.thumb_url;
    if (typeof images.small_url === 'string') return images.small_url;
    const urls = images.urls_thumb ?? images.urls;
    if (Array.isArray(urls) && typeof urls[0] === 'string') return urls[0];
  }
  return typeof record.image_url === 'string' ? record.image_url : null;
}

function extractSellerType(record: Record<string, unknown>): 'pro' | 'private' | null {
  const owner = record.owner as Record<string, unknown> | undefined;
  const type = owner?.type ?? record.owner_type;
  if (type === 'pro' || type === 'private') return type;
  return null;
}

function extractLocation(record: Record<string, unknown>): string | null {
  const location = record.location as Record<string, unknown> | undefined;
  if (!location) return null;
  const parts = [location.city, location.zipcode].filter(
    (part): part is string => typeof part === 'string',
  );
  return parts.length ? parts.join(' ') : null;
}

function absolute(url: string): string {
  return url.startsWith('http') ? url : `${LBC_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** Lecture de secours : les cartes d'annonce pointent toutes vers /ad/<catégorie>/<id>. */
async function readDom(page: Page): Promise<ScrapedListing[]> {
  return page.evaluate((origin) => {
    const results: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    for (const anchor of Array.from(document.querySelectorAll('a[href*="/ad/"]'))) {
      const href = anchor.getAttribute('href') ?? '';
      const match = href.match(/\/ad\/[^/]+\/(\d{6,})/);
      if (!match) continue;

      const lbcId = match[1];
      if (seen.has(lbcId)) continue;
      seen.add(lbcId);

      const card = anchor.closest('article') ?? anchor;
      const text = (card.textContent ?? '').replace(/ | /g, ' ');
      const priceMatch = text.match(/(\d[\d\s]{2,})\s*€/);
      const image = card.querySelector('img');
      const title =
        card.querySelector('[data-test-id="adcard-title"], h2, h3')?.textContent?.trim() ||
        anchor.getAttribute('title') ||
        image?.getAttribute('alt') ||
        `Annonce ${lbcId}`;

      results.push({
        lbcId,
        title: title.slice(0, 300),
        url: href.startsWith('http') ? href : origin + href,
        price: priceMatch ? Number(priceMatch[1].replace(/\s/g, '')) : null,
        imageUrl: image?.getAttribute('src') ?? null,
        category: null,
        sellerType: text.includes('Pro') ? 'pro' : null,
        location: null,
      });
    }

    return results;
  }, LBC_ORIGIN) as unknown as Promise<ScrapedListing[]>;
}

export interface DiscoveredSearch {
  lbcSearchId: string;
  name: string;
  url: string;
  category: string | null;
  itemCount: number;
}

/** Relève les recherches sauvegardées du compte pour que l'app puisse les proposer. */
export async function collectSavedSearches(page: Page): Promise<DiscoveredSearch[]> {
  await page.goto(`${LBC_ORIGIN}/my-searches`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  await dismissCookieBanner(page);
  await autoScroll(page);
  await page.waitForTimeout(1200);

  return page.evaluate((origin) => {
    const results: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    for (const anchor of Array.from(document.querySelectorAll('a[href*="/recherche"]'))) {
      const href = anchor.getAttribute('href') ?? '';
      if (!href.includes('/recherche')) continue;

      const url = href.startsWith('http') ? href : origin + href;
      // Identifiant stable dérivé de l'URL : le site n'en expose pas toujours un.
      const key = url.split('?')[1] ?? url;
      let hash = 0;
      for (let i = 0; i < key.length; i += 1) {
        hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
      }
      const lbcSearchId = hash.toString(16).padStart(8, '0');
      if (seen.has(lbcSearchId)) continue;
      seen.add(lbcSearchId);

      const card = anchor.closest('article, li, div[class*="card" i]') ?? anchor;
      const name =
        anchor.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) ||
        `Recherche ${lbcSearchId}`;
      const countMatch = (card.textContent ?? '').match(/(\d+)\+?\s*$/);

      results.push({
        lbcSearchId,
        name: name.replace(/\s*\d+\+?$/, '').trim() || name,
        url,
        category: card.querySelector('[class*="badge" i]')?.textContent?.trim() ?? null,
        itemCount: countMatch ? Number(countMatch[1]) : 0,
      });
    }

    return results;
  }, LBC_ORIGIN) as unknown as Promise<DiscoveredSearch[]>;
}

/** Fait défiler la page pour déclencher le chargement paresseux des cartes. */
async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let offset = 0; offset < document.body.scrollHeight; offset += step) {
      window.scrollTo(0, offset);
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(config.pageDelayMs / 4);
}
