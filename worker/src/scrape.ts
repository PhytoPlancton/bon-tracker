import type { Page, Response } from 'playwright';
import { config, LBC_ORIGIN } from './config.js';
import type { ScrapedListing } from './api.js';
import { consentBannerVisible, dismissCookieBanner } from './browser.js';

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

    // S'il tient encore, le contenu reste masqué : insister vaut mieux que
    // rapporter une page vide.
    if (await consentBannerVisible(page)) {
      await page.waitForTimeout(1500);
      await dismissCookieBanner(page);
    }

    await autoScroll(page);
    await page.waitForTimeout(1500);

    // Les deux lectures se complètent : les réponses du site portent parfois
    // un prix exact sans caractéristiques, les cartes l'inverse. Ne recourir à
    // la seconde qu'en dernier ressort privait les annonces de leur année et
    // de leur kilométrage sur toutes les pages de résultats.
    for (const listing of await readDom(page)) {
      found.set(listing.lbcId, merge(found.get(listing.lbcId), listing));
    }
  } finally {
    page.off('response', onResponse);
  }

  return [...found.values()];
}

/**
 * Réunit deux lectures d'une même annonce, en gardant de chacune ce qu'elle
 * apporte. Un champ renseigné l'emporte toujours sur un champ vide.
 */
function merge(a: ScrapedListing | undefined, b: ScrapedListing): ScrapedListing {
  if (!a) return b;
  return {
    ...a,
    ...b,
    title: longest(a.title, b.title),
    price: a.price ?? b.price,
    imageUrl: a.imageUrl ?? b.imageUrl,
    category: a.category ?? b.category,
    sellerType: a.sellerType ?? b.sellerType,
    location: a.location ?? b.location,
    attributes:
      a.attributes || b.attributes ? { ...(b.attributes ?? {}), ...(a.attributes ?? {}) } : undefined,
  };
}

/** Le titre le plus complet : l'un des deux est parfois tronqué. */
function longest(a: string, b: string): string {
  return (a?.length ?? 0) >= (b?.length ?? 0) ? a : b;
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
    // Un titre vide trahit un objet de service, pas une annonce.
    if (/^\d{6,}$/.test(lbcId) && title.trim().length > 2) {
      accumulator.push({
        lbcId,
        title: title.trim().slice(0, 300),
        url: typeof record.url === 'string' ? absolute(record.url) : `${LBC_ORIGIN}/ad/${lbcId}`,
        price: normalizePrice(record.price),
        imageUrl: extractImage(record),
        category: typeof record.category_name === 'string' ? record.category_name : null,
        sellerType: extractSellerType(record),
        location: extractLocation(record),
        attributes: extractAttributes(record),
      });
    }
  }

  for (const value of Object.values(record)) harvest(value, accumulator);
  return accumulator;
}

/** Au-delà, ce n'est plus un prix d'annonce mais une valeur mal lue. */
const MAX_PRICE = 5_000_000;

/**
 * Ramène un prix à un nombre, ou renonce.
 *
 * Les pages portent aussi des plages de filtre — « 200 € à 322 000 € » — dont
 * les chiffres mis bout à bout donneraient 200 322 000. Mieux vaut ignorer un
 * prix douteux que fausser toutes les médianes d'un segment.
 */
function normalizePrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 && value <= MAX_PRICE ? Math.round(value) : null;
  }

  if (Array.isArray(value)) {
    // Un tableau à plusieurs valeurs décrit un intervalle, pas un prix.
    return value.length === 1 ? normalizePrice(value[0]) : null;
  }

  if (typeof value === 'string') {
    const groups = value.match(/\d[\d\s.,\u202f\u00a0]*/g) ?? [];
    if (groups.length !== 1) return null;
    const digits = groups[0].replace(/[^\d]/g, '');
    if (!digits) return null;
    const price = Number(digits);
    return price > 0 && price <= MAX_PRICE ? price : null;
  }

  return null;
}

/**
 * Reprend les caractéristiques publiées avec l'annonce.
 *
 * On ne choisit pas lesquelles retenir : le site en attache un nombre variable
 * selon la catégorie, et celles qui comptent pour comparer deux voitures —
 * puissance, année, kilométrage — ne portent pas toujours le nom attendu.
 */
function extractAttributes(record: Record<string, unknown>): Record<string, string> | undefined {
  const raw = record.attributes;
  if (!Array.isArray(raw)) return undefined;

  const attributes: Record<string, string> = {};
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const key = typeof item.key === 'string' ? item.key : null;
    const value = item.value ?? item.value_label;
    if (!key || (typeof value !== 'string' && typeof value !== 'number')) continue;
    attributes[key.slice(0, 40)] = String(value).slice(0, 80);
  }

  return Object.keys(attributes).length ? attributes : undefined;
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

/**
 * Lit les cartes d'annonce du document.
 *
 * Le site publie, à l'intention des lecteurs d'écran, des phrases qui
 * énoncent le prix, les caractéristiques et le lieu sans ambiguïté. Elles
 * valent mieux que le texte visible, où l'année et le prix se touchent au
 * point d'être confondus.
 */
