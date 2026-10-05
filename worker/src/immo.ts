import { LBC_ORIGIN } from './config.js';
import { ingestImmoAds, updateImmoQuery, type ScrapedListing } from './api.js';
import { pause, runCollection, type Recent } from './collect.js';
import { collectListings } from './scrape.js';

/** Une commune ou un arrondissement, tel que l'application l'a trouvé au référentiel officiel. */
export interface Place {
  name: string;
  code: string;
  postalCodes: string[];
  department: string;
  lat: number | null;
  lng: number | null;
}

/** Ce qu'on cherche : un type de bien, à vendre ou à louer, dans un lieu et une fourchette de surface. */
export interface ImmoSpec {
  queryId: string;
  /** Envoi de l'application que cette collecte sert. */
  runId?: string;
  transaction: 'vente' | 'location';
  propertyType: 'appartement' | 'maison';
  place: Place;
  /** Rayon autour de la commune, en kilomètres ; 0 pour la commune seule. */
  radiusKm: number;
  surfaceMin: number | null;
  surfaceMax: number | null;
  /** Forme du lieu déjà comprise par le site lors d'une collecte précédente. */
  locationParam: string | null;
}

/** Part d'annonces du coin au-delà de laquelle le site a compris le lieu. */
const UNDERSTOOD = 0.6;

/**
 * Relève toutes les annonces d'un marché immobilier.
 *
 * Le lieu est le point délicat : le site l'écrit dans l'adresse sous une
 * forme qui lui est propre, et ne dit rien quand il ne la comprend pas — il
 * renvoie alors des annonces de toute la France. On essaie donc plusieurs
 * formes, et on garde la première dont les annonces sont bien du coin. La
 * forme retenue est remontée à l'application, qui la redonne aux collectes
 * suivantes du même lieu.
 */
export async function runImmoJob(spec: ImmoSpec, log: (message: string) => void): Promise<void> {
  const label = marketLabel(spec);
  let locationParam = spec.locationParam;

  await runCollection(
    {
      tag: `[immo] ${label}`,
      report: (patch) => updateImmoQuery(spec.queryId, { runId: spec.runId, ...patch }),

      async open(page, say) {
        const candidates = unique([...(spec.locationParam ? [spec.locationParam] : []), ...locationForms(spec)]);
        let best: { param: string; ads: ScrapedListing[]; share: number } | null = null;

        for (const [index, candidate] of candidates.entries()) {
          if (index === 0) {
            await say(`Recherche des ${label} sur leboncoin`);
          } else {
            await say(`Le lieu n’a pas été reconnu sous cette forme : autre essai (${index + 1}/${candidates.length})`);
            await pause();
          }
          const ads = await collectListings(page, searchUrl(spec, candidate, 1));
          const share = localShare(ads, spec);
          log(`[immo] ${label} : lieu « ${candidate} », ${ads.length} annonces dont ${Math.round(share * 100)} % du coin`);
          if (!best || localCount(ads, share) > localCount(best.ads, best.share)) {
            best = { param: candidate, ads, share };
          }
          if (ads.length && share >= UNDERSTOOD) break;
        }

        // Des annonces, mais aucune du coin : chercher plus loin n'apprendrait
        // rien, et garder ces annonces fausserait tout.
        if (!best || (best.ads.length && best.share === 0)) {
          throw new Error(
            `leboncoin ne reconnaît pas ce lieu : les annonces renvoyées sont toutes d’ailleurs. Essaie la commune voisine, ou un rayon.`,
          );
        }
        locationParam = best.param;
        const understood = best.ads.length > 0 && best.share >= UNDERSTOOD;
        if (!understood && best.ads.length) {
          log(`[immo] ${label} : lieu compris en partie, les annonces d’ailleurs seront écartées`);
        }
        // Une forme mal comprise n'est pas retenue : la collecte suivante
        // cherchera de nouveau.
        return { ads: best.ads, learned: { locationParam: understood ? best.param : null } };
      },

      pageUrl: (number) => searchUrl(spec, locationParam, number),
      preview,

      async keep(ads, say) {
        const kept = ads.filter((ad) => belongs(ad, spec));
        await say(`Tri de ${ads.length} annonces : ${kept.length} sont bien des ${label}`);
        for (let i = 0; i < kept.length; i += 200) {
          await ingestImmoAds(spec.queryId, kept.slice(i, i + 200));
        }
        return kept.length;
      },
    },
    log,
  );
}

