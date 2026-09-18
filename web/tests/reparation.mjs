/**
 * Une première migration a pu désigner le mauvais propriétaire : les données
 * portent alors l'identifiant d'un compte né d'une adresse mal saisie, et le
 * compte légitime paraît vide. Ce test vérifie qu'elles lui reviennent.
 */
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

const PORT = 3888;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = 'bon_tracker_reparation';
const EMAIL = 'proprietaire@example.com';
const PASSWORD = 'mon-mot-de-passe';
const GHOST_UID = randomUUID();
const GOOD_UID = randomUUID();
const day = 86_400_000;
const now = Date.now();

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
const client = new MongoClient(uri);
await client.connect();
const db = client.db(DB);
const hash = await bcrypt.hash(PASSWORD, 10);

// État après une migration qui a choisi le mauvais propriétaire.
await db.collection('users').insertMany([
  { uid: GHOST_UID, email: 'proprietaire 4@example.com', passwordHash: hash, lbcPassword: null, lbcSession: null, lbcStatus: 'ok', lbcCheckedAt: null, createdAt: new Date(now - 5 * day) },
  { uid: GOOD_UID, email: EMAIL, passwordHash: hash, lbcPassword: null, lbcSession: null, lbcStatus: 'ok', lbcCheckedAt: null, createdAt: new Date(now - 4 * day) },
]);

await db.collection('listings').insertMany(
  Array.from({ length: 320 }, (_, i) => ({
    uid: GHOST_UID,
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
    sources: ['favorites'],
  })),
);
await db.collection('price_points').insertMany(
  Array.from({ length: 320 }, (_, i) => ({
    uid: GHOST_UID,
    lbcId: String(2900000000 + i),
    price: 20000 + i,
    observedAt: new Date(now - 2 * day),
  })),
);
await db.collection('searches').insertOne({
  uid: GHOST_UID,
  lbcSearchId: 'seg',
  name: '981 - Boxster 2012-2016',
  url: 'https://www.leboncoin.fr/recherche?x=1',
  details: null,
  tracked: true,
  lastRunAt: new Date(now - day),
  itemCount: 32,
});
await db.collection('runs').insertOne({
  uid: GHOST_UID,
  startedAt: new Date(now - day),
  finishedAt: new Date(now - day),
  status: 'ok',
  stats: { seen: 320, created: 185, priceChanges: 1, deactivated: 0 },
  error: null,
});
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
    WORKER_TOKEN: 'jeton-de-test',
    ADMIN_EMAIL: EMAIL,
    ADMIN_PASSWORD_HASH_B64: Buffer.from(hash, 'utf8').toString('base64'),
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
  console.log('\nLe compte légitime retrouve ses données');
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  check('connexion acceptée', login.status === 200, login.status);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

  const list = await get('/api/listings', cookie);
  check('320 annonces récupérées', list.listings?.length === 320, list.listings?.length);

  const detail = await get('/api/listings/2900000000', cookie);
  check('historique suivi', detail.listing?.history?.length === 1, detail.listing?.history);

  const searches = await get('/api/searches', cookie);
  check('recherche récupérée', searches.searches?.length === 1, searches.searches?.length);
  check('toujours suivie', searches.searches?.[0]?.tracked === true, searches.searches?.[0]);

  const status = await get('/api/status', cookie);
  check('relevé récupéré', status.lastRun?.stats?.seen === 320, status.lastRun);

  console.log('\nLe compte fantôme disparaît');
  const users = await fetch(`${BASE}/api/internal/users`, {
    headers: { 'x-worker-token': 'jeton-de-test' },
  }).then((r) => r.json());
  check('un seul compte', users.users?.length === 1, users.users?.map((u) => u.email));
  check('le bon', users.users?.[0]?.email === EMAIL, users.users?.[0]?.email);
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
