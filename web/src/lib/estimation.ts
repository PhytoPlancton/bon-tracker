/**
 * Cote d'un modèle à partir des annonces du marché.
 *
 * Tout repose sur une idée : deux voitures ne se comparent que si elles ont la
 * même motorisation, des années proches et des kilométrages proches. Le reste
 * — médiane, bonnes affaires, estimation d'une voiture donnée — découle de
 * cette définition, écrite une seule fois ici.
 *
 * Fonctions pures : aucune dépendance à la base, pour pouvoir servir aussi
 * bien côté serveur que dans les tests.
 */

export interface Ad {
  lbcId: string;
  title: string;
  url: string;
  price: number;
  km: number | null;
  year: number | null;
  /** Motorisation, une fois ramenée à son moteur par `harmonize`. */
  version: string | null;
  location: string | null;
  imageUrl?: string | null;
  sellerType?: 'pro' | 'private' | null;
  gearbox?: string | null;
  fuel?: string | null;
  /** La motorisation vient du titre, faute d'être renseignée. */
  versionGuessed?: boolean;
  /** Ce qui rend l'annonce incomparable : volant à droite, accident, panne. */
  flags?: string[];
  /** Mise en ligne d'après le site, ou à défaut première fois vue. */
  onlineSince?: Date | string | null;
}

/** Sous ce prix, c'est une pièce, une épave ou un prix d'appel. */
const MIN_PRICE = 500;

/** Nettement sous ses comparables : 15 % de moins que leur médiane. */
const DEAL_RATIO = 0.85;

/** En deçà, une médiane de comparables ne veut rien dire. */
const MIN_COMPARABLES = 4;

/**
 * Tolérances successives pour trouver des voitures comparables : on part
 * serré et on n'élargit que faute de mieux, en disant jusqu'où on est allé.
 */
const LEVELS = [
  { years: 1, kmShare: 0.15, kmFloor: 15_000, sameVersion: true },
  { years: 2, kmShare: 0.25, kmFloor: 25_000, sameVersion: true },
  { years: 3, kmShare: 0.4, kmFloor: 40_000, sameVersion: true },
  { years: 3, kmShare: 0.4, kmFloor: 40_000, sameVersion: false },
] as const;

type Level = (typeof LEVELS)[number];

// ---------------------------------------------------------------------------
// Lecture des caractéristiques
// ---------------------------------------------------------------------------

const FUEL: Record<string, string> = {
  '1': 'Essence',
  '2': 'Diesel',
  '3': 'GPL',
  '4': 'Électrique',
  '6': 'Hybride',
};
const GEARBOX: Record<string, string> = { '1': 'Manuelle', '2': 'Automatique' };

/**
 * Ramène les caractéristiques publiées à des champs exploitables. Les deux
 * lectures du collecteur nomment différemment les mêmes choses —
 * « mileage » ou « kilometrage », « regdate » ou « annee » — d'où les replis.
 */
export function readSpecs(attributes: Record<string, string> = {}) {
  const km = wholeNumber(attributes.mileage ?? attributes.kilometrage);
  const year =
    yearOf(attributes.regdate) ?? yearOf(attributes.annee) ?? yearOf(attributes.issuance_date);

  const fuelCode = attributes.fuel;
  const gearCode = attributes.gearbox;

  return {
    km: km !== null && km <= 2_000_000 ? km : null,
    year,
    version: clean(attributes.u_car_version ?? attributes.u_car_version_label),
    fuel: clean(attributes.fuel_label ?? attributes.energie ?? (fuelCode ? FUEL[fuelCode] : undefined)),
    gearbox: clean(
      attributes.gearbox_label ?? attributes.boite_de_vitesse ?? (gearCode ? GEARBOX[gearCode] : undefined),
    ),
    brandCode: clean(attributes.u_car_brand),
    modelCode: clean(attributes.u_car_model),
  };
}

