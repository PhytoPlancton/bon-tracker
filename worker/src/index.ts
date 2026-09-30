import cron from 'node-cron';
import { abandonMarketQueries } from './api.js';
import { config } from './config.js';
import { log, runOnce } from './run.js';
import { startCommandServer } from './server.js';

async function main(): Promise<void> {
  if (process.argv.includes('--once')) {
    await runOnce();
    return;
  }

  const startedAt = new Date();
  log(`Worker démarré · planification « ${config.schedule} »`);
  startCommandServer();
  void releaseAbandoned(startedAt);

  cron.schedule(config.schedule, () => {
    void runOnce();
  });

  if (config.runOnStart) void runOnce();

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log(`${signal} reçu, arrêt`);
      process.exit(0);
    });
  }
}

/**
 * L'application peut démarrer après le collecteur : on insiste une minute,
 * sans jamais bloquer le reste.
 */
async function releaseAbandoned(startedAt: Date): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const { abandoned } = await abandonMarketQueries(startedAt);
      if (abandoned) log(`${abandoned} collecte(s) de marché interrompue(s) par le redémarrage`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  log('Application injoignable : les collectes de marché interrompues restent affichées en cours');
}

void main().catch((cause) => {
  // Les échecs propres à un compte sont remontés dans l'app par le relevé
  // lui-même ; ici, seule une panne du collecteur entier peut survenir.
  log('Démarrage impossible', cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
});
