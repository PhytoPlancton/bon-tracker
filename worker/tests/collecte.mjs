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

// ---------------------------------------------------------------------------
// Le marché immobilier
// ---------------------------------------------------------------------------

const NANTES = { name: 'Nantes', code: '44109', postalCodes: ['44000', '44100', '44200', '44300'], department: '44', lat: 47.2184, lng: -1.5534 };
const CITIES = {
  Nantes: { zip: '44000', lat: 47.2184, lng: -1.5534 },
  'Saint-Herblain': { zip: '44800', lat: 47.2122, lng: -1.6497 },
  Rennes: { zip: '35000', lat: 48.1113, lng: -1.68 },
  Paris: { zip: '75011', lat: 48.8591, lng: 2.3795 },
  Lyon: { zip: '69003', lat: 45.7597, lng: 4.8422 },
  Lille: { zip: '59000', lat: 50.6292, lng: 3.0573 },
};

let homeId = 0;
function home(city, { surface, type = '2', title, typed = true }) {
  homeId += 1;
  const at = CITIES[city];
  return siteAd({
    id: 4_000_000_000 + homeId,
    title: title ?? `${type === '1' ? 'Maison' : 'Appartement'} ${Math.max(1, Math.round(surface / 20))} pièces ${surface} m²`,
    price: surface * 3500,
    category: 'Ventes immobilières',
    slug: 'ventes_immobilieres',
    city,
    zipcode: at.zip,
    lat: at.lat + (homeId % 7) * 0.001,
    lng: at.lng - (homeId % 5) * 0.001,
    attributes: { ...(typed ? { real_estate_type: type } : {}), square: surface, rooms: Math.max(1, Math.round(surface / 20)) },
    body: 'Lumineux, proche commerces.',
  });
}

// Un pays entier en vrac : sans lieu compris, c'est ce que le site renvoie,
// et Nantes n'y pèse qu'une petite part.
const homes = [];
for (let i = 0; i < 40; i += 1) {
  for (const city of ['Rennes', 'Paris', 'Lyon', 'Lille']) homes.push(home(city, { surface: 30 + i }));
  homes.push(home('Nantes', { surface: 25 + i * 1.5 }));
  if (i % 4 === 0) homes.push(home('Saint-Herblain', { surface: 35 + i }));
}
homes.push(home('Nantes', { surface: 90, type: '1' }), home('Nantes', { surface: 120, type: '1' }));
// Sans type déclaré : seul le titre dit que c'est une maison.
homes.push(home('Nantes', { surface: 60, typed: false, title: 'Maison de ville 3 pièces 60 m²' }));

