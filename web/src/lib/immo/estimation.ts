/**
 * Marché d'un bien à partir des annonces.
 *
 * Tout repose sur une idée : deux biens ne se comparent qu'au mètre carré, à
 * taille et nombre de pièces proches. Un studio se vend plus cher au m² qu'un
 * cinq pièces ; mélanger les deux, c'est décrire un bien qui n'existe pas. Le
 * reste — prix médian, bonnes affaires, valeur d'un bien donné — découle de
 * cette définition, écrite une seule fois ici.
 *
 * Fonctions pures : aucune dépendance à la base, pour servir aussi bien côté
 * serveur qu'à l'écran et dans les tests.
 */
import { words } from './specs';
import type { PropertyType, Transaction } from './types';

/** Une annonce telle que l'écran la lit. */
export interface ImmoAdView {
  lbcId: string;
  title: string;
  url: string;
  /** Prix de vente, ou loyer mensuel. */
  price: number;
  surface: number | null;
  rooms: number | null;
  propertyType: PropertyType | null;
  energy: string | null;
  floor: number | null;
  isNew: boolean | null;
  furnished: boolean | null;
  landSurface: number | null;
  location: string | null;
  imageUrl?: string | null;
  sellerType?: 'pro' | 'private' | null;
  /** Prix au m² : la mesure commune à des biens de tailles différentes. */
  perM2: number | null;
  /** Ce qui rend l'annonce incomparable : viager, enchères… Hors de tout calcul. */
  flags?: string[];
  /** Ce qui explique un prix sans le rendre incomparable : travaux, neuf, vendu loué. */
  tags?: string[];
}

/** Sous ces prix, c'est un parking, une cave, un bouquet de viager ou une faute de frappe. */
const MIN_PRICE: Record<Transaction, number> = { vente: 15_000, location: 150 };

/** Nettement sous ses comparables : 15 % de moins que leur prix au m². */
const DEAL_RATIO = 0.85;

/** En deçà, une médiane de comparables ne veut rien dire. */
const MIN_COMPARABLES = 4;

/**
 * Tolérances successives pour réunir des biens comparables : on part serré
 * et on n'élargit que faute de mieux, en disant jusqu'où on est allé.
 */
const LEVELS = [
  { share: 0.1, floor: 4, sameRooms: true },
  { share: 0.2, floor: 6, sameRooms: true },
  { share: 0.3, floor: 10, sameRooms: true },
  { share: 0.3, floor: 10, sameRooms: false },
] as const;

type Level = (typeof LEVELS)[number];

// ---------------------------------------------------------------------------
// Lecture des annonces
// ---------------------------------------------------------------------------

/**
 * Ce qui fait d'une annonce autre chose qu'un bien au prix du marché. Un
 * viager affiche son bouquet, une enchère sa mise à prix, une résidence de
 * services un rendement : aucun ne dit ce que vaut le logement.
 */
const FLAGS: Record<Transaction, { label: string; pattern: RegExp }[]> = {
  vente: [
    { label: 'Viager', pattern: / (viager|bouquet|rente viagere) / },
    { label: 'Nue-propriété', pattern: / (nue propriete|usufruit) / },
    { label: 'Enchères', pattern: / (encheres?|mise a prix|adjudication|vente judiciaire) / },
    {
      // Un logement vendu avec son bail commercial se paie au rendement,
      // pas au mètre carré. La seule mention « LMNP », elle, n'en dit rien :
      // c'est un régime fiscal, pas un type de bien.
      label: 'Résidence services',
      pattern: / (residence (de )?services?|residence seniors?|residence etudiante|residence de tourisme|residence geree|ehpad|bail commercial) /,
    },
    { label: 'Parts de société', pattern: / (parts? (de )?sci|cession de parts) / },
    { label: 'Pas un logement', pattern: /^ (terrain|parking|garage|box|cave|local|fonds de commerce|immeuble) / },
  ],
  location: [
    { label: 'Colocation', pattern: / (colocation|coloc|colocataires?|chambre chez l habitant|chambre (a louer )?dans (un |une )?(appartement|maison|colocation)) / },
    // « Calme la nuit » décrit un quartier, pas un tarif : seuls les prix à la nuitée comptent.
    { label: 'Courte durée', pattern: / (location saisonniere|courte duree|par nuit|par nuitee|a la nuitee|a la semaine) / },
    { label: 'Sous-location', pattern: / sous location / },
    { label: 'Pas un logement', pattern: /^ (terrain|parking|garage|box|cave|local|bureau) / },
  ],
};

