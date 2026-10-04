/**
 * Un faux leboncoin, servi en HTTPS à un vrai Chromium que le collecteur
 * pilote comme il pilote le Chrome de la maison. Les pages de résultats
 * embarquent leurs annonces comme le site le fait (« __NEXT_DATA__ ») :
 * c'est le même code de lecture qui tourne, pas un simulacre.
 *
 * Le site ne comprend que ce qu'on lui dit de comprendre — une seule forme
 * de lieu, par exemple — pour vérifier que le collecteur s'en aperçoit.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer as createHttpsServer } from 'node:https';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PAGE_SIZE = 35;

/** Le site : un répertoire d'annonces et une fonction qui choisit celles d'une recherche. */
export async function startSite(select) {
  const dir = mkdtempSync(join(tmpdir(), 'faux-lbc-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
    '-subj', '/CN=www.leboncoin.fr', '-addext', 'subjectAltName=DNS:www.leboncoin.fr',
  ], { stdio: 'ignore' });

  const visits = [];
  const server = createHttpsServer(
    { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
    (request, response) => {
      const url = new URL(request.url, 'https://www.leboncoin.fr');
      if (url.pathname !== '/recherche') {
        response.writeHead(404, { 'content-type': 'text/html' }).end('<html><body>Introuvable</body></html>');
        return;
      }
      visits.push(url);
      const pool = select(url.searchParams);
      const page = Number(url.searchParams.get('page') ?? 1);
      const ads = pool.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(searchPage(ads, pool.length));
    },
  );
  await new Promise((resolve) => server.listen(443, '127.0.0.1', resolve));
  return { visits, close: () => server.close() };
}

function searchPage(ads, total) {
  const data = JSON.stringify({ props: { pageProps: { searchData: { ads, total } } } }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Recherche</title></head>
<body><h1>${total.toLocaleString('fr-FR')} annonces</h1><main></main>
<script id="__NEXT_DATA__" type="application/json">${data}</script></body></html>`;
}

/** Une annonce telle que le site la décrit dans ses données. */
export function siteAd({ id, title, price, category, slug, city, zipcode, lat, lng, attributes = {}, body = '' }) {
  return {
    list_id: id,
    subject: title,
    url: `https://www.leboncoin.fr/ad/${slug}/${id}`,
    price: [price],
    category_name: category,
    body,
    images: { urls: [`https://img.leboncoin.fr/api/v1/lbcpb1/images/${id}.jpg?rule=ad-image`] },
    owner: { type: 'private' },
    location: { city, zipcode, lat, lng, city_label: `${city} ${zipcode}` },
    attributes: Object.entries(attributes).map(([key, value]) => ({ key, value: String(value), value_label: String(value) })),
  };
}

/** Un vrai Chromium, joint au faux site par une règle de résolution. */
export async function startChromium(port) {
  const executable = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
  const profile = mkdtempSync(join(tmpdir(), 'faux-lbc-profil-'));
  const proc = spawn(executable, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-sandbox', '--ignore-certificate-errors',
    // Un proxy d'environnement intercepterait le faux site avant la règle de résolution.
    '--no-proxy-server',
    '--host-resolver-rules=MAP www.leboncoin.fr 127.0.0.1', 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
      return { close: () => proc.kill('SIGKILL') };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error('Chromium ne démarre pas');
}

/**
 * Une fausse application : retient ce que le collecteur remonte, et répond
 * comme la vraie — y compris « arrête-toi » quand on le lui demande.
 */
export async function startApi(port) {
  const state = { reports: [], ingested: [], stopWhen: () => false };
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (request.method === 'PATCH' && /\/queries\//.test(request.url)) {
        state.reports.push(body);
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, stop: state.stopWhen(body) }));
      } else if (request.method === 'POST' && /\/ads$/.test(request.url)) {
        state.ingested.push(...body.ads);
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
      } else {
        response.writeHead(404).end('{}');
      }
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    state,
    reset() {
      state.reports.length = 0;
      state.ingested.length = 0;
      state.stopWhen = () => false;
    },
    close: () => server.close(),
  };
}
