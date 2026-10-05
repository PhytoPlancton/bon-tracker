/**
 * Vérifie Bon Tracker Immo de bout en bout : bascule de mode, séparation des
 * données auto et immo, recherche de commune, demande d'estimation, collecte
 * simulée, prix au m², pièces, DPE, bonnes affaires, valeur d'un bien donné,
 * rendement face aux loyers, réutilisation, arrêt et cloisonnement.
 *
 * Le collecteur et le référentiel des communes sont remplacés par de petits
 * serveurs locaux ; les annonces passent par les vraies routes internes.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

const PORT = 3448;
const WORKER_PORT = 3449;
const GEO_PORT = 3450;
const BASE = `http://127.0.0.1:${PORT}`;
const WORKER_TOKEN = 'jeton-de-test';
const DB = 'bon_tracker_immo';

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : '');
  }
};

// Faux collecteur : retient les demandes, répond comme le vrai.
const jobs = [];
const fakeWorker = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    if ((request.url === '/immo' || request.url === '/market') && request.headers['x-worker-token'] === WORKER_TOKEN) {
      jobs.push({ path: request.url, ...JSON.parse(body) });
      response.writeHead(202).end('{}');
    } else {
      response.writeHead(403).end();
    }
  });
});
await new Promise((resolve) => fakeWorker.listen(WORKER_PORT, '127.0.0.1', resolve));

// Faux référentiel des communes, au format de geo.api.gouv.fr.
const COMMUNES = [
  { nom: 'Nantes', code: '44109', codesPostaux: ['44000', '44100', '44200', '44300'], codeDepartement: '44', population: 320_000, centre: { type: 'Point', coordinates: [-1.5534, 47.2184] } },
  { nom: 'Nanterre', code: '92050', codesPostaux: ['92000'], codeDepartement: '92', population: 96_000, centre: { type: 'Point', coordinates: [2.2069, 48.8924] } },
  { nom: 'Nangis', code: '77327', codesPostaux: ['77370'], codeDepartement: '77', population: 9_000, centre: { type: 'Point', coordinates: [3.0151, 48.5554] } },
];
const DISTRICTS = [
  { nom: 'Paris 11e Arrondissement', code: '75111', codesPostaux: ['75011'], codeDepartement: '75', population: 142_000, centre: { type: 'Point', coordinates: [2.3795, 48.8591] } },
];
const geoRequests = [];
const fakeGeo = createServer((request, response) => {
  const url = new URL(request.url, 'http://geo');
  geoRequests.push(url);
  const nom = url.searchParams.get('nom');
  const postal = url.searchParams.get('codePostal');
  const districts = url.searchParams.get('type') === 'arrondissement-municipal';
  // Un code postal qui fait tomber le référentiel, pour éprouver le repli.
  if (postal === '29200') return void response.writeHead(503).end('[]');
  if (nom === 'panne') return void response.writeHead(503).end('[]');
  let found = [];
  if (nom) found = [...COMMUNES, ...DISTRICTS].filter((c) => c.nom.toLowerCase().startsWith(nom.toLowerCase())).sort(() => -1);
  else if (postal) found = (districts ? DISTRICTS : COMMUNES).filter((c) => c.codesPostaux.includes(postal));
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(found));
});
await new Promise((resolve) => fakeGeo.listen(GEO_PORT, '127.0.0.1', resolve));

const mongo = await MongoMemoryServer.create();
const uri = mongo.getUri();

const client = new MongoClient(uri);
await client.connect();
const hash = await bcrypt.hash('motdepasse-commun-123', 10);
await client.db(DB).collection('users').insertMany([
  { uid: 'uid-alice', email: 'alice@example.com', passwordHash: hash, lbcPassword: null, lbcSession: null, lbcStatus: 'ok', lbcCheckedAt: null, createdAt: new Date(Date.now() - 1000) },
  { uid: 'uid-bob', email: 'bob@example.com', passwordHash: hash, lbcPassword: null, lbcSession: null, lbcStatus: 'ok', lbcCheckedAt: null, createdAt: new Date() },
]);
await client.close();

const server = spawn('node', ['server.js'], {
  cwd: new URL('../.next/standalone', import.meta.url).pathname,
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_URI: uri,
    MONGODB_DB: DB,
    SESSION_SECRET: randomBytes(32).toString('base64url'),
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    WORKER_TOKEN,
    WORKER_URL: `http://127.0.0.1:${WORKER_PORT}`,
    GEO_API_URL: `http://127.0.0.1:${GEO_PORT}`,
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (c) => {
  const t = c.toString();
  if (!t.includes('Warning')) process.stderr.write(`[serveur] ${t}`);
});

await waitForServer();
const worker = { 'content-type': 'application/json', 'x-worker-token': WORKER_TOKEN };

/**
 * Marché connu, à Nantes : des studios plus chers au m² que les trois
 * pièces, des passoires (F, G) 15 % sous les autres, une affaire à
 * rafraîchir, un viager, une vente aux enchères, des annonces sans surface,
 * une faute de frappe.
 */