const WORKS = / (travaux|a renover|renovation a prevoir|a rafraichir|a restaurer|a rehabiliter|a remettre au gout du jour|a moderniser|gros oeuvre) /;
/** « Sans travaux », « travaux récents » : le mot est là, les travaux non. */
const NO_WORKS = / (sans travaux|aucun travaux|pas de travaux|travaux (recents|realises|effectues|termines)|refait a neuf|entierement renove|renove recemment) /;
const RENTED = / (vendu loue|vente occupee|locataire en place|bail en cours) /;

/** Une annonce telle que la base la conserve, description comprise. */
export type ImmoAdInput = Omit<ImmoAdView, 'perM2' | 'flags' | 'tags'> & { body?: string | null };

/**
 * Prépare les annonces pour la comparaison : prix au m², annonces à part
 * signalées, raisons d'un prix relevées. Appliqué à la lecture : les données
 * collectées restent telles que le site les a publiées. La description,
 * lue ici, ne part pas vers l'écran.
 */
export function describe(ads: ImmoAdInput[], transaction: Transaction): ImmoAdView[] {
  return ads.map(({ body, ...ad }) => {
    const title = words(ad.title);
    const text = words(`${ad.title} ${body ?? ''}`);
    // Le type de bien se lit au début du titre : une description qui parle
    // de son garage ne fait pas d'une maison un garage.
    const flags = FLAGS[transaction]
      .filter((flag) => (flag.label === 'Pas un logement' ? flag.pattern.test(title) : flag.pattern.test(text)))
      .map((flag) => flag.label);
    const tags: string[] = [];
    if (WORKS.test(text) && !NO_WORKS.test(text)) tags.push('Travaux');
    if (ad.isNew) tags.push('Neuf');
    if (transaction === 'vente' && RENTED.test(text)) tags.push('Vendu loué');
    if (transaction === 'location' && ad.furnished) tags.push('Meublé');
    if (ad.propertyType !== 'maison' && ad.floor === 0) tags.push('Rez-de-chaussée');
    return {
      ...ad,
      perM2: ad.surface ? roundPerM2(ad.price / ad.surface, transaction) : null,
      flags,
      tags,
    };
  });
}

// ---------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------

/**
 * Quantile sans arrondi : un loyer au m² se lit au dixième d'euro (12,4 €),
 * l'arrondir à l'euro effacerait la moitié des écarts. On arrondit à
 * l'affichage, selon ce qu'on mesure.
 */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

type Measured = ImmoAdView & { surface: number; perM2: number };

/**
 * Écarte ce qui n'est pas un logement au prix du marché : annonces signalées
 * (viager, enchères…), biens sans surface — qu'on ne peut pas ramener au m² —,
 * prix d'appel et fautes de frappe. Un facteur 2,5 de part et d'autre du prix
 * au m² médian laisse passer toute la diversité réelle d'une ville.
 */
export function plausible(
  ads: ImmoAdView[],
  transaction: Transaction,
): { kept: Measured[]; excluded: number; flagged: number; unmeasured: number } {
  const clean = ads.filter((ad) => !ad.flags?.length);
  const flagged = ads.length - clean.length;
  const measured = clean.filter((ad): ad is Measured => ad.surface !== null && ad.perM2 !== null);
  const unmeasured = clean.length - measured.length;
  const priced = measured.filter((ad) => ad.price >= MIN_PRICE[transaction]);
  if (!priced.length) return { kept: [], excluded: measured.length, flagged, unmeasured };
  const reference = median(priced.map((ad) => ad.perM2));
  const kept = priced.filter((ad) => ad.perM2 >= reference / 2.5 && ad.perM2 <= reference * 2.5);
  return { kept, excluded: measured.length - kept.length, flagged, unmeasured };
}

