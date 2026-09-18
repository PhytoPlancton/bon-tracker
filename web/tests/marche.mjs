/**
 * Éprouve les repères de marché sur un jeu de prix connu, où médiane et
 * quartiles se calculent de tête. Ces chiffres orientent des décisions
 * d'achat : une erreur de calcul désignerait de fausses affaires.
 */
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

const PORT = 3777;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = 'bon_tracker_marche_test';
const UID = randomUUID();
const EMAIL = 'test@example.com';
const PASSWORD = 'motdepasse-de-test-123';
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

await db.collection('users').insertOne({
  uid: UID,
  email: EMAIL,
  passwordHash: await bcrypt.hash(PASSWORD, 10),
  lbcPassword: null,
  lbcSession: null,
  lbcStatus: 'ok',
  lbcCheckedAt: null,
  createdAt: new Date(now - 30 * day),
});

await db.collection('searches').insertMany([
  {
    uid: UID,
    lbcSearchId: 'seg',
    name: 'Segment de test',
    url: 'https://www.leboncoin.fr/recherche?x=1',
    details: null,
    tracked: true,
    lastRunAt: new Date(now),
    itemCount: 9,
  },
  {
    uid: UID,
    lbcSearchId: 'mince',
    name: 'Segment trop mince',
    url: 'https://www.leboncoin.fr/recherche?x=2',
    details: null,
    tracked: true,
    lastRunAt: new Date(now),
    itemCount: 3,
  },
]);

// Neuf prix réguliers : médiane 5 000, p25 3 000, p75 7 000.
const prices = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000];
await db.collection('listings').insertMany([
  ...prices.map((price, i) => ({
    uid: UID,
    lbcId: `a${i}`,
    title: `Annonce ${price}`,
    url: `https://www.leboncoin.fr/ad/voitures/10000${i}`,
    imageUrl: null,
    category: null,
    sellerType: null,
    location: null,
    currentPrice: price,
    firstSeenAt: new Date(now - 20 * day),
    lastSeenAt: new Date(now),
    isActive: true,
    sources: ['search:seg'],
  })),
  // Trois annonces parties : trop peu pour une durée de vie publiable.
  ...[0, 1, 2].map((i) => ({
    uid: UID,
    lbcId: `z${i}`,
    title: `Partie ${i}`,
    url: `https://www.leboncoin.fr/ad/voitures/20000${i}`,
    imageUrl: null,
    category: null,
    sellerType: null,
    location: null,
    currentPrice: 5000,
    firstSeenAt: new Date(now - 30 * day),
    lastSeenAt: new Date(now - 20 * day),
    isActive: false,
    sources: ['search:seg'],
  })),
  // Segment sous le seuil : aucune statistique ne doit en sortir.
  ...[0, 1, 2].map((i) => ({
    uid: UID,
    lbcId: `m${i}`,
    title: `Mince ${i}`,
    url: `https://www.leboncoin.fr/ad/voitures/30000${i}`,
    imageUrl: null,
    category: null,
    sellerType: null,
    location: null,
    currentPrice: 1000 * (i + 1),
    firstSeenAt: new Date(now - 10 * day),
    lastSeenAt: new Date(now),
    isActive: true,
    sources: ['search:mince'],
  })),
]);

// Une annonce qui a baissé trois fois, et une qui n'a jamais bougé.
await db.collection('price_points').insertMany([
  { uid: UID, lbcId: 'a0', price: 2500, observedAt: new Date(now - 20 * day) },
  { uid: UID, lbcId: 'a0', price: 2000, observedAt: new Date(now - 14 * day) },
  { uid: UID, lbcId: 'a0', price: 1500, observedAt: new Date(now - 7 * day) },
  { uid: UID, lbcId: 'a0', price: 1000, observedAt: new Date(now - day) },
  { uid: UID, lbcId: 'a8', price: 9000, observedAt: new Date(now - 20 * day) },
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
    WORKER_TOKEN: 'jeton-de-test',
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
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

  const { segments } = await fetch(`${BASE}/api/market`, { headers: { cookie } }).then((r) =>
    r.json(),
  );

  console.log('\nRepères du segment');
  const seg = segments.find((s) => s.source === 'search:seg');
  check('segment présent', Boolean(seg));
  check('médiane à 5 000', seg?.stats?.median === 5000, seg?.stats?.median);
  check('premier quartile à 3 000', seg?.stats?.p25 === 3000, seg?.stats?.p25);
  check('troisième quartile à 7 000', seg?.stats?.p75 === 7000, seg?.stats?.p75);
  check('minimum et maximum', seg?.stats?.min === 1000 && seg?.stats?.max === 9000, [
    seg?.stats?.min,
    seg?.stats?.max,
  ]);
  check('annonces en ligne comptées', seg?.active === 9, seg?.active);

  console.log('\nAffaires');
  const dealIds = seg?.deals?.map((d) => d.lbcId) ?? [];
  check('les deux prix sous le quartile', dealIds.length === 2, dealIds);
  check('la moins chère en tête', dealIds[0] === 'a0', dealIds);
  check(
    'écart à la médiane exact',
    seg?.deals?.[0]?.gap === -4000,
    seg?.deals?.[0]?.gap,
  );
  check(
    'aucune annonce au-dessus du marché signalée',
    seg?.deals?.every((d) => d.price < 5000),
    seg?.deals?.map((d) => d.price),
  );

  console.log('\nVendeurs qui baissent');
  const motivated = seg?.motivated ?? [];
  check('une seule annonce retenue', motivated.length === 1, motivated.map((m) => m.lbcId));
  check('trois baisses comptées', motivated[0]?.drops === 3, motivated[0]?.drops);
  check('total cédé exact', motivated[0]?.totalDrop === 1500, motivated[0]?.totalDrop);

  console.log('\nPrudence sur les petits échantillons');
  const mince = segments.find((s) => s.source === 'search:mince');
  check('segment listé', Boolean(mince), segments.map((s) => s.source));
  check('mais sans repère de prix', mince?.stats === null, mince?.stats);
  check('durée de vie tue faute de recul', seg?.lifespan === null, seg?.lifespan);

  console.log('\nCloisonnement');
  const anonymous = await fetch(`${BASE}/api/market`);
  check('sans session : refusé', anonymous.status === 401, anonymous.status);
} finally {
  server.kill('SIGTERM');
  await mongo.stop();
}

console.log(`\n${passed} vérifications passées, ${failed} en échec`);
process.exit(failed === 0 ? 0 : 1);

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
