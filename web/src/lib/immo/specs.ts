import type { PropertyType } from './types';

/**
 * Ramène les caractéristiques publiées à des champs exploitables.
 *
 * Les deux lectures du collecteur nomment différemment les mêmes choses —
 * « square » dans les données du site, « surface » sur la carte d'annonce —
 * d'où les replis. Et quand rien n'est renseigné, le titre (« T3 de 62 m² »)
 * dit souvent l'essentiel.
 *
 * Fonction pure : elle sert au versement des annonces comme aux tests.
 */
export function readImmoSpecs(attributes: Record<string, string> = {}, title = '') {
  const text = words(title);
  const surface =
    area(attributes.square ?? attributes.surface ?? attributes.surface_habitable) ?? surfaceInTitle(title);
  const rooms = whole(attributes.rooms ?? attributes.pieces ?? attributes.nombre_de_pieces) ?? roomsInTitle(text);
  const propertyType = typeOf(attributes, text);
  const floor =
    whole(attributes.floor_number ?? attributes.etage) ??
    (/ (rez de chaussee|rdc) /.test(text) ? 0 : null);

  return {
    surface: within(surface, 8, 2000),
    rooms: within(rooms, 1, 30),
    bedrooms: within(whole(attributes.bedrooms ?? attributes.chambres ?? attributes.nombre_de_chambres), 0, 30),
    propertyType,
    energy: energyClass(attributes.energy_rate ?? attributes.classe_energie ?? attributes.dpe),
    floor: within(floor, 0, 99),
    isNew: novelty(attributes.immo_sell_type_label ?? attributes.immo_sell_type ?? attributes.type_de_vente, text),
    furnished: furnishing(attributes.furnished_label ?? attributes.furnished ?? attributes.meuble),
    landSurface: within(area(attributes.land_plot_surface ?? attributes.surface_du_terrain ?? attributes.surface_terrain), 1, 1_000_000),
  };
}

/** Code postal d'un lieu tel que le site l'écrit (« Nantes 44000 »). */
export function zipcodeOf(location: string | null | undefined): string | null {
  return location?.match(/\b(\d{5})\b/)?.[1] ?? null;
}

/** Codes du site pour le type de bien. */
const REAL_ESTATE_TYPE: Record<string, PropertyType> = { '1': 'maison', '2': 'appartement' };

function typeOf(attributes: Record<string, string>, text: string): PropertyType | null {
  const code = attributes.real_estate_type;
  if (code && REAL_ESTATE_TYPE[code]) return REAL_ESTATE_TYPE[code];
  const label = words(attributes.real_estate_type_label ?? attributes.type_de_bien ?? '');
  if (/ (maison|villa) /.test(label)) return 'maison';
  if (/ appartement /.test(label)) return 'appartement';
  if (/ (appartement|studio|duplex|loft|triplex) /.test(text)) return 'appartement';
  if (/ (maison|villa|pavillon|longere|chaumiere|mas|bastide) /.test(text)) return 'maison';
  return null;
}

/**
 * Surface citée dans le titre. Une maison annonce souvent aussi son terrain
 * (« 120 m² sur 800 m² de terrain ») : on écarte ce qui suit un mot de
 * dépendance pour ne garder que la surface habitable.
 */
function surfaceInTitle(title: string): number | null {
  const lower = title.toLowerCase();
  for (const match of lower.matchAll(/(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:m²|m2|m\b|mètres? carrés)/g)) {
    const before = lower.slice(Math.max(0, (match.index ?? 0) - 18), match.index);
    if (/terrain|jardin|parcelle|garage|cave|balcon|terrasse|sur\s*$/.test(before)) continue;
    return Number(match[1].replace(',', '.'));
  }
  return null;
}

function roomsInTitle(text: string): number | null {
  const pieces = text.match(/ (\d{1,2}) pieces? /);
  if (pieces) return Number(pieces[1]);
  const type = text.match(/ [tf](\d{1,2}) /);
  if (type) return Number(type[1]);
  return / studio /.test(text) ? 1 : null;
}

/** « 45 », « 45 m² », « 45,5 m² », « 1 200 m² ». */
function area(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.replace(/[\s  ]/g, '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return match ? Math.round(Number(match[0]) * 10) / 10 : null;
}

function whole(value: string | undefined): number | null {
  const digits = value?.match(/\d+/)?.[0];
  return digits ? Number(digits) : null;
}

function within(value: number | null, min: number, max: number): number | null {
  return value !== null && value >= min && value <= max ? value : null;
}

/** Classe du DPE, de A à G ; « vierge » ou « non communiqué » ne disent rien. */
function energyClass(value: string | undefined): string | null {
  const match = value?.trim().match(/^([a-g])\b/i);
  return match ? match[1].toUpperCase() : null;
}

function novelty(value: string | undefined, text: string): boolean | null {
  const kind = words(value ?? '');
  if (/ (neuf|new) /.test(kind)) return true;
  if (/ (ancien|old) /.test(kind)) return false;
  return / (vefa|programme neuf) /.test(text) ? true : null;
}

/** « 1 » ou « Meublé » : meublé ; « 2 » ou « Non meublé » : vide. */
function furnishing(value: string | undefined): boolean | null {
  if (!value) return null;
  const label = words(value);
  if (/ non meuble/.test(label) || label.trim() === '2') return false;
  if (/ meuble/.test(label) || label.trim() === '1') return true;
  return null;
}

/** Texte sans accents ni ponctuation, bordé d'espaces pour chercher des mots entiers. */
export function words(text: string): string {
  return ` ${text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}
