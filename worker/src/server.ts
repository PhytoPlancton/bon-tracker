import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { isRunning, log, runOnce } from './run.js';

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

    if (request.method !== 'POST' || request.url !== '/run') {
      return reply(404, { error: 'Inconnu' });
    }

    if (!authorized(request.headers['x-worker-token'])) {
      return reply(403, { error: 'Interdit' });
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
