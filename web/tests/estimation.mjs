/**
 * Vérifie la cote d'un modèle de bout en bout : demande, collecte simulée,
 * statistiques, motorisations, bonnes affaires, estimation d'une voiture
 * donnée, réutilisation d'une collecte récente et cloisonnement.
 *
 * Le collecteur est remplacé par un petit serveur local qui enregistre ce
 * qu'on lui confie ; les annonces passent ensuite par les vraies routes
 * internes, comme en production.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

const PORT = 3446;
const WORKER_PORT = 3447;
const BASE = `http://127.0.0.1:${PORT}`;
const WORKER_TOKEN = 'jeton-de-test';
const DB = 'bon_tracker_estimation';

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
};

// Faux collecteur : retient les demandes, répond comme le vrai.
const jobs = [];
const fakeWorker = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    if (request.url === '/market' && request.headers['x-worker-token'] === WORKER_TOKEN) {
      jobs.push(JSON.parse(body));
      response.writeHead(202).end('{}');
    } else {
      response.writeHead(403).end();
    }
  });
});
await new Promise((resolve) => fakeWorker.listen(WORKER_PORT, '127.0.0.1', resolve));

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
 * Marché connu : deux motorisations, un prix qui baisse avec les kilomètres
 * et monte avec l'année, une affaire évidente, une épave et une annonce sans
 * kilométrage.
 */
function market() {
  const ads = [];
  for (let i = 0; i < 30; i += 1) {
    const km = 60_000 + i * 5_000;
    const year = 2000 + (i % 5);
    ads.push(ad(`s${i}`, 'Boxster 3.2 S', year, km, 26_000 - km * 0.05 + (year - 2000) * 800));
  }
  for (let i = 0; i < 20; i += 1) {
    const km = 90_000 + i * 6_000;
    const year = 1997 + (i % 3);
    ads.push(ad(`b${i}`, 'Boxster 2.5', year, km, 15_000 - km * 0.03));
  }
  ads.push(ad('affaire', 'Boxster 3.2 S', 2002, 100_000, 12_000));
  ads.push(ad('epave', 'Boxster 2.5', 1998, 250_000, 1_500));
  ads.push({ ...ad('sanskm', 'Boxster 3.2 S', 2001, 0, 19_000), attributes: { u_car_version: 'Boxster 3.2 S', regdate: '2001', u_car_brand: 'PORSCHE', u_car_model: 'PORSCHE_Boxster' } });
  return ads;
}

function ad(id, version, year, km, price) {
  return {
    lbcId: id,
    title: `Porsche ${version} ${year}`,
    url: `https://www.leboncoin.fr/ad/voitures/${id}`,
    price: Math.round(price),
    location: 'Caen 14000',
    attributes: {
      u_car_brand: 'PORSCHE',
      u_car_model: 'PORSCHE_Boxster',
      u_car_version: version,
      regdate: String(year),
      mileage: String(km),
    },
  };
}

