/**
 * Fiche de négociation d'une annonce.
 *
 * Trois prix, et ce qui les justifie :
 * - le plafond, au-delà duquel la voiture coûte plus que ses équivalentes ;
 * - la cible, ce qu'on peut raisonnablement obtenir ;
 * - l'offre d'ouverture, un peu en dessous, pour laisser au vendeur de quoi
 *   « gagner » la discussion.
 *
 * La marge dépend de faits vérifiables, jamais d'une intuition : l'écart aux
 * comparables, le temps passé en ligne, les baisses déjà consenties, le type
 * de vendeur. Chaque fait devient un argument présentable au vendeur.
 * Fonctions pures, sans base : les tests les exercent telles quelles.
 */
import { estimate, plausible, type Ad, type Estimate } from './estimation';

export interface PriceStep {
  price: number;
  at: string | Date;
}

export interface SheetInput {
  ad: Ad;
  /** Annonces du même modèle, déjà harmonisées. */
  pool: Ad[];
  history: PriceStep[];
  now?: Date;
}

export interface Argument {
  /** Ce qu'on avance, en une phrase. */
  text: string;
  /** Poids dans la discussion : fort, utile, ou simple contexte. */
  weight: 'strong' | 'useful' | 'context';
}

export interface Sheet {
  fair: Estimate | null;
  /** Écart du prix demandé à la médiane des comparables (0.08 = 8 % au-dessus). */
  position: number | null;
  verdict: 'above' | 'market' | 'below' | 'unknown';
  daysOnline: number | null;
  /** Âge médian des annonces du modèle, pour situer « depuis longtemps ». */
  typicalDays: number | null;
  drops: { from: number; to: number; at: string }[];
  /** Marge de négociation retenue, en part du prix (0.06 = 6 %). */
  room: number;
  opening: number | null;
  target: number | null;
  ceiling: number | null;
  arguments: Argument[];
  /** Comparables moins chères, à citer au vendeur. */
  cheaper: Ad[];
  /** Points à vérifier avant tout : volant à droite, accident… */
  warnings: string[];
  message: string;
}

const DAY = 24 * 60 * 60 * 1000;

/** Marge d'usage sur une voiture d'occasion, avant tout autre fait. */
const BASE_ROOM = { private: 0.06, pro: 0.04, unknown: 0.05 } as const;

export function buildSheet({ ad, pool, history, now = new Date() }: SheetInput): Sheet {
  const peers = plausible(pool.filter((other) => other.lbcId !== ad.lbcId)).kept;

  // Même boîte d'abord : une automatique ne se négocie pas au prix d'une
  // manuelle. Faute de comparables suffisants, toutes boîtes confondues.
  const sameGearbox = ad.gearbox ? peers.filter((other) => other.gearbox === ad.gearbox) : peers;
  const target = { km: ad.km, year: ad.year, version: ad.version, power: ad.power, fuel: ad.fuel };
  const fair = (ad.gearbox ? estimate(target, sameGearbox) : null) ?? estimate(target, peers);

  const position = fair ? (ad.price - fair.median) / fair.median : null;
  const verdict: Sheet['verdict'] =
    position === null ? 'unknown' : position > 0.05 ? 'above' : position < -0.05 ? 'below' : 'market';

  const since = ad.onlineSince ? new Date(ad.onlineSince) : null;
  const daysOnline = since && !Number.isNaN(since.getTime()) ? Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY)) : null;
  const ages = peers
    .map((other) => (other.onlineSince ? (now.getTime() - new Date(other.onlineSince).getTime()) / DAY : null))
    .filter((value): value is number => value !== null && value >= 0)
    .sort((a, b) => a - b);
  const typicalDays = ages.length >= 5 ? Math.round(ages[Math.floor(ages.length / 2)]) : null;

  const drops = dropsOf(history);
  const totalDrop = drops.reduce((sum, drop) => sum + (drop.from - drop.to), 0);

  // La marge : d'usage selon le vendeur, plus ce que les faits autorisent.
  let room: number = BASE_ROOM[ad.sellerType ?? 'unknown'];
  if (daysOnline !== null) room += daysOnline >= 60 ? 0.04 : daysOnline >= 30 ? 0.025 : daysOnline >= 14 ? 0.01 : 0;
  if (drops.length) room += 0.01;
  room = Math.min(room, 0.12);

  let opening: number | null = null;
  let targetPrice: number | null = null;
  let ceiling: number | null = null;
  if (fair) {
    if (ad.price > fair.median) {
      // Trop cher : on vise le marché, sans prétendre arracher plus de 15 %.
      targetPrice = Math.max(fair.median * (1 - room / 2), ad.price * 0.85);
      ceiling = fair.median;
    } else {
      // Déjà bien placée : négocier un peu, sans risquer de la perdre.
      targetPrice = ad.price * (1 - room / 2);
      ceiling = ad.price;
    }
    targetPrice = Math.min(targetPrice, ceiling);
    opening = roundDown(targetPrice * 0.96, ad.price);
    targetPrice = roundNear(targetPrice, ad.price);
    ceiling = roundNear(ceiling, ad.price);
    if (opening > targetPrice) opening = targetPrice;
  }

  // Seules des comparables crédibles se citent : une voiture bradée à moitié
  // prix fait répondre au vendeur qu'elle a forcément un défaut.
  const cheaper = fair
    ? fair.comparables
        .filter(
          (other) =>
            other.price < ad.price &&
            other.price >= fair.p25 * 0.95 &&
            (ad.km === null || other.km === null || other.km <= ad.km * 1.1),
        )
        .sort((a, b) => a.price - b.price)
        .slice(0, 3)
    : [];

  const args = argumentsFor({ ad, fair, position, daysOnline, typicalDays, drops, totalDrop, cheaper });
  const warnings = [...(ad.flags ?? [])];
  if (fair && position !== null && position < -0.3) {
    warnings.push('Prix très inférieur au marché : vérifie la voiture et le vendeur avant tout versement.');
  }

  return {
    fair,
    position,
    verdict,
    daysOnline,
    typicalDays,
    drops,
    room,
    opening,
    target: targetPrice,
    ceiling,
    arguments: args,
    cheaper,
    warnings,
    message: messageFor({ ad, fair, position, verdict, daysOnline, opening, targetPrice }),
  };
}

