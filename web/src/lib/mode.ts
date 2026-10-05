/**
 * Deux applications en une : Bon Tracker pour les voitures, Bon Tracker Immo
 * pour l'immobilier. Le mode choisi dans les réglages décide de ce que
 * montrent le suivi, les recherches et le marché. Rien n'est effacé en
 * changeant de mode : chaque domaine garde ses données, et le collecteur
 * continue de tout relever.
 *
 * Module sans dépendance serveur : le classement d'une annonce sert aussi
 * bien à la base qu'à l'écran.
 */
export type Mode = 'auto' | 'immo';

export const MODES: readonly Mode[] = ['auto', 'immo'];

export function isMode(value: unknown): value is Mode {
  return value === 'auto' || value === 'immo';
}

/**
 * Catégories de l'immobilier telles qu'elles figurent dans l'adresse d'une
 * annonce (« /ad/ventes_immobilieres/… »). C'est le repère le plus sûr : le
 * nom de catégorie manque aux annonces lues sur la page plutôt que dans ses
 * données.
 */
export const IMMO_AD_PATH = /\/ad\/(ventes_immobilieres|locations|colocations|bureaux_(?:et_)?commerces)\//;

/** Noms de catégorie de l'immobilier, quand le site les fournit. */
export const IMMO_CATEGORY = /immobili|^locations?$|colocation|bureaux/i;

/**
 * Recherches de l'immobilier : catégories 8 (Immobilier), 9 (Ventes
 * immobilières), 10 (Locations), 11 (Colocations) et 13 (Bureaux &
 * commerces), en paramètre ou dans le chemin. Les locations de vacances, à
 * part, n'en sont pas.
 */
const IMMO_SEARCH =
  /[?&]category=(8|9|10|11|13)(&|$)|\/cl?\/(ventes_immobilieres|locations|colocations|bureaux_(?:et_)?commerces)(\/|$)/;

export function listingMode(listing: { url?: string | null; category?: string | null }): Mode {
  if (listing.url && IMMO_AD_PATH.test(listing.url)) return 'immo';
  if (listing.category && IMMO_CATEGORY.test(listing.category)) return 'immo';
  return 'auto';
}

export function searchMode(url: string): Mode {
  return IMMO_SEARCH.test(url) ? 'immo' : 'auto';
}

/** Filtre MongoDB des annonces d'un domaine, tiré des mêmes repères. */
export function listingModeFilter(mode: Mode): Record<string, unknown> {
  const immo = {
    $or: [
      { url: { $regex: IMMO_AD_PATH.source } },
      { category: { $regex: IMMO_CATEGORY.source, $options: 'i' } },
    ],
  };
  // L'auto reprend tout ce qui n'est pas de l'immobilier : objets et motos
  // suivis jusqu'ici restent visibles là où ils l'étaient.
  return mode === 'immo' ? immo : { $nor: [immo] };
}
