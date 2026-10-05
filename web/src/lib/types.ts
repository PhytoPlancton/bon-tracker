import type { Mode } from './mode';

export type ListingSource = 'favorites' | `search:${string}`;

/** Secret chiffré au repos (AES-256-GCM). */
export interface Sealed {
  ciphertext: string;
  iv: string;
  tag: string;
}

export type LbcStatus = 'ok' | 'needs_login' | 'blocked' | 'verification_required';

export interface User {
  /** Identifiant interne, porté par la session et par chaque donnée collectée. */
  uid: string;
  /** Adresse du compte leboncoin, qui sert aussi à se connecter à l'app. */
  email: string;
  /** Vérifie la connexion à l'app, sans permettre de retrouver le mot de passe. */
  passwordHash: string;
  /**
   * Le même mot de passe, chiffré et réversible cette fois : le collecteur en
   * a besoin pour rouvrir une session leboncoin quand celle-ci expire.
   */
  lbcPassword: Sealed | null;
  /** Session leboncoin en cours, pour éviter de se reconnecter à chaque relevé. */
  lbcSession: Sealed | null;
  lbcStatus: LbcStatus;
  lbcCheckedAt: Date | null;
  createdAt: Date;
  /** Auto ou immo, choisi dans les réglages ; absent, c'est l'auto. */
  mode?: Mode;
}

export interface Listing {
  uid: string;
  lbcId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  category: string | null;
  sellerType: 'pro' | 'private' | null;
  location: string | null;
  currentPrice: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  isActive: boolean;
  sources: ListingSource[];
  /** Caractéristiques publiées avec l'annonce : puissance, année, kilométrage… */
  attributes?: Record<string, string>;
}

export interface PricePoint {
  uid: string;
  lbcId: string;
  price: number;
  observedAt: Date;
}

export interface SavedSearch {
  uid: string;
  lbcSearchId: string;
  name: string;
  url: string;
  /** Critères de la recherche, tels que le site les résume. */
  details: string | null;
  tracked: boolean;
  lastRunAt: Date | null;
  itemCount: number;
}

export type RunStatus = 'running' | 'ok' | 'error' | 'needs_session';

export interface Run {
  uid: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: RunStatus;
  stats: {
    seen: number;
    created: number;
    priceChanges: number;
    deactivated: number;
  };
  error: string | null;
}

/** Ce que le worker envoie pour une annonce observée. */
export interface ScrapedListing {
  lbcId: string;
  title: string;
  url: string;
  imageUrl?: string | null;
  category?: string | null;
  sellerType?: 'pro' | 'private' | null;
  location?: string | null;
  price: number | null;
  publishedAt?: string | null;
  attributes?: Record<string, string>;
  /** Description du vendeur. */
  body?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Annonce du marché, commune à tous les comptes : les résultats d'une
 * recherche sont publics, deux personnes qui estiment le même modèle lisent
 * la même collecte au lieu d'en déclencher deux.
 */
export interface MarketAd {
  lbcId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  location: string | null;
  sellerType: 'pro' | 'private' | null;
  price: number;
  km: number | null;
  year: number | null;
  /** Motorisation telle que le site la déclare (« Boxster 3.2 S »). */
  version: string | null;
  fuel: string | null;
  gearbox: string | null;
  brandCode: string | null;
  modelCode: string | null;
  /** Première mise en ligne d'après le site ; à défaut, on se fie à firstSeenAt. */
  publishedAt?: Date | null;
  /** Prix successifs observés : c'est ce qui révèle un vendeur pressé. */
  priceHistory?: { price: number; at: Date }[];
  /** Description du vendeur, telle que publiée (tronquée à 1 500 caractères). */
  description?: string | null;
  /** Toutes les caractéristiques publiées, valeurs et libellés (« fuel_label »). */
  attributes?: Record<string, string>;
  lat?: number | null;
  lng?: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface MarketActivity {
  step: string;
  recent: {
    title: string;
    price: number;
    km: number | null;
    year: number | null;
    imageUrl: string | null;
    location: string | null;
  }[];
  total: number | null;
}

export type MarketQueryStatus = 'queued' | 'running' | 'done' | 'error';

/** Une estimation demandée par un compte : un modèle, une tranche d'années. */
export interface MarketQuery {
  id: string;
  uid: string;
  brand: string;
  model: string;
  yearMin: number | null;
  yearMax: number | null;
  /** Puissance DIN en chevaux ; absente des estimations plus anciennes. */
  powerMin?: number | null;
  powerMax?: number | null;
  /** Clé de mutualisation : même modèle, mêmes années et même puissance, même collecte. */
  key: string;
  status: MarketQueryStatus;
  pages: number;
  ads: number;
  error: string | null;
  codes: { brand: string; model: string } | null;
  /** Annonces retenues par la dernière collecte réussie. */
  adIds: string[];
  /** Celles de la collecte en cours, basculées dans adIds une fois finie. */
  pendingIds: string[];
  createdAt: Date;
  /** Ce que fait le collecteur en ce moment, pour l'écran d'attente. */
  activity?: MarketActivity | null;
  /** Arrêt demandé depuis l'application : le collecteur garde ce qu'il a lu et s'arrête. */
  stopRequested?: boolean;
  /** Identifie l'envoi en cours au collecteur : un envoi plus ancien qui se réveille est écarté. */
  runId?: string;
  /** Dernière nouvelle du collecteur : sans elle depuis trop longtemps, la collecte est morte. */
  updatedAt?: Date;
  collectedAt: Date | null;
  /** Nature du relevé en cours : complet, ou seulement les dernières annonces. */
  runMode?: 'full' | 'fresh';
  /** Dernier relevé des nouveautés ; collectedAt reste celui du relevé complet. */
  freshAt?: Date | null;
}

/**
 * Veille : « préviens-moi quand une voiture comme celle-ci sort sous le
 * marché ». Elle s'appuie sur une estimation, dont elle reprend les annonces.
 */
export interface Watch {
  id: string;
  uid: string;
  queryId: string;
  /** Clé du modèle surveillé : deux veilles sur le même modèle partagent un relevé. */
  key: string;
  label: string;
  version: string | null;
  gearbox: string | null;
  kmMax: number | null;
  priceMax: number | null;
  /** Écart minimal sous les comparables, 0.12 pour 12 %. */
  threshold: number;
  active: boolean;
  createdAt: Date;
  checkedAt: Date | null;
}

export interface Alert {
  id: string;
  uid: string;
  watchId: string;
  lbcId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  location: string | null;
  price: number;
  /** Médiane des comparables au moment de l'alerte. */
  reference: number;
  ratio: number;
  comparables: number;
  km: number | null;
  year: number | null;
  version: string | null;
  /** Déjà en ligne à la création de la veille : listée, jamais notifiée. */
  initial: boolean;
  createdAt: Date;
  updatedAt: Date;
  readAt: Date | null;
}

/** Abonnement d'un appareil aux notifications ; les clés restent chiffrées. */
export interface PushSubscriptionRecord {
  uid: string;
  endpoint: string;
  keys: Sealed;
  userAgent: string | null;
  createdAt: Date;
}

export type NegotiationStatus = 'reading' | 'collecting' | 'ready' | 'error';

export interface Negotiation {
  id: string;
  uid: string;
  lbcId: string;
  url: string;
  status: NegotiationStatus;
  queryId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}