/** Les baisses successives, dans l'ordre où elles sont arrivées. */
function dropsOf(history: PriceStep[]): Sheet['drops'] {
  const steps = [...history]
    .map((step) => ({ price: step.price, at: new Date(step.at) }))
    .filter((step) => !Number.isNaN(step.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const drops: Sheet['drops'] = [];
  for (let i = 1; i < steps.length; i += 1) {
    if (steps[i].price < steps[i - 1].price) {
      drops.push({ from: steps[i - 1].price, to: steps[i].price, at: steps[i].at.toISOString() });
    }
  }
  return drops;
}

function argumentsFor(input: {
  ad: Ad;
  fair: Estimate | null;
  position: number | null;
  daysOnline: number | null;
  typicalDays: number | null;
  drops: Sheet['drops'];
  totalDrop: number;
  cheaper: Ad[];
}): Argument[] {
  const { ad, fair, position, daysOnline, typicalDays, drops, totalDrop, cheaper } = input;
  const args: Argument[] = [];

  if (fair && position !== null) {
    // Le moteur se dit par sa puissance et son carburant quand on les connaît :
    // c'est sur eux que portent les comparables, pas sur un libellé de finition.
    const engine = ad.power ? `même moteur, ${ad.power} ch${ad.fuel ? ` ${ad.fuel.toLowerCase()}` : ''}` : ad.version;
    const scope = [
      fair.tolerance.sameVersion ? engine : null,
      `±${fair.tolerance.years} an${fair.tolerance.years > 1 ? 's' : ''}`,
      fair.tolerance.km ? `±${euros(fair.tolerance.km).replace(' €', '')} km` : null,
    ]
      .filter(Boolean)
      .join(', ');
    args.push({
      text: `${fair.count} voitures comparables (${scope}) : médiane ${euros(fair.median)}, la moitié entre ${euros(fair.p25)} et ${euros(fair.p75)}.`,
      weight: 'strong',
    });
    const share = Math.round(Math.abs(position) * 100);
    if (position > 0.02) {
      args.push({ text: `Annoncée ${share} % au-dessus de la médiane de ses comparables.`, weight: 'strong' });
    } else if (position < -0.02) {
      args.push({ text: `Déjà ${share} % sous la médiane : la marge de négociation est mince.`, weight: 'context' });
    } else {
      args.push({ text: 'Au prix du marché, ni au-dessus ni en dessous.', weight: 'context' });
    }

    const kms = fair.comparables.map((other) => other.km).filter((km): km is number => km !== null).sort((a, b) => a - b);
    if (ad.km !== null && kms.length >= 3) {
      const medianKm = kms[Math.floor(kms.length / 2)];
      if (ad.km > medianKm * 1.15) {
        args.push({
          text: `${euros(ad.km - medianKm).replace(' €', '')} km de plus que la moyenne de ses comparables.`,
          weight: 'useful',
        });
      }
    }
  }

  if (daysOnline !== null) {
    const long = typicalDays !== null ? daysOnline > typicalDays * 1.5 && daysOnline >= 14 : daysOnline >= 30;
    args.push({
      text:
        typicalDays !== null
          ? `En ligne depuis ${daysOnline} jour${daysOnline > 1 ? 's' : ''}, quand la moitié des annonces de ce modèle ont moins de ${typicalDays} jours.`
          : `En ligne depuis ${daysOnline} jour${daysOnline > 1 ? 's' : ''}.`,
      weight: long ? 'strong' : 'context',
    });
  }

  if (drops.length) {
    const last = drops[drops.length - 1];
    args.push({
      text: `Déjà baissée ${drops.length > 1 ? `${drops.length} fois, ` : ''}de ${euros(totalDrop)} au total (dernière baisse le ${shortDate(last.at)}) : le vendeur a envie de vendre.`,
      weight: 'strong',
    });
  }

  if (cheaper.length) {
    args.push({
      text: `${cheaper.length} comparable${cheaper.length > 1 ? 's' : ''} moins chère${cheaper.length > 1 ? 's' : ''} avec un kilométrage proche ou inférieur, à partir de ${euros(cheaper[0].price)}.`,
      weight: 'useful',
    });
  }

  if (ad.sellerType === 'pro') {
    args.push({
      text: 'Vendeur professionnel : la marge se négocie moins, mais une garantie, un entretien ou les frais de mise en route se demandent.',
      weight: 'context',
    });
  }
  return args;
}

function messageFor(input: {
  ad: Ad;
  fair: Estimate | null;
  position: number | null;
  verdict: Sheet['verdict'];
  daysOnline: number | null;
  opening: number | null;
  targetPrice: number | null;
}): string {
  const { ad, fair, position, verdict, daysOnline, opening, targetPrice } = input;
  const lines = ['Bonjour,', '', `Votre annonce « ${ad.title} » m’intéresse.`];

  if (!fair || opening === null || targetPrice === null) {
    lines.push('', 'Le prix est-il négociable ? Je suis disponible rapidement pour venir la voir.', '', 'Bien cordialement');
    return lines.join('\n');
  }

  const scope = [ad.version, ad.year ? `de ${ad.year} environ` : null, 'à kilométrage proche'].filter(Boolean).join(', ');
  if (verdict === 'below') {
    lines.push(
      '',
      'Elle est bien placée par rapport aux annonces équivalentes, et je peux venir la voir rapidement.',
      `Seriez-vous prêt à me la laisser à ${euros(targetPrice)} ?`,
    );
  } else {
    lines.push(
      '',
      // Un vendeur entend mieux un chiffre rond qu'une médiane à l'euro près.
      `Je l’ai comparée à ${fair.count} annonces équivalentes (${scope}) : elles se situent plutôt autour de ${euros(roundNear(fair.median, ad.price))}${
        verdict !== 'above' ? '' : (position ?? 0) > 0.12 ? ', nettement en dessous de votre prix' : ', un peu en dessous de votre prix'
      }.`,
    );
    if (daysOnline !== null && daysOnline >= 21) {
      lines.push(`Je vois aussi qu’elle est en vente depuis un moment.`);
    }
    lines.push('', `Je vous propose ${euros(opening)}, sous réserve de l’essai et de l’historique d’entretien.`);
  }
  lines.push('Je suis disponible rapidement, et le paiement peut se faire par virement à la remise des clés.', '', 'Bien cordialement');
  return lines.join('\n');
}

/** Arrondi d'offre : à 100 € près, 50 € pour les petites voitures. */
function step(reference: number): number {
  return reference < 5_000 ? 50 : 100;
}
function roundDown(value: number, reference: number): number {
  return Math.floor(value / step(reference)) * step(reference);
}
function roundNear(value: number, reference: number): number {
  return Math.round(value / step(reference)) * step(reference);
}

function euros(value: number): string {
  return `${Math.round(value).toLocaleString('fr-FR')} €`;
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(new Date(value));
}