try {
  const alice = await login('alice@example.com');
  const bob = await login('bob@example.com');

  console.log('\nDemande d’estimation');
  const created = await call('POST', '/api/estimations', alice, { brand: 'Porsche', model: 'Boxster', yearMin: 1997, yearMax: 2004 });
  check('estimation créée', Boolean(created.id), created);
  check('collecte confiée au collecteur', jobs.length === 1 && jobs[0].queryId === created.id, jobs);
  check('modèle transmis', jobs[0]?.brand === 'Porsche' && jobs[0]?.model === 'Boxster' && jobs[0]?.yearMin === 1997, jobs[0]);

  const again = await call('POST', '/api/estimations', alice, { brand: 'porsche', model: 'BOXSTER', yearMin: 1997, yearMax: 2004 });
  check('même demande en cours : pas de seconde collecte', again.id === created.id && jobs.length === 1, { again, jobs: jobs.length });

  const invalid = await raw('POST', '/api/estimations', alice, { brand: '', model: 'X' });
  check('demande incomplète refusée', invalid.status === 400, invalid.status);
  const reversed = await raw('POST', '/api/estimations', alice, { brand: 'Porsche', model: 'Boxster', yearMin: 2005, yearMax: 2000 });
  check('années inversées refusées', reversed.status === 400, reversed.status);

  console.log('\nCollecte simulée');
  const forbidden = await raw('POST', '/api/internal/market/ads', { 'content-type': 'application/json' }, { queryId: created.id, ads: [] });
  check('route interne fermée sans jeton', forbidden.status === 403, forbidden.status);

  await call('PATCH', `/api/internal/market/queries/${created.id}`, worker, { status: 'running', pages: 0, ads: 0 });
  const running = await call('GET', `/api/estimations/${created.id}`, alice);
  check('statut en cours visible', running.estimation.status === 'running', running.estimation.status);

  const ads = market();
  await call('POST', '/api/internal/market/ads', worker, { queryId: created.id, ads: ads.slice(0, 30) });
  await call('PATCH', `/api/internal/market/queries/${created.id}`, worker, { status: 'running', pages: 1, ads: 30, codes: { brand: 'PORSCHE', model: 'PORSCHE_Boxster' } });
  const midway = await call('GET', `/api/estimations/${created.id}`, alice);
  check('rien d’exposé avant la fin de la collecte', midway.ads.length === 0, midway.ads.length);
  check('avancement remonté', midway.estimation.pages === 1 && midway.estimation.ads === 30, midway.estimation);

  await call('POST', '/api/internal/market/ads', worker, { queryId: created.id, ads: ads.slice(30) });
  await call('PATCH', `/api/internal/market/queries/${created.id}`, worker, { status: 'done', pages: 2 });

  console.log('\nLecture du modèle');
  const done = await call('GET', `/api/estimations/${created.id}`, alice);
  const { analysis } = done;
  check('collecte terminée', done.estimation.status === 'done' && done.estimation.collectedAt, done.estimation);
  check('toutes les annonces rattachées', done.ads.length === ads.length && done.estimation.ads === ads.length, done.ads.length);
  check('épave écartée', analysis.excluded === 1 && !done.estimate, analysis.excluded);
  check('deux motorisations, la plus courante d’abord', analysis.versions[0]?.name === 'Boxster 3.2 S' && analysis.versions[0]?.count === 32 && analysis.versions[1]?.name === 'Boxster 2.5' && analysis.versions[1]?.count === 20, analysis.versions);
  check('années couvertes', analysis.yearMin === 1997 && analysis.yearMax === 2004, [analysis.yearMin, analysis.yearMax]);
  check('courbe du marché', analysis.trend.length >= 4, analysis.trend);
  check('la courbe descend avec les kilomètres', analysis.trend[0].price > analysis.trend[analysis.trend.length - 1].price, analysis.trend);
  check('l’affaire est repérée en tête', analysis.deals[0]?.lbcId === 'affaire', analysis.deals.map((d) => d.lbcId));
  check('écart de l’affaire cohérent', analysis.deals[0]?.ratio > 0.3 && analysis.deals[0]?.ratio < 0.6, analysis.deals[0]);
  check('annonce sans kilométrage conservée', done.ads.some((a) => a.lbcId === 'sanskm' && a.km === null), null);
  check('caractéristiques lues', done.ads.find((a) => a.lbcId === 's0')?.version === 'Boxster 3.2 S' && done.ads.find((a) => a.lbcId === 's0')?.year === 2000, done.ads.find((a) => a.lbcId === 's0'));

  console.log('\nEstimation d’une voiture donnée');
  // Attendu d'après le modèle de prix : 26 000 − 100 000 × 0,05 + 2 × 800 = 22 600.
  const mine = await call('GET', `/api/estimations/${created.id}?km=100000&year=2002&version=${encodeURIComponent('Boxster 3.2 S')}`, alice);
  check('estimation chiffrée', mine.estimate && mine.estimate.count >= 4, mine.estimate);
  check('valeur proche du prix théorique', Math.abs(mine.estimate.median - 22_600) < 1_500, mine.estimate?.median);
  check('même motorisation respectée', mine.estimate.tolerance.sameVersion && mine.estimate.comparables.every((c) => c.version === 'Boxster 3.2 S'), mine.estimate.tolerance);
  check('fourchette ordonnée', mine.estimate.p25 <= mine.estimate.median && mine.estimate.median <= mine.estimate.p75, mine.estimate);

  const older = await call('GET', `/api/estimations/${created.id}?km=120000&year=1998&version=${encodeURIComponent('Boxster 2.5')}`, alice);
  check('une 2.5 vaut moins qu’une 3.2 S', older.estimate && older.estimate.median < mine.estimate.median, older.estimate?.median);

  const lonely = await call('GET', `/api/estimations/${created.id}?km=5000&year=2020&version=${encodeURIComponent('Boxster 3.2 S')}`, alice);
  check('silence faute de comparables', lonely.estimate === null, lonely.estimate);

  console.log('\nRéutilisation par un autre compte');
  const bobQuery = await call('POST', '/api/estimations', bob, { brand: 'Porsche', model: 'Boxster', yearMin: 1997, yearMax: 2004 });
  check('collecte récente réutilisée', bobQuery.reused === true && jobs.length === 1, { bobQuery, jobs: jobs.length });
  const bobDone = await call('GET', `/api/estimations/${bobQuery.id}`, bob);
  check('mêmes annonces pour bob', bobDone.ads.length === ads.length && bobDone.estimation.status === 'done', bobDone.ads.length);
  check('estimation distincte de celle d’alice', bobQuery.id !== created.id, bobQuery.id);

  const otherModel = await call('POST', '/api/estimations', bob, { brand: 'Porsche', model: 'Boxster', yearMin: 2005, yearMax: 2012 });
  check('autres années : nouvelle collecte, codes déjà connus', jobs.length === 2 && jobs[1].codes?.model === 'PORSCHE_Boxster', jobs[1]);

  console.log('\nCloisonnement');
  const aliceList = await call('GET', '/api/estimations', alice);
  const bobList = await call('GET', '/api/estimations', bob);
  check('alice voit sa seule estimation', aliceList.estimations.length === 1, aliceList.estimations.length);
  check('bob voit ses deux estimations', bobList.estimations.length === 2, bobList.estimations.length);
  check('liste allégée des identifiants', aliceList.estimations.every((e) => !('adIds' in e) && !('pendingIds' in e)), null);
  const peek = await raw('GET', `/api/estimations/${created.id}`, bob);
  check('bob ne lit pas l’estimation d’alice', peek.status === 404, peek.status);
  const steal = await raw('DELETE', `/api/estimations/${created.id}`, bob);
  check('bob ne supprime pas celle d’alice', steal.status === 404, steal.status);
  const anonymous = await raw('GET', '/api/estimations', '');
  check('anonyme refusé', anonymous.status === 401, anonymous.status);

  console.log('\nCatalogue');
  const catalogue = await call('GET', '/api/estimations/catalogue', alice);
  const porsche = catalogue.brands.find((b) => b.brand.toLowerCase() === 'porsche');
  check('marque et modèle proposés', porsche && porsche.models.includes('Boxster'), catalogue.brands);

  console.log('\nRelance et suppression');
  const refreshed = await raw('POST', `/api/estimations/${created.id}`, alice, {});
  check('relance acceptée', refreshed.status === 200 && jobs.length === 3, jobs.length);
  await call('PATCH', `/api/internal/market/queries/${created.id}`, worker, { status: 'error', error: 'Accès restreint' });
  const failedRun = await call('GET', `/api/estimations/${created.id}`, alice);
  check('un échec garde la collecte précédente', failedRun.estimation.status === 'error' && failedRun.ads.length === ads.length, failedRun.ads.length);
  const removed = await raw('DELETE', `/api/estimations/${created.id}`, alice);
  check('suppression', removed.status === 200, removed.status);
  const gone = await raw('GET', `/api/estimations/${created.id}`, alice);
  check('estimation disparue', gone.status === 404, gone.status);
} finally {
  server.kill();
  fakeWorker.close();
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
