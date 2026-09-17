import cron from 'node-cron';
import { config } from './config.js';
import { log, runOnce } from './run.js';
import { startCommandServer } from './server.js';
import { reportRun } from './api.js';
import { NeedsManualSession } from './browser.js';

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
  // Une panne au démarrage doit rester visible dans l'app, pas seulement en logs.
  const message = cause instanceof Error ? cause.message : String(cause);
  log('Relevé impossible', message);
  void reportRun({
    startedAt: new Date().toISOString(),
    status: cause instanceof NeedsManualSession ? 'needs_session' : 'error',
    stats: { seen: 0, created: 0, priceChanges: 0, deactivated: 0 },
    error: message,
  }).catch(() => undefined);
});
