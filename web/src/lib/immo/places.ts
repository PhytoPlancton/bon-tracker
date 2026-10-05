import type { Place } from './types';

/**
 * Référentiel officiel des communes (geo.api.gouv.fr, gratuit et sans clé) :
 * nom, codes postaux et centre de chaque commune et arrondissement. Le
 * centre permet de chercher dans un rayon ; les codes postaux, de vérifier
 * qu'une annonce est bien du coin.
 */
function geoApi(): string {
  return (process.env.GEO_API_URL || 'https://geo.api.gouv.fr').replace(/\/$/, '');
}

const FIELDS = 'nom,code,codesPostaux,centre,codeDepartement,population';

interface GeoCommune {
  nom: string;
  code: string;
  codesPostaux?: string[];
  codeDepartement?: string;
  population?: number;
  centre?: { coordinates?: [number, number] };
}

export class PlacesUnavailable extends Error {}

/**
 * Communes dont le nom commence par la saisie, ou qui portent ce code
 * postal ; les plus peuplées d'abord, celles qu'on cherche le plus souvent.
 * Les arrondissements de Paris, Lyon et Marseille sont proposés à part : un
 * quartier n'a pas les prix de la ville entière.
 */
export async function searchPlaces(query: string): Promise<Place[]> {
  const text = query.trim();
  if (/^\d{5}$/.test(text)) return byPostalCode(text);
  if (text.length < 2 || /^\d+$/.test(text)) return [];

  const params = new URLSearchParams({
    nom: text,
    type: 'commune-actuelle,arrondissement-municipal',
    fields: FIELDS,
    boost: 'population',
    limit: '8',
  });
  return (await request(`/communes?${params}`)).map(toPlace).sort(byPopulation).map(stripPopulation);
}

async function byPostalCode(code: string): Promise<Place[]> {
  const params = new URLSearchParams({ codePostal: code, fields: FIELDS });
  try {
    const found = (await request(`/communes?${params}`)).map(toPlace).sort(byPopulation).map(stripPopulation);
    // Paris, Lyon et Marseille : le code postal désigne un arrondissement,
    // que le référentiel range à part.
    if (found.length) return found;
    const districts = new URLSearchParams({ codePostal: code, type: 'arrondissement-municipal', fields: FIELDS });
    return (await request(`/communes?${districts}`)).map(toPlace).map(stripPopulation);
  } catch {
    // Référentiel injoignable : un code postal suffit encore à chercher,
    // sans rayon faute de centre connu.
    return [postalOnly(code)];
  }
}

async function request(path: string): Promise<GeoCommune[]> {
  let response: Response;
  try {
    response = await fetch(`${geoApi()}${path}`, { signal: AbortSignal.timeout(5000) });
  } catch {
    throw new PlacesUnavailable('Le référentiel des communes ne répond pas.');
  }
  if (!response.ok) throw new PlacesUnavailable(`Le référentiel des communes répond ${response.status}.`);
  const body = (await response.json().catch(() => [])) as unknown;
  return Array.isArray(body) ? (body as GeoCommune[]) : [];
}

function toPlace(commune: GeoCommune): Place & { population: number } {
  const [lng, lat] = commune.centre?.coordinates ?? [];
  return {
    name: commune.nom,
    code: commune.code,
    postalCodes: (commune.codesPostaux ?? []).filter((code) => /^\d{5}$/.test(code)).slice(0, 50),
    department: commune.codeDepartement ?? departmentOf(commune.codesPostaux?.[0] ?? commune.code),
    lat: typeof lat === 'number' ? lat : null,
    lng: typeof lng === 'number' ? lng : null,
    population: commune.population ?? 0,
  };
}

function byPopulation(a: { population: number }, b: { population: number }): number {
  return b.population - a.population;
}

function stripPopulation({ population: _population, ...place }: Place & { population: number }): Place {
  return place;
}

export function postalOnly(code: string): Place {
  return {
    name: code,
    code: `cp-${code}`,
    postalCodes: [code],
    department: departmentOf(code),
    lat: null,
    lng: null,
  };
}

/** Département d'un code postal ou INSEE : deux chiffres, trois outre-mer. */
function departmentOf(code: string): string {
  return code.startsWith('97') ? code.slice(0, 3) : code.slice(0, 2);
}