function wholeNumber(value?: string): number | null {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function yearOf(value?: string): number | null {
  const match = value?.match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function clean(value?: string | null): string | null {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text : null;
}

// ---------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  return Math.round(sorted[low] + (sorted[high] - sorted[low]) * (position - low));
}

function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

/**
 * Écarte ce qui n'est pas une voiture à vendre au prix du marché : pièces,
 * épaves, prix d'appel, fautes de frappe. Un facteur trois de part et d'autre
 * de la médiane laisse passer toute la diversité réelle d'un modèle.
 *
 * Les annonces signalées (volant à droite, accident, panne) sont mises à part :
 * leur prix est bas pour une raison qui ne concerne pas les autres voitures.
 */
export function plausible(ads: Ad[]): { kept: Ad[]; excluded: number; flagged: number } {
  const clean = ads.filter((ad) => !ad.flags?.length);
  const flagged = ads.length - clean.length;
  const priced = clean.filter((ad) => ad.price >= MIN_PRICE);
  if (!priced.length) return { kept: [], excluded: clean.length, flagged };
  const reference = median(priced.map((ad) => ad.price));
  const kept = priced.filter((ad) => ad.price >= reference / 3 && ad.price <= reference * 3);
  return { kept, excluded: clean.length - kept.length, flagged };
}

// ---------------------------------------------------------------------------
// Harmonisation
// ---------------------------------------------------------------------------

/** Boîtes automatiques telles que les versions les écrivent. */
const AUTOMATIC =
  /\b(tip ?tronic( s)?|pdk|bva\d*|bvr|dsg\d*|s ?tronic|edc\d*|eat\d*|dct|steptronic|multitronic|automatique|auto)\b/gi;

/**
 * Ramène une version publiée à son moteur. Le site préfixe souvent la
 * finition (« S_Cayman 3.4 S », « Base_Cayman 2.7 ») et mêle la boîte au
 * moteur (« Cayman 3.4 S TipTronic S ») : sans cela, un même moteur se
 * disperse en une douzaine d'entrées de deux ou trois annonces.
 */
export function engineOf(version: string | null | undefined): { engine: string | null; automatic: boolean } {
  if (!version) return { engine: null, automatic: false };
  const bare = version.includes('_') ? version.slice(version.lastIndexOf('_') + 1) : version;
  const automatic = new RegExp(AUTOMATIC.source, 'i').test(bare);
  const engine = bare.replace(AUTOMATIC, ' ').replace(/\s+/g, ' ').trim();
  return { engine: engine || null, automatic };
}

const FLAGS: { label: string; pattern: RegExp }[] = [
  { label: 'Volant à droite', pattern: /\b(rhd|conduite a droite|volant a droite|anglaise)\b/ },
  { label: 'Accidentée', pattern: /\b(accidentee?|sinistree?|vge|vei|epave)\b/ },
  { label: 'Moteur HS / pour pièces', pattern: /\b(moteur hs|moteur casse|hs|pour pieces|a restaurer)\b/ },
];

/**
 * Prépare les annonces d'un modèle pour la comparaison : moteur et boîte
 * séparés, moteur déduit du titre quand il manque, annonces à risque
 * signalées. Fonction pure, appliquée à la lecture : les données collectées
 * restent telles que le site les a publiées.
 */
export function harmonize(ads: Ad[]): Ad[] {
  const prepared = ads.map((ad) => {
    const { engine, automatic } = engineOf(ad.version);
    const title = words(ad.title);
    const flags = FLAGS.filter((flag) => flag.pattern.test(title)).map((flag) => flag.label);
    return { ...ad, version: engine, gearbox: normalizeGearbox(ad.gearbox, automatic), flags };
  });

  const engines = [...new Set(prepared.map((ad) => ad.version).filter((v): v is string => Boolean(v)))];
  const counts = new Map<string, number>();
  for (const ad of prepared) if (ad.version) counts.set(ad.version, (counts.get(ad.version) ?? 0) + 1);

  return prepared.map((ad) => {
    if (ad.version) return ad;
    const guess = guessEngine(ad.title, engines, counts);
    return guess ? { ...ad, version: guess, versionGuessed: true } : ad;
  });
}

function normalizeGearbox(value: string | null | undefined, automatic: boolean): string | null {
  if (automatic) return 'Automatique';
  if (!value) return null;
  return /auto/i.test(value) ? 'Automatique' : /manu/i.test(value) ? 'Manuelle' : value;
}

function words(text: string): string {
  return ` ${text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(\d)[.,](\d)/g, '$1.$2')
    // « 2,7L » ou « 245ch » : le chiffre se lit à part de son unité.
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim()} `;
}

/**
 * Retrouve le moteur dans le titre, parmi ceux que portent les autres
 * annonces du même modèle. Seuls comptent les mots qui distinguent un moteur
 * des autres — cylindrée, lettres de version — ; une cylindrée qui contredit
 * suffit à écarter un candidat, une égalité à ne rien conclure.
 */
function guessEngine(title: string, engines: string[], counts: Map<string, number>): string | null {
  if (!engines.length) return null;
  const text = words(title);
  const tokens = engines.map((engine) => words(engine).trim().split(' '));
  const shared = tokens.reduce((common, list) => common.filter((token) => list.includes(token)));
  const displacement = text.match(/ (\d\.\d) /)?.[1] ?? null;

  const scored = engines
    .map((engine, index) => {
      const own = tokens[index].filter((token) => !shared.includes(token));
      const cc = own.find((token) => /^\d\.\d$/.test(token)) ?? null;
      if (displacement && cc && cc !== displacement) return null;
      const score = own.filter((token) => text.includes(` ${token} `)).length;
      return { engine, score, size: own.length, count: counts.get(engine) ?? 0 };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null && item.score > 0)
    .sort((a, b) => b.score - a.score || a.size - b.size || b.count - a.count);

  if (!scored.length) return null;
  const [best, second] = scored;
  if (second && second.score === best.score && second.size === best.size) return null;
  return best.engine;
}

// ---------------------------------------------------------------------------
// Comparables
// ---------------------------------------------------------------------------

export interface Target {
  km: number | null;
  year: number | null;
  version: string | null;
}

function matches(target: Target, candidate: Ad, level: Level): boolean {
  if (level.sameVersion && target.version && candidate.version !== target.version) return false;
  if (target.year !== null && candidate.year !== null) {
    if (Math.abs(target.year - candidate.year) > level.years) return false;
  } else if (target.year !== null) {
    return false;
  }
  if (target.km !== null && candidate.km !== null) {
    const tolerance = Math.max(level.kmFloor, level.kmShare * target.km);
    if (Math.abs(target.km - candidate.km) > tolerance) return false;
  } else if (target.km !== null) {
    return false;
  }
  return true;
}

/** Plus c'est petit, plus la voiture ressemble à la cible. */
function distance(target: Target, candidate: Ad): number {
  const years = target.year !== null && candidate.year !== null ? Math.abs(target.year - candidate.year) : 3;
  const km = target.km !== null && candidate.km !== null ? Math.abs(target.km - candidate.km) : 50_000;
  const version = target.version && candidate.version !== target.version ? 2 : 0;
  return years / 2 + km / 30_000 + version;
}

export interface Estimate {
  count: number;
  median: number;
  p25: number;
  p75: number;
  /** Ce qu'on a dû tolérer pour réunir assez de voitures comparables. */
  tolerance: { years: number; km: number; sameVersion: boolean };
  comparables: (Ad & { distance: number })[];
}

/**
 * Prix d'une voiture précise, d'après celles qui lui ressemblent le plus.
 * Null quand il n'y en a pas assez, même en élargissant : mieux vaut ne rien
 * dire qu'annoncer un prix sur deux voitures.
 */
export function estimate(target: Target, pool: Ad[], excludeId?: string): Estimate | null {
  const candidates = pool.filter((ad) => ad.lbcId !== excludeId);

  for (const level of LEVELS) {
    const found = candidates.filter((ad) => matches(target, ad, level));
    if (found.length < MIN_COMPARABLES + 1 && level !== LEVELS[LEVELS.length - 1]) continue;
    if (found.length < MIN_COMPARABLES) return null;

    const prices = found.map((ad) => ad.price).sort((a, b) => a - b);
    return {
      count: found.length,
      median: quantile(prices, 0.5),
      p25: quantile(prices, 0.25),
      p75: quantile(prices, 0.75),
      tolerance: {
        years: level.years,
        km: target.km !== null ? Math.round(Math.max(level.kmFloor, level.kmShare * target.km)) : 0,
        sameVersion: level.sameVersion && Boolean(target.version),
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
// Lecture d'ensemble d'un modèle
// ---------------------------------------------------------------------------

export interface Analysis {
  count: number;
  excluded: number;
  /** Annonces à risque mises à part : volant à droite, accident, panne. */
  flagged: number;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
  yearMin: number | null;
  yearMax: number | null;
  /** Motorisations présentes, les plus courantes d'abord. */
  versions: { name: string; count: number; median: number }[];
  /** Médiane des prix par tranche de kilométrage : la courbe du marché. */
  trend: { km: number; price: number; count: number }[];
  /** Annonces nettement sous le prix de leurs propres comparables. */
  deals: (Ad & { reference: number; gap: number; ratio: number; comparables: number })[];
}

export function analyze(ads: Ad[]): Analysis | null {
  const { kept, excluded, flagged } = plausible(ads);
  if (kept.length < MIN_COMPARABLES) return null;

  const prices = kept.map((ad) => ad.price).sort((a, b) => a - b);
  const years = kept.map((ad) => ad.year).filter((y): y is number => y !== null);

  const versionPrices = new Map<string, number[]>();
  for (const ad of kept) {
    const name = ad.version ?? 'Non précisée';
    versionPrices.set(name, [...(versionPrices.get(name) ?? []), ad.price]);
  }

  return {
    count: kept.length,
    excluded,
    flagged,
    median: quantile(prices, 0.5),
    p25: quantile(prices, 0.25),
    p75: quantile(prices, 0.75),
    min: prices[0],
    max: prices[prices.length - 1],
    yearMin: years.length ? Math.min(...years) : null,
    yearMax: years.length ? Math.max(...years) : null,
    versions: [...versionPrices.entries()]
      .map(([name, list]) => ({ name, count: list.length, median: median(list) }))
      .sort((a, b) => b.count - a.count),
    trend: trendOf(kept),
    deals: dealsOf(kept, [...kept, ...suspects(ads)]),
  };
}

function trendOf(ads: Ad[]): Analysis['trend'] {
  const withKm = ads.filter((ad) => ad.km !== null) as (Ad & { km: number })[];
  if (withKm.length < 8) return [];

  const kms = withKm.map((ad) => ad.km);
  const low = Math.min(...kms);
  const high = Math.max(...kms);
  const bins = 8;
  const width = (high - low) / bins || 1;

  const points: Analysis['trend'] = [];
  for (let i = 0; i < bins; i += 1) {
    const from = low + i * width;
    const to = i === bins - 1 ? high + 1 : from + width;
    const inside = withKm.filter((ad) => ad.km >= from && ad.km < to);
    // Une tranche de deux voitures dessinerait du bruit, pas une tendance.
    if (inside.length < 3) continue;
    points.push({
      km: Math.round(from + width / 2),
      price: median(inside.map((ad) => ad.price)),
      count: inside.length,
    });
  }
  return points;
}

/**
 * Affaires : les candidates (y compris les prix suspects, à vérifier mais à
 * montrer) jugées face aux seules comparables saines.
 */
function dealsOf(ads: Ad[], candidates: Ad[] = ads): Analysis['deals'] {
  const deals: Analysis['deals'] = [];
  const level = LEVELS[1];

  for (const ad of candidates) {
    // Sans moteur connu, l'annonce se comparerait à toutes les motorisations
    // à la fois : une 2.7 passerait pour une affaire face aux 3.4 S.
    if (ad.km === null || ad.year === null || !ad.version) continue;
    const peers = ads.filter((other) => other.lbcId !== ad.lbcId && matches(ad, other, level));
    if (peers.length < MIN_COMPARABLES) continue;

    const reference = median(peers.map((peer) => peer.price));
    if (ad.price <= reference * DEAL_RATIO) {
      deals.push({
        ...ad,
        reference,
        gap: reference - ad.price,
        ratio: (reference - ad.price) / reference,
        comparables: peers.length,
      });
    }
  }

  return deals.sort((a, b) => b.ratio - a.ratio).slice(0, 10);
}

/** Sous 60 % de ses comparables, une voiture n'est plus une affaire mais une question. */
export const SUSPICIOUS_RATIO = 0.6;
export const SUSPICIOUS_FLAG = 'Prix anormalement bas';

/**
 * Harmonise, puis met à part les prix anormalement bas face à leurs propres
 * comparables : le profil des arnaques. Comme une annonce à risque, elle reste
 * visible mais ne compte plus dans aucun calcul — sans quoi deux annonces
 * piégées suffisent à fausser la cote d'une voiture voisine.
 */
export function screen(ads: Ad[]): Ad[] {
  const harmonized = harmonize(ads);
  const { kept } = plausible(harmonized);
  const keptIds = new Set(kept.map((ad) => ad.lbcId));
  return harmonized.map((ad) => {
    // Une épave hors de la fourchette du modèle est déjà écartée pour ce qu'elle est.
    if (!keptIds.has(ad.lbcId) || ad.km === null || ad.year === null) return ad;
    const peers = estimate({ km: ad.km, year: ad.year, version: ad.version }, kept, ad.lbcId);
    return peers && ad.price < peers.median * SUSPICIOUS_RATIO
      ? { ...ad, flags: [...(ad.flags ?? []), SUSPICIOUS_FLAG] }
      : ad;
  });
}

/**
 * Les annonces mises à part pour leur seul prix suspect : exclues des
 * comparables, mais toujours candidates aux affaires — une vraie bonne
 * affaire à −45 % existe, signalée comme telle.
 */
export function suspects(ads: Ad[]): Ad[] {
  return ads.filter((ad) => ad.flags?.length === 1 && ad.flags[0] === SUSPICIOUS_FLAG);
}
