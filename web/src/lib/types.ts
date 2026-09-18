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
  attributes?: Record<string, string>;
}
