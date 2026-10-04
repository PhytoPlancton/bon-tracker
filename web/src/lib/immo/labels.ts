import type { Place, PropertyType, Transaction } from './types';

/**
 * Libellés d'un marché immobilier, partagés par la liste, la fiche et
 * l'écran de collecte.
 */
export function placeLabel(place: Place): string {
  if (place.code.startsWith('cp-')) return `Code postal ${place.postalCodes[0]}`;
  // « Paris 11e Arrondissement » se lit « Paris 11e ».
  return `${place.name.replace(/\s+arrondissement$/i, '')} (${place.department})`;
}

const PLURAL: Record<PropertyType, string> = { appartement: 'Appartements', maison: 'Maisons' };

/** « Appartements à Nantes (44) », « Maisons autour de Vannes (56) ». */
export function marketTitle(query: { propertyType: PropertyType; place: Place; radiusKm: number }): string {
  const where = query.radiusKm > 0 ? 'autour de' : 'à';
  return `${PLURAL[query.propertyType]} ${where} ${placeLabel(query.place)}`;
}

export function transactionLabel(transaction: Transaction): string {
  return transaction === 'vente' ? 'Achat' : 'Location';
}

/** « Achat · 29 – 68 m² · 10 km autour ». */
export function criteriaLabel(query: {
  transaction: Transaction;
  surfaceMin: number | null;
  surfaceMax: number | null;
  radiusKm: number;
}): string {
  const surface =
    query.surfaceMin && query.surfaceMax
      ? `${query.surfaceMin} – ${query.surfaceMax} m²`
      : query.surfaceMin
        ? `${query.surfaceMin} m² et plus`
        : query.surfaceMax
          ? `jusqu’à ${query.surfaceMax} m²`
          : 'toutes surfaces';
  return [transactionLabel(query.transaction), surface, query.radiusKm ? `${query.radiusKm} km autour` : null]
    .filter(Boolean)
    .join(' · ');
}

/** Prix au m², au dixième d'euro pour un loyer : « 3 350 €/m² », « 14,6 €/m² ». */
export function formatPerM2(value: number | null, transaction: Transaction): string {
  if (value === null) return '—';
  const digits = transaction === 'location' ? 1 : 0;
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} €/m²`;
}
