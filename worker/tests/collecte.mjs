/**
 * Le collecteur face à un faux leboncoin : recherches, pages, tri, arrêt
 * demandé, et — pour l'immobilier — un site qui ne comprend qu'une forme de
 * lieu. Le vrai code du collecteur pilote un vrai Chromium ; seuls le site et
 * l'application sont simulés.
 *
 *   npm run build && node tests/collecte.mjs
 *
 * Demande Chromium (CHROMIUM=/chemin/vers/chromium) et openssl, et le port
 * 443 libre : le faux site doit répondre à l'adresse du vrai.
 */
import { siteAd, startApi, startChromium, startSite } from './faux-leboncoin.mjs';

const API_PORT = 3561;
const CHROME_PORT = 9341;

process.env.API_BASE_URL = `http://127.0.0.1:${API_PORT}`;
process.env.WORKER_TOKEN = 'jeton-de-test';
process.env.CHROME_HOST = '127.0.0.1';
process.env.CHROME_PORT = String(CHROME_PORT);
process.env.PAGE_DELAY_MS = '400';

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`, detail !== undefined ? JSON.stringify(detail).slice(0, 600) : '');
  }
};
const quiet = () => undefined;

// ---------------------------------------------------------------------------
// Le marché des voitures
// ---------------------------------------------------------------------------

const cars = [];
for (let i = 0; i < 80; i += 1) {
  cars.push(siteAd({
    id: 3_000_000_000 + i,
    title: `Porsche Boxster ${i % 2 ? 'S' : ''} ${1997 + (i % 8)}`.replace(/\s+/g, ' '),
    price: 14_000 + i * 150,
    category: 'Voitures',
    slug: 'voitures',
    city: 'Caen',
    zipcode: '14000',
    lat: 49.18,
    lng: -0.37,
    attributes: { u_car_brand: 'PORSCHE', u_car_model: 'PORSCHE_Boxster', regdate: 1997 + (i % 8), mileage: 90_000 + i * 1000 },
  }));
}
// Une recherche libre ramène aussi ce qui cite le nom en passant.
for (let i = 0; i < 6; i += 1) {
  cars.push(siteAd({
    id: 3_100_000_000 + i,
    title: `Porsche Cayman, plus rapide qu'un Boxster`,
    price: 30_000,
    category: 'Voitures',
    slug: 'voitures',
    city: 'Caen',
    zipcode: '14000',
    lat: 49.18,
    lng: -0.37,
    attributes: { u_car_brand: 'PORSCHE', u_car_model: 'PORSCHE_Cayman', regdate: 2008, mileage: 60_000 },
  }));
}

function selectCars(params) {
  if (params.get('category') !== '2') return [];
  const model = params.get('u_car_model');
  if (model) return cars.filter((ad) => ad.attributes.find((a) => a.key === 'u_car_model')?.value === model);
  const text = (params.get('text') ?? '').toLowerCase().split(' ').pop();
  return cars.filter((ad) => ad.subject.toLowerCase().includes(text));
}

let select = selectCars;
const site = await startSite((params) => select(params));
const chromium = await startChromium(CHROME_PORT);
const api = await startApi(API_PORT);

try {
  const { runMarketJob } = await import('../dist/market.js');

  console.log('\nVoitures : un modèle de bout en bout');
  await runMarketJob(
    { queryId: 'q-voiture', runId: 'envoi-1', brand: 'Porsche', model: 'Boxster', yearMin: null, yearMax: null, powerMin: null, powerMax: null, codes: null },
    quiet,
  );
  const reports = api.state.reports;
  check('chaque remontée porte la marque de l’envoi', reports.every((r) => r.runId === 'envoi-1'), reports.map((r) => r.runId));
  check('démarre en « en cours »', reports[0]?.status === 'running', reports[0]);
  const learned = reports.find((r) => r.codes);
  check('codes du modèle appris et remontés avec la page 1', learned?.codes?.model === 'PORSCHE_Boxster' && learned.pages === 1, learned);
  check('recherche relancée avec les codes', site.visits.some((u) => u.searchParams.get('u_car_model') === 'PORSCHE_Boxster'), site.visits.map(String));
  const last = reports.at(-1);
  check('terminée', last?.status === 'done' && last.ads === 80, last);
  check('toutes les pages lues jusqu’à la dernière', reports.some((r) => r.pages === 3) && !reports.some((r) => r.pages > 4), reports.map((r) => r.pages).filter(Boolean));
  check('seuls les Boxster versés', api.state.ingested.length === 80 && api.state.ingested.every((ad) => ad.attributes.u_car_model === 'PORSCHE_Boxster'), api.state.ingested.length);
  check('activité en direct avec aperçu', reports.some((r) => r.activity?.recent?.length && r.activity.recent[0].km > 0), reports.find((r) => r.activity?.recent?.length));
  check('total annoncé par la page lu', reports.some((r) => r.activity?.total === 80), reports.map((r) => r.activity?.total).filter(Boolean));

  console.log('\nVoitures : arrêt demandé en cours de route');
  api.reset();
  site.visits.length = 0;
  // L'application répond « arrête-toi » à la remontée de la page 2.
  api.state.stopWhen = (body) => body.pages === 2;
  await runMarketJob(
    { queryId: 'q-arret', runId: 'envoi-2', brand: 'Porsche', model: 'Boxster', yearMin: null, yearMax: null, powerMin: null, powerMax: null, codes: { brand: 'PORSCHE', model: 'PORSCHE_Boxster' } },
    quiet,
  );
  const stopped = api.state.reports;
  check('codes connus : pas de recherche libre', !site.visits.some((u) => u.searchParams.get('text')), site.visits.map(String));
  check('plus aucune page après l’arrêt', !site.visits.some((u) => u.searchParams.get('page') === '3'), site.visits.map(String));
  check('ce qui a été lu est versé', api.state.ingested.length === 70, api.state.ingested.length);
  check('et la collecte close', stopped.at(-1)?.status === 'done' && stopped.at(-1)?.ads === 70, stopped.at(-1));

  console.log('\nVoitures : annulée avant son tour');
  api.reset();
  site.visits.length = 0;
  api.state.stopWhen = (body) => body.status === 'running';
  await runMarketJob(
    { queryId: 'q-annulee', runId: 'envoi-3', brand: 'Porsche', model: 'Boxster', yearMin: null, yearMax: null, powerMin: null, powerMax: null, codes: null },
    quiet,
  );
  check('aucune page visitée', site.visits.length === 0, site.visits.length);
  check('rien versé, rien écrit après le refus', api.state.ingested.length === 0 && api.state.reports.length === 1, api.state.reports);
} finally {
  api.close();
  chromium.close();
  site.close();
  console.log(`\n${passed} vérifications réussies, ${failed} en échec\n`);
  process.exit(failed ? 1 : 0);
}