let serial = 0;
function flat({ surface, rooms, perM2, energy = 'D', title, body = '', type = '2', isNew = false, zip = '44000' }) {
  serial += 1;
  const id = String(4_000_000_000 + serial);
  return {
    lbcId: id,
    title: title ?? `Appartement ${rooms} pièces ${surface} m²`,
    url: `https://www.leboncoin.fr/ad/ventes_immobilieres/${id}`,
    price: Math.round(surface * perM2),
    location: `Nantes ${zip}`,
    lat: 47.21,
    lng: -1.55,
    body,
    attributes: {
      real_estate_type: type,
      ...(surface ? { square: `${surface}` } : {}),
      rooms: String(rooms),
      energy_rate: energy.toLowerCase(),
      immo_sell_type: isNew ? 'new' : 'old',
    },
  };
}

function nantes() {
  const ads = [];
  const wobble = (i) => ((i % 5) - 2) * 40;
  for (let i = 0; i < 18; i += 1) ads.push(flat({ surface: 29 + (i % 7), rooms: 1, perM2: 4100 + wobble(i), energy: ['C', 'D', 'E'][i % 3] }));
  for (let i = 0; i < 24; i += 1) ads.push(flat({ surface: 40 + (i % 16), rooms: 2, perM2: 3600 + wobble(i), energy: ['C', 'D', 'B', 'E'][i % 4] }));
  for (let i = 0; i < 20; i += 1) ads.push(flat({ surface: 55 + (i % 14), rooms: 3, perM2: 3300 + wobble(i), energy: ['D', 'C', 'A'][i % 3] }));
  // Passoires : 15 % sous les autres à taille égale.
  for (let i = 0; i < 8; i += 1) ads.push(flat({ surface: 42 + i * 2, rooms: 2, perM2: 3600 * 0.85, energy: i % 2 ? 'F' : 'G' }));
  ads.push(flat({ surface: 48, rooms: 2, perM2: 3600 * 0.68, title: 'Appartement 2 pièces 48 m² à rafraîchir', energy: 'D' }));
  ads.push(flat({ surface: 50, rooms: 2, perM2: 1200, title: 'Viager occupé, appartement 2 pièces' }));
  ads.push(flat({ surface: 60, rooms: 3, perM2: 900, body: 'Vente aux enchères, mise à prix 54 000 €.' }));
  ads.push(flat({ surface: 45, rooms: 2, perM2: 33_000 }));
  for (let i = 0; i < 3; i += 1) ads.push(flat({ surface: 0, rooms: 2, perM2: 3600, title: 'Bel appartement lumineux' }));
  // Sans surface : le prix brut d'une annonce sans m² vient d'un défaut de génération.
  ads.at(-1).price = 170_000;
  ads.at(-2).price = 165_000;
  ads.at(-3).price = 180_000;
  return ads;
}