/** Nombre de pièces regroupé : au-delà de cinq, les biens sont trop rares pour être séparés. */
export function roomsGroup(rooms: number | null | undefined): string {
  if (!rooms) return 'Non précisé';
  if (rooms >= 5) return '5 pièces et +';
  return rooms === 1 ? '1 pièce' : `${rooms} pièces`;
}

/** Classes du DPE regroupées comme on les lit : économes, moyennes, passoires. */
export function energyGroup(energy: string | null | undefined): string {
  if (!energy) return 'DPE inconnu';
  if ('ABC'.includes(energy)) return 'A à C';
  if ('DE'.includes(energy)) return 'D et E';
  return 'F et G';
}

/** Prix au m² arrondi à ce qui a un sens : le dixième d'euro pour un loyer, la dizaine pour une vente. */
export function roundPerM2(value: number, transaction: Transaction): number {
  return transaction === 'location' ? Math.round(value * 10) / 10 : Math.round(value / 10) * 10;
}

// ---------------------------------------------------------------------------
// Comparables
// ---------------------------------------------------------------------------

export interface ImmoTarget {
  surface: number;
  rooms: number | null;
}

function matches(target: ImmoTarget, candidate: Measured, level: Level): boolean {
  const tolerance = Math.max(level.floor, level.share * target.surface);
  if (Math.abs(candidate.surface - target.surface) > tolerance) return false;
  if (level.sameRooms && target.rooms !== null && candidate.rooms !== null) {
    if (Math.min(candidate.rooms, 5) !== Math.min(target.rooms, 5)) return false;
  }
  return true;
}

/** Plus c'est petit, plus le bien ressemble à la cible. */
function distance(target: ImmoTarget, candidate: Measured): number {
  const size = Math.abs(candidate.surface - target.surface) / target.surface;
  const rooms = target.rooms !== null && candidate.rooms !== null && candidate.rooms !== target.rooms ? 0.5 : 0;
  return size * 4 + rooms;
}

export interface ImmoEstimate {
  count: number;
  /** Valeur du bien : prix au m² médian de ses comparables, rapporté à sa surface. */
  value: number;
  low: number;
  high: number;
  perM2: { median: number; p25: number; p75: number };
  /** Ce qu'on a dû tolérer pour réunir assez de biens comparables. */
  tolerance: { surface: number; sameRooms: boolean };
  comparables: (Measured & { distance: number })[];
}

/**
 * Valeur d'un bien précis, d'après ceux qui lui ressemblent le plus. Null
 * quand il n'y en a pas assez, même en élargissant : mieux vaut ne rien dire
 * qu'annoncer un prix sur deux annonces.
 */
