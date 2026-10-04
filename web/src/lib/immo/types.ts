import type { CollectJob } from '../collect-jobs';

/**
 * Bon Tracker Immo : le marché d'un bien — un appartement de 45 m² à Nantes,
 * une maison près de Vannes — d'après toutes ses annonces leboncoin.
 *
 * Ses données vivent à part de celles des voitures (collections immo_*) : les
 * deux domaines ne partagent que le cycle de vie des collectes.
 */
export type Transaction = 'vente' | 'location';
export type PropertyType = 'appartement' | 'maison';

/** Une commune ou un arrondissement, tel que le référentiel officiel le décrit. */
export interface Place {
  /** « Nantes », « Paris 11e Arrondissement ». */
  name: string;
  /** Code INSEE : identifie la commune sans ambiguïté, là où les noms se répètent. */
  code: string;
  postalCodes: string[];
  department: string;
  /** Centre de la commune, pour chercher dans un rayon autour d'elle. */
  lat: number | null;
  lng: number | null;
}

/** Ce que fait le collecteur, montré en direct pendant la collecte. */
export interface ImmoActivity {
  step: string;
  recent: {
    title: string;
    price: number;
    surface?: number | null;
    rooms?: number | null;
    imageUrl: string | null;
    location: string | null;
  }[];
  total: number | null;
}

/** Une estimation demandée par un compte : un type de bien, un lieu, une taille. */
export interface ImmoQuery extends CollectJob {
  transaction: Transaction;
  propertyType: PropertyType;
  place: Place;
  /** Rayon autour de la commune, en kilomètres ; 0 pour la commune seule. */
  radiusKm: number;
  /** Surface du bien à situer, telle que saisie ; la recherche couvre une fourchette autour. */
  surface: number | null;
  surfaceMin: number | null;
  surfaceMax: number | null;
  /** Forme du lieu que le site a comprise, apprise à la première collecte. */
  locationParam: string | null;
  activity?: ImmoActivity | null;
}

/**
 * Bien du marché, commun à tous les comptes : les résultats d'une recherche
 * sont publics, deux personnes qui estiment le même quartier lisent la même
 * collecte.
 */
export interface ImmoAd {
  lbcId: string;
  transaction: Transaction;
  title: string;
  url: string;
  imageUrl: string | null;
  location: string | null;
  zipcode: string | null;
  lat: number | null;
  lng: number | null;
  sellerType: 'pro' | 'private' | null;
  /** Prix de vente, ou loyer mensuel. */
  price: number;
  /** Surface habitable, en m². */
  surface: number | null;
  rooms: number | null;
  bedrooms: number | null;
  propertyType: PropertyType | null;
  /** Classe énergie du DPE, de A à G. */
  energy: string | null;
  floor: number | null;
  isNew: boolean | null;
  furnished: boolean | null;
  /** Terrain d'une maison, en m². */
  landSurface: number | null;
  /**
   * Début de la description : un viager, une vente aux enchères ou des
   * travaux ne se lisent souvent que là, pas dans le titre.
   */
  body: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}
