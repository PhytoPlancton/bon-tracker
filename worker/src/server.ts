import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { isRunning, log, runOnce } from './run.js';
import { connectToChrome } from './browser.js';
import { loginToLeboncoin } from './login.js';

/**
 * Petit serveur de commandes, joignable uniquement depuis le réseau Docker.
 *
 * Le collecteur est autrement un client : rien ne permettait de lui demander
 * un relevé depuis l'application, il fallait passer par la ligne de commande.
 */
export function startCommandServer(): void {
  const server = createServer((request, response) => {
    const reply = (status: number, body: Record<string, unknown>) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };

    if (request.url === '/health') {
      return reply(200, { ok: true, running: isRunning() });
    }

    if (!authorized(request.headers['x-worker-token'])) {
      return reply(403, { error: 'Interdit' });
    }

    if (request.method === 'POST' && request.url === '/verify-login') {
      return readJson(request)
        .then(async (body) => {
          const email = String(body.email ?? '');
          const password = String(body.password ?? '');
          if (!email || !password) return reply(400, { error: 'Identifiants manquants' });
          reply(200, await verifyLogin(email, password));
        })
        .catch(() => reply(400, { error: 'Requête illisible' }));
    }

    if (request.method !== 'POST' || request.url !== '/run') {
      return reply(404, { error: 'Inconnu' });
    }

    if (isRunning()) {
      return reply(409, { error: 'Un relevé est déjà en cours', running: true });
    }

    // On répond sans attendre : un relevé complet prend plusieurs minutes.
    void runOnce().catch((cause) => log('Relevé demandé en échec', String(cause)));
    log('Relevé demandé depuis l’application');
    return reply(202, { started: true });
  });

  server.listen(config.commandPort, '0.0.0.0', () => {
    log(`Serveur de commandes à l’écoute sur le port ${config.commandPort}`);
  });
}

function authorized(header: string | string[] | undefined): boolean {
  const received = Array.isArray(header) ? header[0] : header;
  if (!received) return false;
  const expected = Buffer.from(config.workerToken);
  const given = Buffer.from(received);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * Ouvre une vraie session leboncoin avec les identifiants fournis.
 *
 * Sert à l'inscription : on ne crée un compte que si le site accepte
 * réellement ces identifiants, et la session obtenue évite au premier relevé
 * d'avoir à se reconnecter.
 */
async function verifyLogin(
  email: string,
  password: string,
): Promise<{ outcome: string; detail: string; storageState?: unknown }> {
  const browser = await connectToChrome();
  const context = await browser.newContext();

  try {
    const result = await loginToLeboncoin(context, email, password);
    if (result.outcome !== 'ok') return result;
    return { ...result, storageState: await context.storageState() };
  } catch (cause) {
    return {
      outcome: 'unavailable',
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

function readJson(request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      // Une inscription tient en quelques centaines d'octets.
      if (raw.length > 8192) reject(new Error('Charge utile trop grande'));
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (cause) {
        reject(cause);
      }
    });
    request.on('error', reject);
  });
}
