/**
 * Signaux sur une annonce : ce qu'il faut vérifier avant d'acheter, et ce qui
 * rassure. Des faits, pas une note : chaque signal dit ce qu'il a vu.
 *
 * - prix anormalement bas face aux comparables : le profil classique des
 *   arnaques ;
 * - kilométrage incohérent avec l'âge ;
 * - annonce republiée : la même voiture disparue puis revenue sous un autre
 *   numéro, pour paraître neuve — un argument de négociation autant qu'une
 *   alerte ;
 * - mots de la description : « sans CT », « à revoir »… ou « carnet »,
 *   « factures ».
 *
 * Fonctions pures, sans base.
 */

export type SignalLevel = 'danger' | 'attention' | 'positive';

export interface Signal {
  level: SignalLevel;
  /** Court, pour un badge. */
  label: string;
  /** Ce qui a été vu, en une phrase. */
  detail: string;
}

export interface SignalAd {
  lbcId: string;
  price: number;
  km: number | null;
  year: number | null;
  version: string | null;
  title: string;
  description?: string | null;
  firstSeenAt?: Date | string | null;
}

export interface GoneAd {
  lbcId: string;
  price: number;
  km: number | null;
  year: number | null;
  version: string | null;
  goneAt: Date | string;
}

const DAY = 24 * 60 * 60 * 1000;

import { SUSPICIOUS_RATIO } from './estimation';

const WORDS: { level: SignalLevel; label: string; pattern: RegExp }[] = [
  {
    level: 'danger',
    label: 'Contrôle technique',
    pattern: /\b(sans ct|pas de ct|ct (a|à) (faire|refaire|passer)|ct refuse|contre[- ]visite)\b/,
  },
  {
    level: 'danger',
    label: 'Mécanique à revoir',
    pattern:
      /\b(moteur (a|à) (revoir|refaire)|boite (a|à) (revoir|refaire)|joint de culasse|non roulante?|ne demarre (pas|plus)|casse moteur|pour pieces)\b/,
  },
  {
    level: 'attention',
    label: 'Frais à prévoir',
    pattern:
      /\b((a|à) prevoir|embrayage (a|à) (faire|changer|revoir)|distribution (a|à) faire|fuite|voyant|bruit|claquement|a reprendre|rayures?|choc|bosse)\b/,
  },
  {
    level: 'attention',
    label: 'Vente de marchand',
    pattern: /\b(marchand|export|vendu en l etat|sans garantie|prix marchand)\b/,
  },
  {
    level: 'positive',
    label: 'Entretien suivi',
    pattern:
      /\b(carnet( d entretien)? (complet|a jour|tamponne|a l appui)|historique (complet|d entretien)|toutes? (les )?factures|factures (a l appui|disponibles)|entretien (complet|suivi|regulier|reseau|concession|constructeur|chez))\b/,
  },
  { level: 'positive', label: 'Première main', pattern: /\b(premiere main|1ere main|1 ere main|1re main)\b/ },
  { level: 'positive', label: 'CT vierge', pattern: /\b(ct (ok|vierge|rien a signaler|sans defaut)|controle technique (ok|vierge))\b/ },
  { level: 'positive', label: 'Garantie', pattern: /\bgarantie (de )?\d+ ?mois\b/ },
];

export function signalsFor(
  ad: SignalAd,
  context: { median?: number | null; gone?: GoneAd[]; live?: SignalAd[]; now?: Date } = {},
): Signal[] {
  const now = context.now ?? new Date();
  const signals: Signal[] = [];

  if (context.median && ad.price < context.median * SUSPICIOUS_RATIO) {
    const share = Math.round((1 - ad.price / context.median) * 100);
    signals.push({
      level: 'danger',
      label: 'Prix anormalement bas',
      detail: `${share} % sous ses comparables : profil fréquent des arnaques (vendeur injoignable, paiement à distance, voiture « à l'étranger »). Ne rien verser avant d'avoir vu la voiture et ses papiers.`,
    });
  }

  if (ad.km !== null && ad.year !== null) {
    const age = Math.max(1, now.getFullYear() - ad.year);
    const perYear = Math.round(ad.km / age);
    if (age >= 8 && perYear < 3_000) {
      signals.push({
        level: 'attention',
        label: 'Très peu de km',
        detail: `${perYear.toLocaleString('fr-FR')} km par an en moyenne : kilométrage à prouver (factures, contrôles techniques successifs).`,
      });
    } else if (perYear > 35_000) {
      signals.push({
        level: 'attention',
        label: 'Gros rouleur',
        detail: `${perYear.toLocaleString('fr-FR')} km par an en moyenne : usure d'usage intensif à vérifier (embrayage, trains roulants).`,
      });
    }
  }

  const twin = context.gone?.find((other) => sameCar(ad, other) && seenAfter(ad, other));
  if (twin) {
    const difference = twin.price - ad.price;
    signals.push({
      level: 'attention',
      label: 'Republiée',
      detail: `Une annonce identique (même motorisation, même année, même kilométrage) a disparu le ${shortDate(twin.goneAt)} à ${euros(twin.price)}${
        difference > 0 ? `, ${euros(difference)} plus cher` : difference < 0 ? `, ${euros(-difference)} moins cher` : ''
      } : la voiture est probablement en vente depuis plus longtemps qu'il n'y paraît.`,
    });
  }
  const duplicate = context.live?.find((other) => other.lbcId !== ad.lbcId && sameCar(ad, other));
  if (duplicate && !twin) {
    signals.push({
      level: 'attention',
      label: 'Doublon',
      detail: `Une autre annonce en ligne décrit la même voiture (même motorisation, année et kilométrage), à ${euros(duplicate.price)}.`,
    });
  }

  const text = words(`${ad.title} ${ad.description ?? ''}`);
  for (const word of WORDS) {
    const match = text.match(word.pattern);
    if (match) {
      signals.push({ level: word.level, label: word.label, detail: `L'annonce mentionne « ${match[0]} ».` });
    }
  }
  return signals;
}

/** Même motorisation, même année, kilométrage à 1 % ou 1 500 km près. */
function sameCar(a: { km: number | null; year: number | null; version: string | null }, b: { km: number | null; year: number | null; version: string | null }): boolean {
  if (a.km === null || b.km === null || a.year === null || a.year !== b.year) return false;
  if (a.version && b.version && a.version !== b.version) return false;
  return Math.abs(a.km - b.km) <= Math.max(1_500, a.km * 0.01);
}

/** L'annonce actuelle est apparue après (ou juste avant) la disparition de l'autre. */
function seenAfter(ad: SignalAd, gone: GoneAd): boolean {
  if (!ad.firstSeenAt) return true;
  return new Date(ad.firstSeenAt).getTime() >= new Date(gone.goneAt).getTime() - 3 * DAY;
}

function words(text: string): string {
  return ` ${text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

function euros(value: number): string {
  return `${Math.round(value).toLocaleString('fr-FR')} €`;
}

function shortDate(value: Date | string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(new Date(value));
}
