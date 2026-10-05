export function formatPrice(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(date);
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function relativeTime(value: string | Date | null): string {
  if (!value) return 'jamais';
  const date = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "à l'instant";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

/** Années et puissance demandées, ex. « 2010 – 2016 · 150 – 250 ch ». */
export function criteriaLabel(item: {
  yearMin: number | null;
  yearMax: number | null;
  powerMin?: number | null;
  powerMax?: number | null;
}) {
  const power = powerLabel(item);
  return power ? `${yearsLabel(item)} · ${power}` : yearsLabel(item);
}

function powerLabel(item: { powerMin?: number | null; powerMax?: number | null }) {
  if (item.powerMin && item.powerMax) return `${item.powerMin} – ${item.powerMax} ch`;
  if (item.powerMin) return `${item.powerMin} ch et plus`;
  if (item.powerMax) return `jusqu’à ${item.powerMax} ch`;
  return null;
}

export function yearsLabel(item: { yearMin: number | null; yearMax: number | null }) {
  if (item.yearMin && item.yearMax) return `${item.yearMin} – ${item.yearMax}`;
  if (item.yearMin) return `depuis ${item.yearMin}`;
  if (item.yearMax) return `jusqu’à ${item.yearMax}`;
  return 'toutes années';
}