function searchUrl(spec: ImmoSpec, locationParam: string | null, page: number): string {
  const params = new URLSearchParams({ category: spec.transaction === 'vente' ? '9' : '10' });
  params.set('real_estate_type', spec.propertyType === 'maison' ? '1' : '2');
  if (locationParam) params.set('locations', locationParam);
  if (spec.surfaceMin || spec.surfaceMax) {
    params.set('square', `${spec.surfaceMin ?? 'min'}-${spec.surfaceMax ?? 'max'}`);
  }
  if (page > 1) params.set('page', String(page));
  return `${LBC_ORIGIN}/recherche?${params.toString()}`;
}

/**
 * Formes du lieu à essayer, de la plus précise à la plus large. Le site
 * écrit une ville avec son code postal, et son centre quand on cherche dans
 * un rayon ; un département en dernier recours, dont on écarte ensuite ce
 * qui n'est pas du coin.
 */
function locationForms(spec: ImmoSpec): string[] {
  const { place } = spec;
  const city = cityName(place);
  const zip = place.postalCodes[0];
  const named = city !== null;
  const radius = spec.radiusKm * 1000;

  // Centre et rayon, avec ou sans code postal, avec ou sans rayon par défaut
  // de la ville : les formes qu'on voit passer dans les adresses du site.
  const coordinates: string[] = [];
  if (named && place.lat !== null && place.lng !== null) {
    const center = `${place.lat.toFixed(5)}_${place.lng.toFixed(5)}`;
    const reach = radius || DEFAULT_RADIUS;
    coordinates.push(`${city}_${zip}__${center}_${reach}`);
    coordinates.push(`${city}__${center}_${reach}`);
    coordinates.push(`${city}_${zip}__${center}_${DEFAULT_RADIUS}_${reach}`);
  }
  const byName = named ? [`${city}_${zip}`] : [];

  // La commune seule se dit d'abord par son nom ; un rayon, par son centre.
  const forms = spec.radiusKm > 0 ? [...coordinates, ...byName] : [...byName, ...coordinates];
  return [...forms, zip, `d_${place.department}`];
}

/** Rayon que le site prête à une ville quand on n'en choisit pas, en mètres. */
const DEFAULT_RADIUS = 5000;

/** « Paris 11e Arrondissement » s'écrit « Paris » sur le site, l'arrondissement passant par le code postal. */
function cityName(place: Place): string | null {
  if (place.code.startsWith('cp-')) return null;
  return place.name.replace(/\s+\d+(er|e|ème)?\s+arrondissement$/i, '').trim();
}

/** Part des annonces situées dans le lieu demandé, parmi celles dont on connaît le lieu. */
function localShare(ads: ScrapedListing[], spec: ImmoSpec): number {
  const placed = ads.filter((ad) => isLocal(ad, spec) !== null);
  if (!placed.length) return ads.length ? 1 : 0;
  return placed.filter((ad) => isLocal(ad, spec)).length / placed.length;
}

function localCount(ads: ScrapedListing[], share: number): number {
  return ads.length * share;
}

/**
 * L'annonce est-elle du coin ? Null quand on ne peut pas le dire.
 *
 * Commune seule : le code postal fait foi. Dans un rayon : la distance au
 * centre, avec un peu de marge — une annonce est placée au centre de sa
 * commune, pas à son adresse.
 */
