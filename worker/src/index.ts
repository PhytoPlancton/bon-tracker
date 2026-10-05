import cron from 'node-cron';
import { abandonMarketQueries, claimDueMarket } from './api.js';
import { config } from './config.js';
import { runMarketJob } from './market.js';
import { exclusive } from './queue.js';
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

  cron.schedule(config.marketSchedule, () => {
    void watchMarkets();
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
 * Relève les modèles que des veilles surveillent. L'application choisit
 * lesquels sont dus et les réserve, pour qu'un passage suivant ne les reprenne
 * pas pendant qu'ils attendent leur tour dans la file.
 */
async function watchMarkets(): Promise<void> {
  // Heure de Paris quel que soit le fuseau du container.
  const hour =
    Number(
      new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hour12: false, timeZone: 'Europe/Paris' }).format(new Date()),
    ) % 24;
  const { from, to } = config.quietHours;
  if (from < to ? hour >= from && hour < to : hour >= from || hour < to) return;

  try {
    const { jobs } = await claimDueMarket();
    for (const job of jobs) {
      log(`[veille] ${job.brand} ${job.model} : relevé ${job.mode === 'fresh' ? 'des nouveautés' : 'complet'}`);
      void exclusive(() => runMarketJob(job, log)).catch((cause) =>
        log(`[veille] échec inattendu : ${String(cause)}`),
      );
    }
  } catch (cause) {
    log(`[veille] application injoignable : ${cause instanceof Error ? cause.message : String(cause)}`);
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
