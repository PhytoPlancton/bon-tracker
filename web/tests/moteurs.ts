/**
 * Comparer des voitures de même moteur, pas de même libellé : leboncoin mêle
 * carrosserie et finition à la motorisation (« Série 1 Cabriolet 125i 218ch
 * Luxe »), et les libellés d'un même moteur ne se recoupent presque jamais.
 * Cas réel : une 125i essence comparée à des 118d et 123d diesel, moins
 * chères, la disait 34 % trop chère.
 */
import { estimate, powerFrom, type Ad } from '../src/lib/estimation';
import { buildSheet } from '../src/lib/negotiation';

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

let id = 3_279_000_000;
function bmw(version: string, fuel: string, year: number, km: number, price: number): Ad {
  return {
    lbcId: String((id += 1)),
    title: `BMW ${version}`,
    url: '',
    price,
    km,
    year,
    version,
    fuel,
    location: null,
    sellerType: 'private',
    power: powerFrom(null, version),
  };
}

console.log('\nPuissance');
check('lue dans le libellé', powerFrom(null, 'Série 1 Cabriolet 125i 218ch Luxe') === 218, powerFrom(null, 'Série 1 Cabriolet 125i 218ch Luxe'));
check('déclarée, de préférence', powerFrom({ horse_power_din: '211' }, '125i 218ch') === 211, null);
check('chevaux fiscaux ignorés', powerFrom(null, 'BMW 118d 7cv') === null, null);

// 125i essence, carrosseries et finitions variées ; diesels moins chers autour.
const pool: Ad[] = [
  bmw('Série 1 Coupé 125i 218ch Sport', 'Essence', 2008, 150_000, 13_500),
  bmw('Série 1 Cabriolet 125i 218ch Confort', 'Essence', 2009, 160_000, 13_900),
  bmw('Série 1 Coupé 125i 218ch Luxe', 'Essence', 2008, 175_000, 12_800),
  bmw('Série 1 Cabriolet 125i 218ch Sport Design', 'Essence', 2007, 170_000, 12_900),
  bmw('Série 1 Coupé 125i 218ch M Sport', 'Essence', 2009, 140_000, 14_500),
  bmw('Série 1 Cabriolet 125i 218ch Luxe', 'Essence', 2008, 185_000, 12_400),
  ...[0, 1, 2, 3, 4, 5].map((i) => bmw('Série 1 Coupé 123d 204ch Sport', 'Diesel', 2008, 160_000 + i * 5_000, 8_000 + i * 100)),
  ...[0, 1, 2, 3, 4, 5].map((i) => bmw('Série 1 118d 143ch Edition', 'Diesel', 2009, 170_000 + i * 5_000, 7_500 + i * 100)),
];
const target = bmw('Série 1 Cabriolet 125i 218ch Luxe', 'Essence', 2008, 167_000, 13_390);

console.log('\nComparables');
const peers = estimate(target, pool, target.lbcId);
check('trouvées malgré des libellés tous différents', peers && peers.count >= 4, peers?.count);
check('seulement des 125i essence', peers?.comparables.every((ad) => ad.power === 218 && ad.fuel === 'Essence'), peers?.comparables.map((ad) => ad.version));
check('médiane au prix des 125i', peers && peers.median > 12_000 && peers.median < 14_500, peers?.median);
check('jamais de mélange, même faute de comparables', estimate({ ...target, year: 2015 }, pool, target.lbcId) === null, null);

console.log('\nFiche de négociation');
const sheet = buildSheet({ ad: target, pool, history: [{ price: 13_390, at: new Date() }] });
check('au prix du marché, pas « 34 % au-dessus »', sheet.verdict !== 'above' || (sheet.position ?? 1) < 0.1, { verdict: sheet.verdict, position: sheet.position });
check('aucun diesel cité comme moins cher', sheet.cheaper.every((ad) => ad.fuel === 'Essence' && ad.power === 218), sheet.cheaper.map((ad) => ad.version));
check('le moteur nommé dans les arguments', sheet.arguments[0]?.text.includes('même moteur, 218 ch essence'), sheet.arguments[0]?.text);

console.log(`\n${passed} vérifications réussies, ${failed} en échec\n`);
process.exit(failed ? 1 : 0);