function rents() {
  const ads = [];
  for (let i = 0; i < 30; i += 1) {
    const surface = 30 + i;
    serial += 1;
    const id = String(5_000_000_000 + serial);
    ads.push({
      lbcId: id,
      title: `Appartement ${surface < 40 ? 1 : 2} pièces ${surface} m²`,
      url: `https://www.leboncoin.fr/ad/locations/${id}`,
      price: Math.round(surface * (14 + ((i % 3) - 1) * 0.4)),
      location: 'Nantes 44000',
      attributes: { real_estate_type: '2', square: String(surface), rooms: surface < 40 ? '1' : '2', furnished: i % 4 ? '2' : '1' },
    });
  }
  ads.push({ ...ads[0], lbcId: '5999999999', title: 'Chambre en colocation dans appartement', price: 450 });
  return ads;
}

const NANTES = { name: 'Nantes', code: '44109', postalCodes: ['44000', '44100', '44200', '44300'], department: '44', lat: 47.2184, lng: -1.5534 };

try {
  const alice = await login('alice@example.com');
  const bob = await login('bob@example.com');

  console.log('\nBascule de mode');
  const initial = await call('GET', '/api/mode', alice);
  check('auto par défaut', initial.mode === 'auto', initial);
  const switched = await call('PUT', '/api/mode', alice, { mode: 'immo' });
  check('bascule en immo', switched.mode === 'immo' && (await call('GET', '/api/mode', alice)).mode === 'immo', switched);
  const bobMode = await call('GET', '/api/mode', bob);
  check('le mode suit le compte, pas l’application', bobMode.mode === 'auto', bobMode);
  const unknown = await raw('PUT', '/api/mode', alice, { mode: 'bateau' });
  check('mode inconnu refusé', unknown.status === 400, unknown.status);
  const anonymousMode = await raw('GET', '/api/mode', '');
  check('anonyme refusé', anonymousMode.status === 401, anonymousMode.status);
  const page = await fetch(`${BASE}/`, { headers: { cookie: alice } }).then((r) => r.text());
  check('l’app se présente en Bon Tracker Immo', page.includes('Bon Tracker Immo') && page.includes('data-mode="immo"'), page.slice(0, 200));
  const bobPage = await fetch(`${BASE}/`, { headers: { cookie: bob } }).then((r) => r.text());
  check('et reste Bon Tracker pour bob', !bobPage.includes('Bon Tracker Immo') && bobPage.includes('data-mode="auto"'), null);

  console.log('\nDonnées séparées par domaine');
  const listing = (id, slug, category) => ({ lbcId: id, title: `Annonce ${id}`, url: `https://www.leboncoin.fr/ad/${slug}/${id}`, price: 1000, category });
  await call('POST', '/api/internal/ingest', worker, {
    uid: 'uid-alice',
    source: 'favorites',
    listings: [
      listing('1111111', 'voitures', 'Voitures'),
      listing('2222222', 'ventes_immobilieres', null),
      listing('3333333', 'locations', 'Locations'),
      listing('4444444', 'consoles_jeux_video', null),
    ],
  });
  const ids = (body) => body.listings.map((item) => item.lbcId).sort();
  const immoListings = await call('GET', '/api/listings?mode=immo', alice);
  check('suivi immo : les biens seulement', JSON.stringify(ids(immoListings)) === '["2222222","3333333"]', ids(immoListings));
  const autoListings = await call('GET', '/api/listings?mode=auto', alice);
  check('suivi auto : tout le reste, objets compris', JSON.stringify(ids(autoListings)) === '["1111111","4444444"]', ids(autoListings));
  const everything = await call('GET', '/api/listings', alice);
  check('sans mode, tout, comme avant', everything.listings.length === 4, everything.listings.length);
  await call('POST', '/api/internal/searches', worker, {
    uid: 'uid-alice',
    searches: [
      { lbcSearchId: 'auto1', name: 'Boxster', url: 'https://www.leboncoin.fr/recherche?category=2&text=boxster' },
      { lbcSearchId: 'immo1', name: 'T2 Nantes', url: 'https://www.leboncoin.fr/recherche?category=9&locations=Nantes&real_estate_type=2' },
      { lbcSearchId: 'immo2', name: 'Loc Rennes', url: 'https://www.leboncoin.fr/recherche?locations=Rennes&category=10' },
      { lbcSearchId: 'auto2', name: 'Tout', url: 'https://www.leboncoin.fr/recherche?text=velo' },
    ],
  });
  const immoSearches = await call('GET', '/api/searches?mode=immo', alice);
  check('recherches immo', JSON.stringify(immoSearches.searches.map((s) => s.lbcSearchId).sort()) === '["immo1","immo2"]', immoSearches.searches.map((s) => s.lbcSearchId));
  const autoSearches = await call('GET', '/api/searches?mode=auto', alice);
  check('recherches auto', JSON.stringify(autoSearches.searches.map((s) => s.lbcSearchId).sort()) === '["auto1","auto2"]', autoSearches.searches.map((s) => s.lbcSearchId));
  const immoStatus = await call('GET', '/api/status?mode=immo', alice);
  check('compteurs des réglages par domaine', immoStatus.activeListings === 2, immoStatus);

  console.log('\nRecherche de commune');
  const byName = await call('GET', '/api/immo/places?q=Nan', alice);
  check('communes par nom, les plus peuplées d’abord', byName.places[0]?.name === 'Nantes' && byName.places[1]?.name === 'Nanterre', byName.places.map((p) => p.name));
  check('centre et codes postaux repris', byName.places[0]?.lat === 47.2184 && byName.places[0]?.lng === -1.5534 && byName.places[0]?.postalCodes.length === 4, byName.places[0]);
  check('arrondissements demandés aussi', geoRequests.some((u) => u.searchParams.get('type')?.includes('arrondissement-municipal')), null);
  const byCode = await call('GET', '/api/immo/places?q=44000', alice);
  check('commune par code postal', byCode.places.length === 1 && byCode.places[0].code === '44109', byCode.places);
  const district = await call('GET', '/api/immo/places?q=75011', alice);
  check('arrondissement par code postal', district.places[0]?.name === 'Paris 11e Arrondissement' && district.places[0]?.department === '75', district.places);
  const offline = await call('GET', '/api/immo/places?q=29200', alice);
  check('référentiel en panne : le code postal suffit', offline.places[0]?.code === 'cp-29200' && offline.places[0]?.department === '29' && offline.places[0]?.lat === null, offline.places);
  const down = await raw('GET', '/api/immo/places?q=panne', alice);
  check('panne par nom : on le dit', down.status === 502 && /code postal/.test((await down.json()).error), down.status);
  const tooShort = await call('GET', '/api/immo/places?q=N', alice);
  check('rien avant deux lettres', tooShort.places.length === 0, tooShort);

  console.log('\nDemande d’estimation');
  const created = await call('POST', '/api/immo/estimations', alice, { transaction: 'vente', propertyType: 'appartement', place: NANTES, radiusKm: 0, surface: 45 });
  check('estimation créée', Boolean(created.id), created);
  const job = jobs.find((j) => j.queryId === created.id);
  check('collecte confiée au collecteur immobilier', job?.path === '/immo' && typeof job.runId === 'string', job);
  check('fourchette de surface autour du bien', job?.surfaceMin === 29 && job?.surfaceMax === 68, job);
  check('lieu, type et rayon transmis', job?.place?.code === '44109' && job.propertyType === 'appartement' && job.transaction === 'vente' && job.radiusKm === 0 && job.locationParam === null, job);
  const again = await call('POST', '/api/immo/estimations', alice, { transaction: 'vente', propertyType: 'appartement', place: NANTES, radiusKm: 0, surface: 45 });
  check('même demande en cours : pas de seconde collecte', again.id === created.id && jobs.length === 1, { again, jobs: jobs.length });
  const badPlace = await raw('POST', '/api/immo/estimations', alice, { transaction: 'vente', propertyType: 'appartement', place: { ...NANTES, code: 'x' }, radiusKm: 0, surface: 45 });
  check('commune inventée refusée', badPlace.status === 400, badPlace.status);
  const noCentre = await raw('POST', '/api/immo/estimations', alice, { transaction: 'vente', propertyType: 'appartement', place: { name: '29200', code: 'cp-29200', postalCodes: ['29200'], department: '29', lat: null, lng: null }, radiusKm: 10, surface: 45 });
  check('rayon sans centre connu refusé', noCentre.status === 400, noCentre.status);
  const tiny = await raw('POST', '/api/immo/estimations', alice, { transaction: 'vente', propertyType: 'appartement', place: NANTES, radiusKm: 0, surface: 3 });
  check('surface absurde refusée', tiny.status === 400, tiny.status);
  const carList = await call('GET', '/api/estimations', alice);
  check('l’immobilier n’apparaît pas au marché auto', carList.estimations.length === 0, carList.estimations.length);

  console.log('\nCollecte simulée');
  const forbidden = await raw('POST', '/api/internal/immo/ads', { 'content-type': 'application/json' }, { queryId: created.id, ads: [] });
  check('route interne fermée sans jeton', forbidden.status === 403, forbidden.status);
  await call('PATCH', `/api/internal/immo/queries/${created.id}`, worker, { runId: job.runId, status: 'running', pages: 0, ads: 0 });
  const market = nantes();
  await call('POST', '/api/internal/immo/ads', worker, { queryId: created.id, ads: market.slice(0, 40) });
  await call('PATCH', `/api/internal/immo/queries/${created.id}`, worker, {
    runId: job.runId,
    pages: 1,
    ads: 40,
    locationParam: 'Nantes_44000',
    activity: { step: 'Page 1 lue · 35 annonces', recent: [{ title: 'Appartement 2 pièces 45 m²', price: 162_000, surface: 45, rooms: 2, imageUrl: null, location: 'Nantes 44000' }], total: 80 },
  });
  const midway = await call('GET', `/api/immo/estimations/${created.id}`, alice);
  check('rien d’exposé avant la fin', midway.ads.length === 0 && midway.analysis === null, midway.ads.length);
  check('activité en direct, surface comprise', midway.estimation.activity?.recent?.[0]?.surface === 45 && midway.estimation.pages === 1, midway.estimation.activity);
  check('forme du lieu apprise', midway.estimation.locationParam === 'Nantes_44000', midway.estimation.locationParam);
  await call('POST', '/api/internal/immo/ads', worker, { queryId: created.id, ads: market.slice(40) });
  await call('PATCH', `/api/internal/immo/queries/${created.id}`, worker, { runId: job.runId, status: 'done', pages: 3 });

  console.log('\nLecture du marché');
  const done = await call('GET', `/api/immo/estimations/${created.id}`, alice);
  const { analysis } = done;
  const byId = (title) => done.ads.find((ad) => ad.title === title);
  check('collecte terminée', done.estimation.status === 'done' && done.ads.length === market.length, { status: done.estimation.status, ads: done.ads.length });
  check('la description ne part pas vers l’écran', done.ads.every((ad) => !('body' in ad)), null);
  const first = done.ads.find((ad) => ad.lbcId === market[0].lbcId);
  check('caractéristiques lues', first.surface === 29 && first.rooms === 1 && first.propertyType === 'appartement' && first.energy === 'C' && first.isNew === false, first);
  check('prix au m² par annonce', first.perM2 === Math.round(first.price / 29 / 10) * 10, first);
  check('viager mis à part', byId('Viager occupé, appartement 2 pièces')?.flags?.includes('Viager'), byId('Viager occupé, appartement 2 pièces'));
  check('enchères repérées dans la description', done.ads.some((ad) => ad.flags?.includes('Enchères')), null);
  check('travaux relevés sans exclure', byId('Appartement 2 pièces 48 m² à rafraîchir')?.tags?.includes('Travaux') && !byId('Appartement 2 pièces 48 m² à rafraîchir')?.flags?.length, byId('Appartement 2 pièces 48 m² à rafraîchir'));
  check('deux annonces à part, trois sans surface, une faute de frappe', analysis.flagged === 2 && analysis.unmeasured === 3 && analysis.excluded === 1, { flagged: analysis.flagged, unmeasured: analysis.unmeasured, excluded: analysis.excluded });
  check('prix au m² médian plausible', analysis.perM2.median > 3300 && analysis.perM2.median < 3800, analysis.perM2);
  check('fourchette ordonnée', analysis.perM2.p25 <= analysis.perM2.median && analysis.perM2.median <= analysis.perM2.p75, analysis.perM2);
  const studio = analysis.rooms.find((r) => r.name === '1 pièce');
  const three = analysis.rooms.find((r) => r.name === '3 pièces');
  check('par pièces, des plus petits aux plus grands', analysis.rooms.map((r) => r.name).join('|') === '1 pièce|2 pièces|3 pièces', analysis.rooms.map((r) => r.name));
  check('un studio coûte plus cher au m² qu’un trois pièces', studio.perM2 > three.perM2 && studio.median < three.median, { studio, three });
  check('décote des passoires mesurée', analysis.energyGap && analysis.energyGap.ratio < -0.1 && analysis.energyGap.ratio > -0.2 && analysis.energyGap.count === 8, analysis.energyGap);
  check('classes du DPE', analysis.energy.map((e) => e.name).join('') === 'ABCDEFG', analysis.energy.map((e) => e.name));
  check('courbe du marché qui monte avec la surface', analysis.trend.length >= 4 && analysis.trend[0].price < analysis.trend.at(-1).price, analysis.trend);
  check('l’affaire à rafraîchir en tête', analysis.deals[0]?.title === 'Appartement 2 pièces 48 m² à rafraîchir', analysis.deals.map((d) => d.title));
  check('écart de l’affaire cohérent', analysis.deals[0]?.ratio > 0.25 && analysis.deals[0]?.ratio < 0.4, analysis.deals[0]);
  check('aucune annonce à part parmi les affaires', analysis.deals.every((d) => !d.flags?.length), analysis.deals.map((d) => d.title));

  console.log('\nValeur d’un bien donné');
  // Attendu : 45 m² × 3 600 €/m², à la variation près — autour de 162 000 €.
  const mine = await call('GET', `/api/immo/estimations/${created.id}?surface=45&rooms=2`, alice);
  check('bien chiffré', mine.estimate && mine.estimate.count >= 4, mine.estimate);
  check('valeur proche du prix théorique', Math.abs(mine.estimate.value - 162_000) < 12_000, mine.estimate?.value);
  check('arrondie au millier', mine.estimate.value % 1000 === 0, mine.estimate.value);
  check('même nombre de pièces respecté', mine.estimate.tolerance.sameRooms && mine.estimate.comparables.every((c) => c.rooms === 2), mine.estimate.tolerance);
  check('fourchette ordonnée', mine.estimate.low <= mine.estimate.value && mine.estimate.value <= mine.estimate.high, mine.estimate);
  const huge = await call('GET', `/api/immo/estimations/${created.id}?surface=400&rooms=8`, alice);
  check('silence faute de comparables', huge.estimate === null, huge.estimate);
  check('pas de loyers connus : pas de rendement', mine.counterpart === null, mine.counterpart);

  console.log('\nRendement face aux loyers');
  const rent = await call('POST', '/api/immo/estimations', alice, { transaction: 'location', propertyType: 'appartement', place: NANTES, radiusKm: 0, surface: 45 });
  const rentJob = jobs.find((j) => j.queryId === rent.id);
  check('loyers : nouvelle collecte, forme du lieu déjà connue', rentJob?.transaction === 'location' && rentJob.locationParam === 'Nantes_44000', rentJob);
  await call('PATCH', `/api/internal/immo/queries/${rent.id}`, worker, { runId: rentJob.runId, status: 'running', pages: 0, ads: 0 });
  await call('POST', '/api/internal/immo/ads', worker, { queryId: rent.id, ads: rents() });
  await call('PATCH', `/api/internal/immo/queries/${rent.id}`, worker, { runId: rentJob.runId, status: 'done', pages: 1 });
  const rentDone = await call('GET', `/api/immo/estimations/${rent.id}`, alice);
  check('loyer au m² plausible', rentDone.analysis.perM2.median > 13.5 && rentDone.analysis.perM2.median < 14.5, rentDone.analysis.perM2);
  check('lu au dixième d’euro', rentDone.ads.some((ad) => ad.perM2 !== null && !Number.isInteger(ad.perM2)), rentDone.ads.map((ad) => ad.perM2).slice(0, 6));
  check('colocation mise à part', rentDone.ads.find((ad) => ad.lbcId === '5999999999')?.flags?.includes('Colocation'), rentDone.ads.find((ad) => ad.lbcId === '5999999999'));
  check('meublé signalé', rentDone.ads.some((ad) => ad.tags?.includes('Meublé')), null);
  const withYield = await call('GET', `/api/immo/estimations/${created.id}`, alice);
  const counterpart = withYield.counterpart;
  check('les loyers d’en face retrouvés', counterpart?.transaction === 'location' && counterpart.id === rent.id && counterpart.perM2 > 13 && counterpart.perM2 < 15, counterpart);
  const yieldRate = (counterpart.perM2 * 12) / withYield.analysis.perM2.median;
  check('rendement brut plausible', yieldRate > 0.04 && yieldRate < 0.06, yieldRate);
  check('et réciproquement', rentDone.counterpart?.transaction === 'vente' && rentDone.counterpart.id === created.id, rentDone.counterpart);

  console.log('\nRéutilisation par un autre compte');
  const before = jobs.length;
  const bobQuery = await call('POST', '/api/immo/estimations', bob, { transaction: 'vente', propertyType: 'appartement', place: NANTES, radiusKm: 0, surface: 45 });
  check('collecte récente réutilisée', bobQuery.reused === true && jobs.length === before, { bobQuery, jobs: jobs.length - before });
  const bobDone = await call('GET', `/api/immo/estimations/${bobQuery.id}`, bob);
  check('mêmes biens pour bob', bobDone.ads.length === market.length && bobDone.estimation.status === 'done', bobDone.ads.length);
  check('les loyers d’alice servent au rendement, sans lien vers son estimation', bobDone.counterpart?.perM2 === counterpart.perM2 && bobDone.counterpart.id === null, bobDone.counterpart);
  const house = await call('POST', '/api/immo/estimations', bob, { transaction: 'vente', propertyType: 'maison', place: NANTES, radiusKm: 10, surface: 110 });
  const houseJob = jobs.find((j) => j.queryId === house.id);
  check('maison avec rayon : autre collecte, fourchette autour de 110 m²', houseJob?.propertyType === 'maison' && houseJob.radiusKm === 10 && houseJob.surfaceMin === 72 && houseJob.surfaceMax === 165 && houseJob.locationParam === null, houseJob);

  console.log('\nArrêt et collectes mortes');
  await call('POST', `/api/immo/estimations/${house.id}/stop`, bob, {});
  const cancelled = await call('GET', `/api/immo/estimations/${house.id}`, bob);
  check('collecte en attente annulée', cancelled.estimation.status === 'error' && /annulée/.test(cancelled.estimation.error), cancelled.estimation);
  const late = await call('PATCH', `/api/internal/immo/queries/${house.id}`, worker, { runId: houseJob.runId, status: 'running', pages: 0, ads: 0 });
  check('son tour venu, le collecteur est prié de s’arrêter', late.stop === true, late);
  const restartedAt = new Date().toISOString();
  const relaunch = await raw('POST', `/api/immo/estimations/${house.id}`, bob, {});
  check('relance acceptée', relaunch.status === 200, relaunch.status);
  const abandon = await call('POST', '/api/internal/market/abandon', worker, { before: new Date(Date.now() + 1000).toISOString() });
  check('le redémarrage du collecteur abandonne aussi l’immobilier', abandon.abandoned === 1, { abandon, restartedAt });
  const orphan = await call('GET', `/api/immo/estimations/${house.id}`, bob);
  check('et le dit', orphan.estimation.status === 'error' && /redémarré/.test(orphan.estimation.error), orphan.estimation);

  console.log('\nCloisonnement');
  const aliceList = await call('GET', '/api/immo/estimations', alice);
  const bobList = await call('GET', '/api/immo/estimations', bob);
  check('alice voit ses deux estimations', aliceList.estimations.length === 2, aliceList.estimations.length);
  check('bob voit les siennes', bobList.estimations.length === 2, bobList.estimations.length);
  check('liste allégée des identifiants', aliceList.estimations.every((e) => !('adIds' in e) && !('pendingIds' in e)), null);
  const peek = await raw('GET', `/api/immo/estimations/${created.id}`, bob);
  check('bob ne lit pas l’estimation d’alice', peek.status === 404, peek.status);
  const steal = await raw('DELETE', `/api/immo/estimations/${created.id}`, bob);
  check('bob ne supprime pas celle d’alice', steal.status === 404, steal.status);
  const halt = await raw('POST', `/api/immo/estimations/${created.id}/stop`, bob, {});
  check('bob n’arrête pas celle d’alice', halt.status === 404, halt.status);
  const crossed = await raw('GET', `/api/estimations/${created.id}`, alice);
  check('une estimation immo n’est pas lisible comme une cote auto', crossed.status === 404, crossed.status);
  const anonymous = await raw('GET', '/api/immo/estimations', '');
  check('anonyme refusé', anonymous.status === 401, anonymous.status);
  const anonymousPlaces = await raw('GET', '/api/immo/places?q=Nantes', '');
  check('recherche de commune réservée aux comptes', anonymousPlaces.status === 401, anonymousPlaces.status);

  console.log('\nSuppression');
  const removed = await raw('DELETE', `/api/immo/estimations/${created.id}`, alice);
  check('suppression', removed.status === 200, removed.status);
  const gone = await raw('GET', `/api/immo/estimations/${created.id}`, alice);
  check('estimation disparue', gone.status === 404, gone.status);
  const bobStill = await call('GET', `/api/immo/estimations/${bobQuery.id}`, bob);
  check('celle de bob, née de la même collecte, demeure', bobStill.ads.length === market.length, bobStill.ads.length);
} finally {
  server.kill();
  fakeWorker.close();
  fakeGeo.close();
  await mongo.stop();
  console.log(`\n${passed} vérifications réussies, ${failed} en échec\n`);
  process.exit(failed ? 1 : 0);
}

async function login(email) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'motdepasse-commun-123' }),
  });
  if (!response.ok) return '';
  return (response.headers.get('set-cookie') ?? '').split(';')[0];
}

async function raw(method, path, auth, body) {
  const headers = typeof auth === 'string' ? { cookie: auth, 'content-type': 'application/json' } : auth;
  return fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function call(method, path, auth, body) {
  const response = await raw(method, path, auth, body);
  return response.json();
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      await fetch(`${BASE}/login`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('Le serveur ne répond pas');
}