async function readDom(page: Page): Promise<ScrapedListing[]> {
  return page.evaluate((origin) => {
    const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

    /** « Boîte de vitesse » devient « boite_de_vitesse ». */
    const asKey = (label: string) =>
      label
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');

    const results: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    for (const anchor of Array.from(document.querySelectorAll('a[href*="/ad/"]'))) {
      const href = anchor.getAttribute('href') ?? '';
      const match = href.match(/\/ad\/[^/]+\/(\d{6,})/);
      if (!match) continue;

      const lbcId = match[1];
      if (seen.has(lbcId)) continue;
      seen.add(lbcId);

      const card = anchor.closest('article') ?? anchor.parentElement ?? anchor;
      const spoken = Array.from(card.querySelectorAll('[class*="sr-only"]')).map((node) =>
        clean(node.textContent),
      );

      // « Prix: 15 900 €. » — énoncé pour lui-même, sans mensualité ni année.
      const priceLine = spoken.find((line) => /^prix\s*:/i.test(line));
      const price = priceLine ? Number(priceLine.replace(/[^\d]/g, '')) || null : null;

      // « Année: "2001". Kilométrage: "158300 km". Énergie: "Essence"… »
      const specsLine = spoken.find((line) => /:\s*"/.test(line)) ?? '';
      const attributes: Record<string, string> = {};
      for (const [, label, value] of specsLine.matchAll(/([^.:"]+)\s*:\s*"([^"]+)"/g)) {
        const key = asKey(label);
        if (key) attributes[key] = clean(value).slice(0, 80);
      }

      // « Située à Vannes 56000. »
      const placeLine = spoken.find((line) => /situ[ée]e?\s+[àa]\s/i.test(line));
      const location = placeLine
        ? clean(placeLine.replace(/^.*?\s[àa]\s+/i, '')).replace(/\.$/, '')
        : clean(card.querySelector('[class*="text-caption"]')?.textContent) || null;

      const image = card.querySelector('img');
      const title =
        clean(card.querySelector('[class*="text-body-1-highlight"], [class*="headline" i]')?.textContent) ||
        clean(anchor.getAttribute('title')) ||
        clean(image?.getAttribute('alt'));

      // Sans titre, l'annonce serait inexploitable : mieux vaut ne pas la
      // compter que de la ranger sous un numéro.
      if (title.length <= 2) continue;

      results.push({
        lbcId,
        title: title.slice(0, 300),
        url: href.startsWith('http') ? href : origin + href,
        price,
        imageUrl: image?.getAttribute('src') ?? null,
        category: null,
        sellerType: /\bpro\b/i.test(clean(card.textContent)) ? 'pro' : null,
        location: location || null,
        attributes: Object.keys(attributes).length ? attributes : undefined,
      });
    }

    return results;
  }, LBC_ORIGIN) as unknown as Promise<ScrapedListing[]>;
}

export interface DiscoveredSearch {
  lbcSearchId: string;
  name: string;
  url: string;
  /** Critères de la recherche, tels que le site les résume. */
  details: string | null;
  itemCount: number;
}

/**
 * Relève les recherches sauvegardées du compte.
 *
 * Chaque recherche est un `<article>` sans titre de section : le nom se trouve
 * dans le paragraphe de classe « text-headline », le compteur dans la pastille
 * ronde, et les critères dans le premier paragraphe de corps de texte.
 */
export async function collectSavedSearches(page: Page): Promise<DiscoveredSearch[]> {
  await page.goto(`${LBC_ORIGIN}/my-searches`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  await dismissCookieBanner(page);
  await autoScroll(page);
  await page.waitForTimeout(1200);

  return page.evaluate((origin) => {
    const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
    const ACTIONS = /^([êe]tre alert[ée]|voir les r[ée]sultats)/i;

    const results: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    for (const card of Array.from(document.querySelectorAll('article'))) {
      const anchor = card.querySelector('a[href*="/recherche"]');
      const href = anchor?.getAttribute('href');
      if (!href) continue;

      const url = href.startsWith('http') ? href : origin + href;
      // Identifiant stable dérivé de l'URL : le site n'en expose pas d'autre.
      const key = url.split('?')[1] ?? url;
      let hash = 0;
      for (let i = 0; i < key.length; i += 1) {
        hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
      }
      const lbcSearchId = hash.toString(16).padStart(8, '0');
      if (seen.has(lbcSearchId)) continue;
      seen.add(lbcSearchId);

      const name = clean(card.querySelector('[class*="headline"]')?.textContent);
      const details = Array.from(card.querySelectorAll('p'))
        .map((node) => clean(node.textContent))
        .find((text) => text && !ACTIONS.test(text) && text !== name);
      const count = clean(card.querySelector('[class*="rounded-full"]')?.textContent);

      results.push({
        lbcSearchId,
        name: name || `Recherche ${lbcSearchId}`,
        url,
        details: details ?? null,
        itemCount: Number(count.replace(/\D/g, '')) || 0,
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
