/**
 * Reproduit une installation d'avant le cloisonnement — un compte sans
 * identifiant interne, des données sans propriétaire — et vérifie qu'après
 * démarrage tout est retrouvé à sa place.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

const PORT = 3555;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = 'bon_tracker_migration';
const EMAIL = 'proprietaire@example.com';
const PASSWORD = 'mon-mot-de-passe-actuel';
const LBC_PASSWORD = 'mot-de-passe-leboncoin';

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
const day = 24 * 60 * 60 * 1000;
const now = Date.now();

// --- Base telle qu'elle existe avant la mise à jour -------------------------
const hash = await bcrypt.hash(PASSWORD, 10);
const client = new MongoClient(uri);
await client.connect();
const db = client.db(DB);

await db.collection('users').insertMany([
  {
    email: EMAIL,
    passwordHash: hash,
    createdAt: new Date(now - 4 * day),
  },
  // Compte fantôme d'une adresse mal saisie : deux documents sans identifiant
  // interne suffisaient à faire échouer l'index qui les distingue, et avec lui
  // toute requête à la base.
  {
    email: 'proprietaire 4@example.com',
    passwordHash: hash,
    createdAt: new Date(now - 3 * day),
  },
]);

await db.collection('listings').insertMany(
  Array.from({ length: 320 }, (_, i) => ({
    lbcId: String(2900000000 + i),
    title: `Annonce ${i}`,
    url: `https://www.leboncoin.fr/ad/voitures/${2900000000 + i}`,
    imageUrl: null,
    category: 'Voitures',
    sellerType: 'pro',
    location: 'Caen 14000',
    currentPrice: 20000 + i,
    firstSeenAt: new Date(now - 2 * day),
    lastSeenAt: new Date(now),
    isActive: true,
    sources: i % 3 === 0 ? ['favorites'] : ['search:a1b2c3d4'],
  })),
);

await db.collection('price_points').insertMany([
  ...Array.from({ length: 320 }, (_, i) => ({
    lbcId: String(2900000000 + i),
    price: 21000 + i,
    observedAt: new Date(now - 2 * day),
  })),
  // Une baisse sur la première annonce : son graphe doit garder deux points.
  { lbcId: '2900000000', price: 20000, observedAt: new Date(now - day) },
]);

await db.collection('searches').insertOne({
  lbcSearchId: 'a1b2c3d4',
  name: '981 - Boxster 2012-2016',
  url: 'https://www.leboncoin.fr/recherche?text=boxster',
  details: 'PORSCHE · Boxster · 2012 - 2016',
  tracked: true,
  lastRunAt: new Date(now - day),
  itemCount: 32,
});

await db.collection('runs').insertOne({
  startedAt: new Date(now - day),
  finishedAt: new Date(now - day + 60000),
  status: 'ok',
  stats: { seen: 320, created: 185, priceChanges: 1, deactivated: 0 },
  error: null,
});

await client.close();

// --- Démarrage de la version cloisonnée -------------------------------------
const server = spawn('node', ['server.js'], {
  cwd: new URL('../.next/standalone', import.meta.url).pathname,
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_URI: uri,
    MONGODB_DB: DB,
    SESSION_SECRET: randomBytes(32).toString('base64url'),
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    WORKER_TOKEN: 'jeton-de-test',
    ADMIN_EMAIL: EMAIL,
    ADMIN_PASSWORD_HASH_B64: Buffer.from(hash, 'utf8').toString('base64'),
    LBC_PASSWORD_B64: Buffer.from(LBC_PASSWORD, 'utf8').toString('base64'),
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (c) => {
  const t = c.toString();
  if (!t.includes('Warning')) process.stderr.write(`[serveur] ${t}`);
});

await waitForServer();

try {
  console.log('\nConnexion avec le mot de passe d’avant');
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  check('connexion acceptée', login.status === 200, login.status);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

  console.log('\nDonnées retrouvées');
  const list = await get('/api/listings', cookie);
  check('320 annonces présentes', list.listings?.length === 320, list.listings?.length);

  const first = list.listings?.find((l) => l.lbcId === '2900000000');
  check('prix courant conservé', first?.currentPrice === 20000, first?.currentPrice);
  check('prix initial conservé', first?.initialPrice === 21000, first?.initialPrice);
  check('changement de prix compté', first?.priceChangeCount === 1, first?.priceChangeCount);

  const detail = await get('/api/listings/2900000000', cookie);
  check('historique à deux points', detail.listing?.history?.length === 2, detail.listing?.history);

  const searches = await get('/api/searches', cookie);
  check('recherche retrouvée', searches.searches?.length === 1, searches.searches?.length);
  check('toujours suivie', searches.searches?.[0]?.tracked === true, searches.searches?.[0]);

  const status = await get('/api/status', cookie);
  check('dernier relevé retrouvé', status.lastRun?.stats?.seen === 320, status.lastRun);
  check('compteur d’annonces juste', status.activeListings === 320, status.activeListings);

  console.log('\nFiltres par source');
  const favorites = await get('/api/listings?source=favorites', cookie);
  check('filtre favoris fonctionnel', favorites.listings?.length === 107, favorites.listings?.length);

  console.log('\nCompte prêt pour la collecte');
  const users = await fetch(`${BASE}/api/internal/users`, {
    headers: { 'x-worker-token': 'jeton-de-test' },
  }).then((r) => r.json());
  check('les deux comptes sont relevables', users.users?.length === 2, users.users?.length);
  check(
    'chacun a reçu son identifiant',
    users.users?.every((u) => typeof u.uid === 'string' && u.uid.length > 10),
    users.users?.map((u) => u.uid),
  );
  check(
    'identifiants distincts',
    new Set(users.users?.map((u) => u.uid)).size === users.users?.length,
    users.users?.map((u) => u.uid),
  );
  check(
    'mot de passe leboncoin récupérable',
    users.users?.some((u) => u.password === LBC_PASSWORD),
    users.users?.some((u) => u.password) ? '(présent)' : '(absent)',
  );

  console.log('\nRelance : rien ne doit bouger');
  const again = await get('/api/listings', cookie);
  check('toujours 320 annonces', again.listings?.length === 320, again.listings?.length);
} finally {
  server.kill('SIGTERM');
  await mongo.stop();
}

console.log(`\n${passed} vérifications passées, ${failed} en échec`);
process.exit(failed === 0 ? 0 : 1);

async function get(path, cookie) {
  return (await fetch(`${BASE}${path}`, { headers: { cookie } })).json();
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