/** Ce que le site comprend du lieu ; le reste, il l'ignore et renvoie tout. */
let understands = 'coords3';
function selectHomes(params) {
  if (params.get('category') !== '9') return [];
  const type = params.get('real_estate_type');
  // Le site filtre le type déclaré, ignore la surface : au collecteur de trier.
  let pool = homes.filter((ad) => {
    const declared = ad.attributes.find((a) => a.key === 'real_estate_type')?.value;
    return !declared || !type || declared === type;
  });
  const location = params.get('locations') ?? '';
  const coords3 = location.match(/^([^_]+)__(-?[\d.]+)_(-?[\d.]+)_(\d+)$/);
  const coords4 = location.match(/^([^_]+)_(\d{5})__(-?[\d.]+)_(-?[\d.]+)_(\d+)_(\d+)$/);
  const near = (lat, lng, metres) =>
    pool.filter((ad) => distanceKm(ad.location.lat, ad.location.lng, Number(lat), Number(lng)) * 1000 <= metres);
  if (understands === 'coords3' && coords3) pool = near(coords3[2], coords3[3], Number(coords3[4]));
  else if (understands === 'coords4' && coords4) pool = near(coords4[3], coords4[4], Number(coords4[6]));
  return pool;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function selectCars(params) {
  if (params.get('category') !== '2') return [];
  const model = params.get('u_car_model');
  if (model) return cars.filter((ad) => ad.attributes.find((a) => a.key === 'u_car_model')?.value === model);
  const text = (params.get('text') ?? '').toLowerCase().split(' ').pop();
  return cars.filter((ad) => ad.subject.toLowerCase().includes(text));
}

let select = selectCars;
// Une annonce à négocier, publiée il y a trois semaines, et ses « similaires ».
const negotiated = siteAd({
  id: 3_900_000_001,
  title: 'Porsche Boxster S 3.2 Tiptronic',
  price: 21_900,
  category: 'Voitures',
  slug: 'voitures',
  city: 'Rouen',
  zipcode: '76000',
  lat: 49.44,
  lng: 1.1,
  publishedAt: '2026-09-14 09:12:40',
  attributes: { u_car_brand: 'PORSCHE', u_car_model: 'PORSCHE_Boxster', u_car_version: 'Boxster 3.2 S TipTronic S', regdate: 2003, mileage: 112_000 },
});
const findAd = (id) => (id === String(negotiated.list_id) ? { ad: negotiated, similar: cars.slice(0, 2) } : null);
const site = await startSite((params) => select(params), findAd);
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

  console.log('\nVoitures : relevé des nouveautés pour une veille');
  api.reset();
  site.visits.length = 0;
  await runMarketJob(
    { queryId: 'q-veille', runId: 'envoi-5', brand: 'Porsche', model: 'Boxster', yearMin: null, yearMax: null, powerMin: null, powerMax: null, codes: { brand: 'PORSCHE', model: 'PORSCHE_Boxster' }, mode: 'fresh' },
    quiet,
  );
  check('annoncé comme relevé des nouveautés', api.state.reports[0]?.status === 'running' && api.state.reports[0]?.mode === 'fresh', api.state.reports[0]);
  check('dernières arrivées en tête', site.visits.length > 0 && site.visits.every((u) => u.searchParams.get('sort') === 'time' && u.searchParams.get('order') === 'desc'), site.visits.map(String));
  check('deux pages au plus', site.visits.length <= 2 && !site.visits.some((u) => u.searchParams.get('page') === '3'), site.visits.map(String));
  check('ce qui a été lu est versé', api.state.ingested.length === 70 && api.state.reports.at(-1)?.status === 'done', api.state.ingested.length);

  console.log('\nNégociation : lecture d’une annonce isolée');
  const { readAdJob } = await import('../dist/read-ad.js');
  api.reset();
  site.visits.length = 0;
  await readAdJob({ negotiationId: 'n-1', lbcId: String(negotiated.list_id) }, quiet);
  const read = api.state.adReports[0];
  check('annonce remontée à la bonne négociation', read?.id === 'n-1' && read.ad?.lbcId === String(negotiated.list_id), read);
  check('pas une des annonces similaires', read?.ad?.title === 'Porsche Boxster S 3.2 Tiptronic', read?.ad?.title);
  check('prix, moteur et date de mise en ligne lus', read?.ad?.price === 21_900 && read.ad.attributes?.u_car_version === 'Boxster 3.2 S TipTronic S' && read.ad.publishedAt === '2026-09-14 09:12:40', read?.ad);
  check('adresse reconstruite à partir du numéro', site.visits.length === 1 && site.visits[0].pathname === `/ad/voitures/${negotiated.list_id}`, site.visits.map(String));
  api.reset();
  await readAdJob({ negotiationId: 'n-2', lbcId: '3999999999' }, quiet);
  const missing = api.state.adReports[0];
  check('annonce retirée : échec expliqué', missing?.ad === null && /introuvable/i.test(missing.error ?? ''), missing);

  const { runImmoJob } = await import('../dist/immo.js');
  select = selectHomes;
  const flats = { queryId: 'q-immo', runId: 'envoi-4', transaction: 'vente', propertyType: 'appartement', place: NANTES, radiusKm: 0, surfaceMin: 29, surfaceMax: 68, locationParam: null };
  const zipOf = (ad) => ad.location?.match(/\d{5}/)?.[0];

  console.log('\nImmobilier : le collecteur trouve la forme du lieu que le site comprend');
  api.reset();
  site.visits.length = 0;
  understands = 'coords3';
  await runImmoJob(flats, quiet);
  const firstPages = site.visits.filter((u) => !u.searchParams.get('page'));
  check('plusieurs formes essayées avant la bonne', firstPages.length === 3, firstPages.map((u) => u.searchParams.get('locations')));
  check('d’abord le nom et le code postal', firstPages[0]?.searchParams.get('locations') === 'Nantes_44000', firstPages[0]?.searchParams.get('locations'));
  const learnedPlace = api.state.reports.find((r) => r.pages === 1)?.locationParam;
  check('forme comprise remontée à l’application', learnedPlace === 'Nantes__47.21840_-1.55340_5000', learnedPlace);
  check('les pages suivantes la reprennent', site.visits.filter((u) => u.searchParams.get('page')).every((u) => u.searchParams.get('locations') === learnedPlace), site.visits.map(String));
  check('recherche bien formée', firstPages[0]?.searchParams.get('category') === '9' && firstPages[0]?.searchParams.get('real_estate_type') === '2' && firstPages[0]?.searchParams.get('square') === '29-68', String(firstPages[0]));
  const flatsKept = api.state.ingested;
  check('seuls les biens de Nantes versés', flatsKept.length > 0 && flatsKept.every((ad) => NANTES.postalCodes.includes(zipOf(ad))), flatsKept.map(zipOf));
  check('les maisons écartées, même sans type déclaré', !flatsKept.some((ad) => /maison/i.test(ad.title)), flatsKept.filter((ad) => /maison/i.test(ad.title)).map((ad) => ad.title));
  check('la surface revérifiée', flatsKept.every((ad) => Number(ad.attributes.square) >= 27 && Number(ad.attributes.square) <= 72), flatsKept.map((ad) => ad.attributes.square));
  const expected = homes.filter((ad) => ad.location.city === 'Nantes' && ad.subject.startsWith('Appartement') && Number(ad.attributes.find((a) => a.key === 'square').value) >= 27.55 && Number(ad.attributes.find((a) => a.key === 'square').value) <= 71.4);
  check('et aucun bien de Nantes perdu', flatsKept.length === expected.length, { kept: flatsKept.length, expected: expected.length });
  check('coordonnées et description relevées', flatsKept.every((ad) => typeof ad.lat === 'number' && typeof ad.lng === 'number' && ad.body === 'Lumineux, proche commerces.'), flatsKept[0]);
  check('aperçu avec surface et pièces', api.state.reports.some((r) => r.activity?.recent?.[0]?.surface > 0 && r.activity.recent[0].rooms > 0), api.state.reports.find((r) => r.activity?.recent?.length)?.activity);
  check('terminée', api.state.reports.at(-1)?.status === 'done' && api.state.reports.at(-1)?.ads === flatsKept.length, api.state.reports.at(-1));

  console.log('\nImmobilier : forme déjà connue');
  api.reset();
  site.visits.length = 0;
  await runImmoJob({ ...flats, queryId: 'q-immo-2', locationParam: learnedPlace }, quiet);
  const direct = site.visits.filter((u) => !u.searchParams.get('page'));
  check('une seule première page, avec la forme apprise', direct.length === 1 && direct[0].searchParams.get('locations') === learnedPlace, direct.map((u) => u.searchParams.get('locations')));
  check('mêmes biens', api.state.ingested.length === flatsKept.length, api.state.ingested.length);

  console.log('\nImmobilier : dans un rayon');
  api.reset();
  site.visits.length = 0;
  understands = 'coords4';
  await runImmoJob({ ...flats, queryId: 'q-rayon', radiusKm: 10 }, quiet);
  const radiusTries = site.visits.filter((u) => !u.searchParams.get('page')).map((u) => u.searchParams.get('locations'));
  check('le rayon se dit d’abord par le centre', radiusTries.every((form) => form.includes('__47.21840_-1.55340_')), radiusTries);
  const radiusLearned = api.state.reports.find((r) => r.pages === 1)?.locationParam;
  check('jusqu’à la forme comprise', radiusLearned === 'Nantes_44000__47.21840_-1.55340_5000_10000', radiusLearned);
  const around = api.state.ingested;
  check('les communes voisines comprises', around.some((ad) => zipOf(ad) === '44800') && around.some((ad) => zipOf(ad) === '44000'), [...new Set(around.map(zipOf))]);
  check('rien de lointain', !around.some((ad) => ['35000', '75011', '69003', '59000'].includes(zipOf(ad))), [...new Set(around.map(zipOf))]);

  console.log('\nImmobilier : un lieu que le site ne comprend pas');
  api.reset();
  site.visits.length = 0;
  understands = 'rien';
  const brest = { name: 'Brest', code: '29019', postalCodes: ['29200'], department: '29', lat: 48.39, lng: -4.49 };
  await runImmoJob({ ...flats, queryId: 'q-brest', place: brest }, quiet);
  const failure = api.state.reports.at(-1);
  check('échec dit plutôt qu’un marché faux', failure?.status === 'error' && /ne reconnaît pas ce lieu/.test(failure.error), failure);
  check('toutes les formes essayées', site.visits.length === 6, site.visits.map((u) => u.searchParams.get('locations')));
  check('rien versé', api.state.ingested.length === 0, api.state.ingested.length);
} finally {
  api.close();
  chromium.close();
  site.close();
  console.log(`\n${passed} vérifications réussies, ${failed} en échec\n`);
  process.exit(failed ? 1 : 0);
}