export function estimate(
  target: ImmoTarget,
  pool: Measured[],
  transaction: Transaction,
  excludeId?: string,
): ImmoEstimate | null {
  const candidates = pool.filter((ad) => ad.lbcId !== excludeId);

  for (const level of LEVELS) {
    const found = candidates.filter((ad) => matches(target, ad, level));
    if (found.length < MIN_COMPARABLES + 1 && level !== LEVELS[LEVELS.length - 1]) continue;
    if (found.length < MIN_COMPARABLES) return null;

    const perM2 = found.map((ad) => ad.perM2).sort((a, b) => a - b);
    const mid = quantile(perM2, 0.5);
    const p25 = quantile(perM2, 0.25);
    const p75 = quantile(perM2, 0.75);
    // Un prix au millier d'euros près, un loyer à cinq euros : au-delà, la
    // précision affichée serait fausse.
    const round = (value: number) =>
      transaction === 'location' ? Math.round(value / 5) * 5 : Math.round(value / 1000) * 1000;
    return {
      count: found.length,
      value: round(mid * target.surface),
      low: round(p25 * target.surface),
      high: round(p75 * target.surface),
      perM2: {
        median: roundPerM2(mid, transaction),
        p25: roundPerM2(p25, transaction),
        p75: roundPerM2(p75, transaction),
      },
      tolerance: {
        surface: Math.round(Math.max(level.floor, level.share * target.surface)),
        sameRooms: level.sameRooms && target.rooms !== null,
      },
      comparables: found
        .map((ad) => ({ ...ad, distance: distance(target, ad) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 12),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lecture d'ensemble d'un marché
// ---------------------------------------------------------------------------

/** Écart de prix au m² entre deux familles de biens, quand chacune est assez nombreuse. */
export interface Gap {
  /** Prix au m² médian de la famille mise en avant (passoires, neuf). */
  value: number;
  /** Celui de la famille de référence. */
  reference: number;
  /** Écart relatif : négatif quand la famille mise en avant est moins chère. */
  ratio: number;
  count: number;
  referenceCount: number;
}

export interface ImmoAnalysis {
  count: number;
  /** Prix aberrants écartés. */
  excluded: number;
  /** Annonces à part, hors calculs : viager, enchères, colocation… */
  flagged: number;
  /** Sans surface : impossibles à ramener au m². */
  unmeasured: number;
  median: number;
  p25: number;
  p75: number;
  perM2: { median: number; p25: number; p75: number };
  surface: { median: number; min: number; max: number };
  /** Prix par nombre de pièces, des plus petits aux plus grands. */
  rooms: { name: string; count: number; median: number; perM2: number }[];
  /** Prix au m² par classe du DPE, de A à G. */
  energy: { name: string; count: number; perM2: number }[];
  /** Décote des passoires (F, G) face aux logements économes (A à D). */
  energyGap: Gap | null;
  /** Écart du neuf face à l'ancien. */
  newGap: Gap | null;
  /** Prix médian par tranche de surface : la courbe du marché. */
  trend: { surface: number; price: number; count: number }[];
  /** Annonces nettement sous le prix au m² de leurs propres comparables. */
  deals: (Measured & { reference: number; referencePerM2: number; gap: number; ratio: number; comparables: number })[];
}

export function analyze(ads: ImmoAdView[], transaction: Transaction): ImmoAnalysis | null {
  const { kept, excluded, flagged, unmeasured } = plausible(ads, transaction);
  if (kept.length < MIN_COMPARABLES) return null;

  const prices = kept.map((ad) => ad.price).sort((a, b) => a - b);
  const perM2 = kept.map((ad) => ad.perM2).sort((a, b) => a - b);
  const surfaces = kept.map((ad) => ad.surface).sort((a, b) => a - b);

  const byRooms = new Map<number, Measured[]>();
  for (const ad of kept) {
    if (!ad.rooms) continue;
    const key = Math.min(ad.rooms, 5);
    byRooms.set(key, [...(byRooms.get(key) ?? []), ad]);
  }
  const byEnergy = new Map<string, number[]>();
  for (const ad of kept) {
    if (!ad.energy) continue;
    byEnergy.set(ad.energy, [...(byEnergy.get(ad.energy) ?? []), ad.perM2]);
  }

  return {
    count: kept.length,
    excluded,
    flagged,
    unmeasured,
    median: Math.round(quantile(prices, 0.5)),
    p25: Math.round(quantile(prices, 0.25)),
    p75: Math.round(quantile(prices, 0.75)),
    perM2: {
      median: roundPerM2(quantile(perM2, 0.5), transaction),
      p25: roundPerM2(quantile(perM2, 0.25), transaction),
      p75: roundPerM2(quantile(perM2, 0.75), transaction),
    },
    surface: { median: Math.round(quantile(surfaces, 0.5)), min: surfaces[0], max: surfaces[surfaces.length - 1] },
    rooms: [...byRooms.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rooms, list]) => ({
        name: roomsGroup(rooms),
        count: list.length,
        median: Math.round(median(list.map((ad) => ad.price))),
        perM2: roundPerM2(median(list.map((ad) => ad.perM2)), transaction),
      })),
    energy: [...byEnergy.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, list]) => ({ name, count: list.length, perM2: roundPerM2(median(list), transaction) })),
    energyGap: gap(
      kept.filter((ad) => ad.energy === 'F' || ad.energy === 'G'),
      kept.filter((ad) => ad.energy !== null && 'ABCD'.includes(ad.energy)),
      transaction,
    ),
    newGap: gap(
      kept.filter((ad) => ad.isNew === true),
      kept.filter((ad) => ad.isNew === false),
      transaction,
    ),
    trend: trendOf(kept),
    deals: dealsOf(kept, transaction),
  };
}

/**
 * Écart entre deux familles de biens. Le prix au m² dépend de la taille :
 * on compare donc chaque bien mis en avant à des biens de référence de
 * surface proche, puis on prend la médiane des écarts — sans quoi des
 * passoires plus grandes passeraient pour moins chères au m² par leur seule
 * taille.
 */
function gap(subject: Measured[], references: Measured[], transaction: Transaction): Gap | null {
  if (subject.length < 5 || references.length < 5) return null;
  const ratios: number[] = [];
  for (const ad of subject) {
    const peers = references.filter((other) => matches(ad, other, LEVELS[2]));
    if (peers.length < 3) continue;
    const reference = median(peers.map((peer) => peer.perM2));
    ratios.push((ad.perM2 - reference) / reference);
  }
  if (ratios.length < 3) return null;
  return {
    value: roundPerM2(median(subject.map((ad) => ad.perM2)), transaction),
    reference: roundPerM2(median(references.map((ad) => ad.perM2)), transaction),
    ratio: medianRatio(ratios),
    count: subject.length,
    referenceCount: references.length,
  };
}

function medianRatio(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
}

function trendOf(ads: Measured[]): ImmoAnalysis['trend'] {
  if (ads.length < 8) return [];
  const sizes = ads.map((ad) => ad.surface);
  const low = Math.min(...sizes);
  const high = Math.max(...sizes);
  const bins = 8;
  const width = (high - low) / bins || 1;

  const points: ImmoAnalysis['trend'] = [];
  for (let i = 0; i < bins; i += 1) {
    const from = low + i * width;
    const to = i === bins - 1 ? high + 1 : from + width;
    const inside = ads.filter((ad) => ad.surface >= from && ad.surface < to);
    // Une tranche de deux biens dessinerait du bruit, pas une tendance.
    if (inside.length < 3) continue;
    points.push({
      surface: Math.round(from + width / 2),
      price: Math.round(median(inside.map((ad) => ad.price))),
      count: inside.length,
    });
  }
  return points;
}

function dealsOf(ads: Measured[], transaction: Transaction): ImmoAnalysis['deals'] {
  const deals: ImmoAnalysis['deals'] = [];
  const level = LEVELS[1];

  for (const ad of ads) {
    const peers = ads.filter((other) => other.lbcId !== ad.lbcId && matches(ad, other, level));
    if (peers.length < MIN_COMPARABLES) continue;

    const referencePerM2 = median(peers.map((peer) => peer.perM2));
    if (ad.perM2 <= referencePerM2 * DEAL_RATIO) {
      const reference = Math.round(referencePerM2 * ad.surface);
      deals.push({
        ...ad,
        reference,
        referencePerM2: roundPerM2(referencePerM2, transaction),
        gap: reference - ad.price,
        ratio: (referencePerM2 - ad.perM2) / referencePerM2,
        comparables: peers.length,
      });
    }
  }

  return deals.sort((a, b) => b.ratio - a.ratio).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Recherche et rendement
// ---------------------------------------------------------------------------

/**
 * Fourchette de surface relevée autour du bien à situer : assez large pour
 * voir comment le prix au m² évolue avec la taille, assez serrée pour rester
 * dans le même marché (un studio et un cinq pièces ne se vendent pas aux
 * mêmes personnes).
 */
export function searchBand(surface: number | null): { min: number | null; max: number | null } {
  if (!surface) return { min: null, max: null };
  return { min: Math.max(9, Math.round(surface * 0.65)), max: Math.round(surface * 1.5) };
}

/**
 * Rendement locatif brut : douze mois de loyer rapportés au prix d'achat, au
 * m² l'un et l'autre pour comparer des biens de même taille.
 */
export function grossYield(salePerM2: number, rentPerM2: number): number | null {
  if (!salePerM2 || !rentPerM2) return null;
  return (rentPerM2 * 12) / salePerM2;
}
