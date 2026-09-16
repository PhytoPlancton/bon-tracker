export type ListingSource = 'favorites' | `search:${string}`;

export interface Listing {
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
}

export interface PricePoint {
  lbcId: string;
  price: number;
  observedAt: Date;
}

export interface SavedSearch {
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
}
