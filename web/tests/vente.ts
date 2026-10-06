/**
 * « Pour la vendre » : trois prix tirés des comparables, et le temps observé
 * à chacun — d'après les annonces parties, ou à défaut l'âge de celles encore
 * en ligne, en le disant. Le calcul tourne dans le navigateur : on l'éprouve
 * tel quel.
 */
import { sellingAdvice } from '../src/lib/selling';
import type { Ad } from '../src/lib/estimation';

let passed = 0;
let failed = 0;
const check = (label: string, ok: unknown, detail?: unknown) => {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
};

const now = new Date('2026-10-06T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const fair = (km: number, year: number) => 26_000 - km * 0.05 + (year - 2000) * 800;

let id = 1;
function ad(km: number, year: number, ratio: number, ageDays: number, version = 'Boxster 3.2 S'): Ad {
  return {
    lbcId: String((id += 1)),
    title: 'Porsche Boxster',
    url: '',
    price: Math.round(fair(km, year) * (1 + ratio)),
    km,
    year,
    version,
    location: null,
    onlineSince: daysAgo(ageDays),
  };
}

// Un marché vivant : des annonces sous, au niveau et au-dessus de leur marché.
const live: Ad[] = [];
for (let i = 0; i < 36; i += 1) {
  const position = [-0.08, 0, 0.1][i % 3];
  live.push(ad(70_000 + (i % 12) * 5_000, 2000 + (i % 5), position, [5, 20, 70][i % 3]));
}

console.log('\nSans départs observés');
const early = sellingAdvice({ km: 100_000, year: 2002, version: 'Boxster 3.2 S' }, live, [], now);
check('conseil donné', early !== null, early);
check('trois prix croissants', early!.tiers[0].price <= early!.tiers[1].price && early!.tiers[1].price <= early!.tiers[2].price, early!.tiers.map((tier) => tier.price));
check('prix ronds', early!.tiers.every((tier) => tier.price % 100 === 0), early!.tiers);
check('prix au marché proche du modèle', Math.abs(early!.tiers[1].price - fair(100_000, 2002)) < 1_200, early!.tiers[1].price);
check('durées tirées des annonces encore en ligne, et dit', early!.tiers.every((tier) => tier.basis === 'live'), early!.tiers.map((tier) => tier.basis));
check('plus c’est cher, plus elles traînent', early!.tiers[0].days! < early!.tiers[2].days!, early!.tiers.map((tier) => tier.days));

console.log('\nAvec des départs observés');
const gone = [
  ...[1, 2, 3, 4].map(() => ({ ...ad(95_000, 2002, -0.06, 0), daysOnline: 9 })),
  ...[1, 2, 3].map(() => ({ ...ad(105_000, 2002, 0.01, 0), daysOnline: 24 })),
  ...[1, 2, 3].map(() => ({ ...ad(100_000, 2003, 0.12, 0), daysOnline: 61 })),
  // Une autre motorisation ne dit rien de celle-ci.
  ...[1, 2, 3].map(() => ({ ...ad(100_000, 2002, -0.06, 0, 'Boxster 2.7'), daysOnline: 300 })),
];
const later = sellingAdvice({ km: 100_000, year: 2002, version: 'Boxster 3.2 S' }, live, gone, now);
check('durées tirées des départs', later!.tiers.every((tier) => tier.basis === 'gone'), later!.tiers.map((tier) => tier.basis));
check('vite : ~9 jours', later!.tiers[0].days === 9, later!.tiers[0]);
check('au marché : ~24 jours', later!.tiers[1].days === 24, later!.tiers[1]);
check('en patientant : ~61 jours', later!.tiers[2].days === 61, later!.tiers[2]);
check('autre motorisation ignorée', later!.goneObserved === 10, later!.goneObserved);

console.log('\nTrop peu de comparables');
check('silence plutôt qu’un prix fragile', sellingAdvice({ km: 5_000, year: 2024, version: 'Boxster 3.2 S' }, live, [], now) === null, null);

console.log(`\n${passed} vérifications réussies, ${failed} en échec\n`);
process.exit(failed ? 1 : 0);
