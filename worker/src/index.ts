import cron from 'node-cron';
import { config } from './config.js';
import { log, runOnce } from './run.js';
import { startCommandServer } from './server.js';

async function main(): Promise<void> {
  if (process.argv.includes('--once')) {
    await runOnce();
    return;
  }

  log(`Worker démarré · planification « ${config.schedule} »`);
  startCommandServer();

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

void main().catch((cause) => {
  // Les échecs propres à un compte sont remontés dans l'app par le relevé
  // lui-même ; ici, seule une panne du collecteur entier peut survenir.
  log('Démarrage impossible', cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
});
