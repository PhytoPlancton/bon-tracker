/**
 * Vérifie la connexion : adresse inconnue dite comme telle, mot de passe
 * changé sur leboncoin accepté après vérification auprès du site, refus de
 * leboncoin relayé, collecteur injoignable, limiteur propre à chaque visiteur.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

const PORT = 3452;
const WORKER_PORT = 3453;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = 'bon_tracker_connexion';

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

// Faux collecteur : leboncoin n'accepte que « nouveau-mot-de-passe ».
const verifications = [];
let workerUp = true;
const fakeWorker = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    if (!workerUp) return void response.destroy();
    const { email, password } = JSON.parse(body || '{}');
    verifications.push({ email, password });
    const outcome = password === 'nouveau-mot-de-passe' ? 'ok' : 'bad_credentials';
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({ outcome, detail: '', ...(outcome === 'ok' ? { storageState: { cookies: [], origins: [] } } : {}) }),
    );
  });
});
await new Promise((resolve) => fakeWorker.listen(WORKER_PORT, '127.0.0.1', resolve));

const mongo = await MongoMemoryServer.create();
const uri = mongo.getUri();
const client = new MongoClient(uri);
await client.connect();
await client.db(DB).collection('users').insertOne({
  uid: 'uid-enzo', email: 'enzo@icloud.com', passwordHash: await bcrypt.hash('ancien-mot-de-passe', 10),
  lbcPassword: null, lbcSession: null, lbcStatus: 'ok', lbcCheckedAt: null, createdAt: new Date(),
});

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
    WORKER_URL: `http://127.0.0.1:${WORKER_PORT}`,
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await waitForServer();

let visitor = 0;
async function login(email, password, ip = `10.0.0.${(visitor += 1)}`) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  console.log('\nConnexion');
  const unknown = await login('quelquun@icloud.com', 'peu-importe');
  check('adresse inconnue : dite comme telle', unknown.status === 401 && unknown.body.code === 'no_account' && /Aucun compte/.test(unknown.body.error), unknown);
  check('sans interroger leboncoin', verifications.length === 0, verifications);

  const right = await login('Enzo@iCloud.com ', 'ancien-mot-de-passe');
  check('bon mot de passe, casse indifférente', right.status === 200, right);
  check('toujours sans leboncoin', verifications.length === 0, verifications);

  const changed = await login('enzo@icloud.com', 'nouveau-mot-de-passe');
  check('mot de passe changé sur leboncoin : accepté après vérification', changed.status === 200 && verifications.length === 1, { changed, verifications });
  const stored = await client.db(DB).collection('users').findOne({ uid: 'uid-enzo' });
  check('il devient celui du compte, session reprise', await bcrypt.compare('nouveau-mot-de-passe', stored.passwordHash) && stored.lbcPassword && stored.lbcSession, null);
  const next = await login('enzo@icloud.com', 'nouveau-mot-de-passe');
  check('la fois suivante, sans repasser par leboncoin', next.status === 200 && verifications.length === 1, verifications.length);

  const refused = await login('enzo@icloud.com', 'faute-de-frappe');
  check('refus de leboncoin relayé', refused.status === 401 && /leboncoin a refusé/.test(refused.body.error), refused);

  workerUp = false;
  const unreachable = await login('enzo@icloud.com', 'autre-essai');
  check('collecteur injoignable : dit, sans accepter', unreachable.status === 503 && /injoignable/.test(unreachable.body.error), unreachable);

  console.log('\nLimiteur de tentatives');
  for (let i = 0; i < 5; i += 1) await login('quelquun@icloud.com', 'x', '10.9.9.9');
  const blocked = await login('quelquun@icloud.com', 'x', '10.9.9.9');
  check('cinq essais, puis une pause', blocked.status === 429 && /min/.test(blocked.body.error), blocked);
  const other = await login('enzo@icloud.com', 'nouveau-mot-de-passe', '10.8.8.8');
  check('un autre visiteur n’en pâtit pas', other.status === 200, other);
} finally {
  server.kill();
  fakeWorker.close();
  await client.close();
  await mongo.stop();
  console.log(`\n${passed} vérifications réussies, ${failed} en échec\n`);
  process.exit(failed ? 1 : 0);
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
