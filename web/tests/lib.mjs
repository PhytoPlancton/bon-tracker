/**
 * Socle commun des tests de bout en bout : une base éphémère, le serveur
 * réellement compilé, un faux collecteur et un faux service de notification
 * qui enregistrent tout ce qu'on leur envoie.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

export const WORKER_TOKEN = 'jeton-de-test';
export const PASSWORD = 'motdepasse-commun-123';

export function checker() {
  const state = { passed: 0, failed: 0 };
  const check = (label, ok, detail) => {
    if (ok) {
      state.passed += 1;
      console.log(`  ok   ${label}`);
    } else {
      state.failed += 1;
      console.log(`  FAIL ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
    }
  };
  return { check, state };
}

export async function startStack({ db, port, users = ['alice', 'bob'] }) {
  const jobs = { market: [], ad: [] };
  const pushes = [];

  const listen = (handler, tls) =>
    new Promise((resolve) => {
      const server = tls ? createSecureServer(tls, handler) : createServer(handler);
      server.listen(0, '127.0.0.1', () => resolve(server));
    });

  // Les services de notification ne parlent qu'en https : le faux aussi,
  // avec un certificat de circonstance.
  const folder = mkdtempSync(join(tmpdir(), 'bt-push-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-keyout', join(folder, 'key.pem'), '-out', join(folder, 'cert.pem'),
  ], { stdio: 'ignore' });
  const tls = { key: readFileSync(join(folder, 'key.pem')), cert: readFileSync(join(folder, 'cert.pem')) };

  const fakeWorker = await listen((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      if (request.headers['x-worker-token'] !== WORKER_TOKEN) return response.writeHead(403).end();
      if (request.url === '/market') jobs.market.push(JSON.parse(body));
      else if (request.url === '/ad') jobs.ad.push(JSON.parse(body));
      else return response.writeHead(404).end();
      response.writeHead(202).end('{}');
    });
  });

  // Faux service de notification : il accepte tout, sauf les appareils
  // « disparus », comme le ferait Apple ou Google.
  const fakePush = await listen((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      pushes.push({ path: request.url, headers: request.headers, size: Buffer.concat(chunks).length });
      response.writeHead(request.url.includes('disparu') ? 410 : 201).end();
    });
  }, tls);

  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();
  const client = new MongoClient(uri);
  await client.connect();
  const hash = await bcrypt.hash(PASSWORD, 10);
  await client
    .db(db)
    .collection('users')
    .insertMany(
      users.map((name, index) => ({
        uid: `uid-${name}`,
        email: `${name}@example.com`,
        passwordHash: hash,
        lbcPassword: null,
        lbcSession: null,
        lbcStatus: 'ok',
        lbcCheckedAt: null,
        createdAt: new Date(Date.now() - 1000 + index),
      })),
    );

  const base = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['server.js'], {
    // STANDALONE_DIR vise une copie isolée du build, comme dans l'image :
    // aucun node_modules parent où se rattraper d'une dépendance oubliée.
    cwd: process.env.STANDALONE_DIR || new URL('../.next/standalone', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(port),
      MONGODB_URI: uri,
      MONGODB_DB: db,
      SESSION_SECRET: randomBytes(32).toString('base64url'),
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      WORKER_TOKEN,
      WORKER_URL: `http://127.0.0.1:${fakeWorker.address().port}`,
      // Le faux service tourne sur la machine, avec un certificat de test.
      PUSH_ALLOW_LOCAL: 'true',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (!text.includes('Warning')) process.stderr.write(`[serveur] ${text}`);
  });

  for (let i = 0; ; i += 1) {
    try {
      await fetch(`${base}/login`);
      break;
    } catch {
      if (i > 60) throw new Error('Le serveur ne répond pas');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const raw = (method, path, auth, body) => {
    const headers = typeof auth === 'string' ? { cookie: auth, 'content-type': 'application/json' } : auth;
    return fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  const call = async (method, path, auth, body) => (await raw(method, path, auth, body)).json();
  const login = async (name) => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${name}@example.com`, password: PASSWORD }),
    });
    return (response.headers.get('set-cookie') ?? '').split(';')[0];
  };

  return {
    base,
    jobs,
    pushes,
    pushUrl: `https://127.0.0.1:${fakePush.address().port}`,
    worker: { 'content-type': 'application/json', 'x-worker-token': WORKER_TOKEN },
    database: client.db(db),
    raw,
    call,
    login,
    async stop() {
      server.kill();
      fakeWorker.close();
      fakePush.close();
      await client.close();
      await mongo.stop();
    },
  };
}

/**
 * Marché connu : deux motorisations, un prix qui baisse avec les kilomètres
 * et monte avec l'année, une affaire évidente. Numéros d'annonce réalistes.
 */
export function market() {
  const ads = [];
  for (let i = 0; i < 30; i += 1) {
    const km = 60_000 + i * 5_000;
    const year = 2000 + (i % 5);
    ads.push(listing(3_100_000_000 + i, 'Boxster 3.2 S', year, km, 26_000 - km * 0.05 + (year - 2000) * 800));
  }
  for (let i = 0; i < 20; i += 1) {
    const km = 90_000 + i * 6_000;
    const year = 2000 + (i % 3);
    ads.push(listing(3_200_000_000 + i, 'Boxster 2.7', year, km, 15_000 - km * 0.03));
  }
  ads.push(listing(3_300_000_001, 'Boxster 3.2 S', 2002, 100_000, 12_000));
  return ads;
}

export function listing(id, version, year, km, price, extra = {}) {
  return {
    lbcId: String(id),
    title: `Porsche ${version} ${year}`,
    url: `https://www.leboncoin.fr/ad/voitures/${id}`,
    price: Math.round(price),
    location: 'Caen 14000',
    sellerType: 'private',
    imageUrl: null,
    attributes: {
      u_car_brand: 'PORSCHE',
      u_car_model: 'PORSCHE_Boxster',
      u_car_version: version,
      regdate: String(year),
      mileage: String(km),
    },
    ...extra,
  };
}

/** Joue une collecte complète comme le ferait le collecteur. */
export async function collect(stack, queryId, ads, { mode = 'full' } = {}) {
  const { call, worker } = stack;
  await call('PATCH', `/api/internal/market/queries/${queryId}`, worker, {
    status: 'running',
    pages: 0,
    ads: 0,
    mode,
    codes: { brand: 'PORSCHE', model: 'PORSCHE_Boxster' },
  });
  for (let i = 0; i < ads.length; i += 200) {
    await call('POST', '/api/internal/market/ads', worker, { queryId, ads: ads.slice(i, i + 200) });
  }
  await call('PATCH', `/api/internal/market/queries/${queryId}`, worker, { status: 'done', pages: 2 });
}