function isLocal(ad: ScrapedListing, spec: ImmoSpec): boolean | null {
  const zip = ad.location?.match(/\b(\d{5})\b/)?.[1] ?? null;
  const { place } = spec;
  if (spec.radiusKm > 0 && place.lat !== null && place.lng !== null && ad.lat != null && ad.lng != null) {
    return kilometres(place.lat, place.lng, ad.lat, ad.lng) <= spec.radiusKm + 3;
  }
  if (zip) {
    // Sans position, le département départage : la Corse (2A, 2B) a des codes postaux en 20.
    const department = /^2[AB]$/.test(place.department) ? '20' : place.department;
    return spec.radiusKm > 0 ? zip.startsWith(department) : place.postalCodes.includes(zip);
  }
  const city = cityName(place);
  if (city && ad.location) return words(ad.location).startsWith(words(city));
  return null;
}

function kilometres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLng = (lng2 - lng1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Codes du site pour le type de bien. */
const TYPE_CODE = { maison: '1', appartement: '2' } as const;
const NOT_A_FLAT = /^(maison|villa|pavillon|longere|terrain|parking|garage|box|local|immeuble)\b/;
const NOT_A_HOUSE = /^(appartement|studio|[tf]\d|duplex|loft|terrain|parking|garage|box|local|immeuble)\b/;

/**
 * L'annonce relève-t-elle bien du marché demandé ? Le site filtre déjà la
 * recherche ; on revérifie ce qu'il rend, sans écarter une annonce muette
 * sur un critère.
 */
function belongs(ad: ScrapedListing, spec: ImmoSpec): boolean {
  if (ad.price === null) return false;
  if (isLocal(ad, spec) === false) return false;

  const type = ad.attributes?.real_estate_type;
  if (type) {
    if (type !== TYPE_CODE[spec.propertyType]) return false;
  } else {
    const title = words(ad.title);
    if ((spec.propertyType === 'appartement' ? NOT_A_FLAT : NOT_A_HOUSE).test(title)) return false;
  }

  const surface = surfaceOf(ad);
  if (surface !== null) {
    // Un peu de marge : « 68,5 m² » arrondi par le site reste dans « 68 m² ».
    if (spec.surfaceMin !== null && surface < spec.surfaceMin * 0.95) return false;
    if (spec.surfaceMax !== null && surface > spec.surfaceMax * 1.05) return false;
  }
  return true;
}

function surfaceOf(ad: ScrapedListing): number | null {
  const declared = ad.attributes?.square ?? ad.attributes?.surface ?? ad.attributes?.surface_habitable;
  const fromAttributes = declared?.replace(/[\s  ]/g, '').replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0];
  if (fromAttributes) return Number(fromAttributes);
  const inTitle = ad.title.toLowerCase().match(/(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:m²|m2)/);
  return inTitle ? Number(inTitle[1].replace(',', '.')) : null;
}

/**
 * Ce que l'application montre pendant la collecte : les derniers biens lus,
 * pour qu'on voie le travail avancer plutôt qu'un compteur.
 */
function preview(ads: ScrapedListing[]): Recent[] {
  return ads
    .filter((ad) => ad.price !== null)
    .slice(0, 8)
    .map((ad) => ({
      title: ad.title.slice(0, 120),
      price: ad.price as number,
      surface: surfaceOf(ad),
      rooms: Number(ad.attributes?.rooms ?? ad.attributes?.pieces) || null,
      imageUrl: ad.imageUrl ?? null,
      location: ad.location ?? null,
    }));
}

/** « appartements à Nantes », « maisons autour de Vannes ». */
function marketLabel(spec: ImmoSpec): string {
  const noun = spec.propertyType === 'maison' ? 'maisons' : 'appartements';
  const where = spec.radiusKm > 0 ? `autour de ${spec.place.name}` : `à ${spec.place.name}`;
  return `${noun} ${where.replace(/\s+arrondissement$/i, '')}`;
}

function words(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
