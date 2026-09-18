/**
 * Vérifie qu'aucune donnée ne fuit d'un compte à l'autre.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

const PORT = 3444;
const BASE = `http://127.0.0.1:${PORT}`;
const WORKER_TOKEN = 'jeton-de-test';
const DB = 'bon_tracker_multi';

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

const mongo = await MongoMemoryServer.create();
const uri = mongo.getUri();

// Deux comptes, créés comme le ferait l'inscription.
const client = new MongoClient(uri);
await client.connect();
const users = client.db(DB).collection('users');
const hash = await bcrypt.hash('motdepasse-commun-123', 10);
await users.insertMany([
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

try {
  console.log('\nConnexion des deux comptes');
  const aliceCookie = await login('alice@example.com');
  const bobCookie = await login('bob@example.com');
  check('alice connectée', Boolean(aliceCookie));
  check('bob connecté', Boolean(bobCookie));
  check('sessions distinctes', aliceCookie !== bobCookie);

  console.log('\nCollecte pour chaque compte');
  const ad = (id, price, title) => ({
    lbcId: id,
    title,
    url: `https://www.leboncoin.fr/ad/voitures/${id}`,
    price,
  });

  await post('/api/internal/ingest', worker, {
    uid: 'uid-alice',
    source: 'favorites',
    listings: [ad('111111', 20000, 'Boxster d’Alice'), ad('999999', 30000, 'Annonce commune')],
  });
  await post('/api/internal/ingest', worker, {
    uid: 'uid-bob',
    source: 'favorites',
    listings: [ad('222222', 15000, 'Cayman de Bob'), ad('999999', 31000, 'Annonce commune')],
  });

  const aliceList = await get('/api/listings', aliceCookie);
  const bobList = await get('/api/listings', bobCookie);

  check('alice voit 2 annonces', aliceList.listings.length === 2, aliceList.listings.length);
  check('bob voit 2 annonces', bobList.listings.length === 2, bobList.listings.length);
  check(
    'alice ne voit pas celle de bob',
    !aliceList.listings.some((l) => l.lbcId === '222222'),
    aliceList.listings.map((l) => l.lbcId),
  );
  check(
    'bob ne voit pas celle d’alice',
    !bobList.listings.some((l) => l.lbcId === '111111'),
    bobList.listings.map((l) => l.lbcId),
  );

  console.log('\nMême annonce, deux prix, deux historiques');
  const aliceCommon = aliceList.listings.find((l) => l.lbcId === '999999');
  const bobCommon = bobList.listings.find((l) => l.lbcId === '999999');
  check('prix propre à alice', aliceCommon?.currentPrice === 20000 || aliceCommon?.currentPrice === 30000, aliceCommon?.currentPrice);
  check('prix propre à bob', bobCommon?.currentPrice === 31000, bobCommon?.currentPrice);

  const aliceDetail = await get('/api/listings/999999', aliceCookie);
  const bobDetail = await get('/api/listings/999999', bobCookie);
  check('historique d’alice isolé', aliceDetail.listing.history.length === 1, aliceDetail.listing.history);
  check('historique de bob isolé', bobDetail.listing.history.length === 1, bobDetail.listing.history);
  check(
    'les deux historiques diffèrent',
    aliceDetail.listing.history[0].price !== bobDetail.listing.history[0].price,
    [aliceDetail.listing.history[0].price, bobDetail.listing.history[0].price],
  );

  console.log('\nAnnonce d’un autre compte, demandée directement');
  const stolen = await fetch(`${BASE}/api/listings/222222`, { headers: { cookie: aliceCookie } });
  check('404 et non les données de bob', stolen.status === 404, stolen.status);

  console.log('\nRecherches');
  await post('/api/internal/searches', worker, {
    uid: 'uid-alice',
    searches: [{ lbcSearchId: 'aaa', name: 'Recherche d’alice', url: 'https://www.leboncoin.fr/recherche?a=1' }],
  });
  await post('/api/internal/searches', worker, {
    uid: 'uid-bob',
    searches: [{ lbcSearchId: 'bbb', name: 'Recherche de bob', url: 'https://www.leboncoin.fr/recherche?b=1' }],
  });

  const aliceSearches = await get('/api/searches', aliceCookie);
  check('alice voit sa seule recherche', aliceSearches.searches.length === 1, aliceSearches.searches.map((s) => s.name));
  check('et c’est la sienne', aliceSearches.searches[0]?.lbcSearchId === 'aaa', aliceSearches.searches[0]);

  const patch = await fetch(`${BASE}/api/searches/bbb`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: aliceCookie },
    body: JSON.stringify({ tracked: true }),
  });
  check('alice ne peut pas activer celle de bob', patch.status === 404, patch.status);

  console.log('\nÉtat et relevés');
  await post('/api/internal/runs', worker, {
    uid: 'uid-bob',
    startedAt: new Date().toISOString(),
    status: 'ok',
    stats: { seen: 2, created: 2, priceChanges: 0, deactivated: 0 },
    error: null,
  });

  const aliceStatus = await get('/api/status', aliceCookie);
  const bobStatus = await get('/api/status', bobCookie);
  check('alice n’a aucun relevé', aliceStatus.lastRun === null, aliceStatus.lastRun);
  check('bob a le sien', bobStatus.lastRun?.stats.seen === 2, bobStatus.lastRun);
  check('compteurs propres à alice', aliceStatus.activeListings === 2, aliceStatus.activeListings);

  console.log('\nCloisonnement des accès');
  const anonymous = await fetch(`${BASE}/api/listings`);
  check('sans session : refusé', anonymous.status === 401, anonymous.status);
  const noToken = await fetch(`${BASE}/api/internal/users`);
  check('sans jeton worker : refusé', noToken.status === 403, noToken.status);
} finally {
  server.kill('SIGTERM');
  await mongo.stop();
}

console.log(`\n${passed} vérifications passées, ${failed} en échec`);
process.exit(failed === 0 ? 0 : 1);

async function login(email) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'motdepasse-commun-123' }),
  });
  if (!response.ok) return '';
  return (response.headers.get('set-cookie') ?? '').split(';')[0];
}

async function post(path, headers, body) {
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return response.json();
}

async function get(path, cookie) {
  const response = await fetch(`${BASE}${path}`, { headers: { cookie } });
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
