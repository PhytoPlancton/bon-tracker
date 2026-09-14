import cron from 'node-cron';
import { config, LBC_ORIGIN } from './config.js';
import {
  fetchTrackedSearches,
  ingest,
  reportRun,
  reportSearches,
  type RunStats,
} from './api.js';
import {
  NeedsManualSession,
  captureDiagnostic,
  checkSession,
  createContext,
  launchBrowser,
  login,
  persistSession,
} from './browser.js';
import { collectListings, collectSavedSearches } from './scrape.js';

function log(message: string, extra?: unknown): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  if (extra === undefined) console.log(line);
  else console.log(line, extra);
}

function add(total: RunStats, partial: RunStats): RunStats {
  return {
    seen: total.seen + partial.seen,
    created: total.created + partial.created,
    priceChanges: total.priceChanges + partial.priceChanges,
    deactivated: total.deactivated + partial.deactivated,
  };
}

let running = false;

async function runOnce(): Promise<void> {
  if (running) {
    log('Relevé déjà en cours, passage ignoré');
    return;
  }
  running = true;

  const startedAt = new Date().toISOString();
  let stats: RunStats = { seen: 0, created: 0, priceChanges: 0, deactivated: 0 };
  let status: 'ok' | 'error' | 'needs_session' = 'ok';
  let error: string | null = null;
  const trackedSearchIds: string[] = [];

  const browser = await launchBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    const state = await checkSession(page);

    if (state !== 'logged_in') {
      log(
        state === 'challenged'
          ? 'Vérification rencontrée sur les favoris, tentative de connexion malgré tout'
          : 'Session absente ou expirée, connexion en cours',
      );
      await login(page);
      await persistSession(context);
      log('Connexion réussie, session enregistrée');
    } else {
      log('Session valide, pas de reconnexion nécessaire');
    }

    // 1. Les favoris, toujours.
    const favorites = await collectListings(page, `${LBC_ORIGIN}/favorites`);
    log(`Favoris : ${favorites.length} annonces`);
    if (favorites.length) {
      stats = add(stats, await ingest('favorites', favorites));
    }

    // 2. Les recherches sauvegardées du compte, pour alimenter l'écran de choix.
    const discovered = await collectSavedSearches(page).catch((cause) => {
      log('Recherches sauvegardées illisibles', String(cause));
      return [];
    });
    if (discovered.length) {
      await reportSearches(discovered);
      log(`Recherches sauvegardées : ${discovered.length} détectées`);
    }

    // 3. Celles que l'utilisateur a activées.
    const { searches } = await fetchTrackedSearches();
    for (const search of searches) {
      await page.waitForTimeout(config.pageDelayMs);
      const listings = await collectListings(page, search.url);
      log(`Recherche « ${search.name} » : ${listings.length} annonces`);
      if (listings.length) {
        stats = add(stats, await ingest(`search:${search.lbcSearchId}`, listings));
      }
      trackedSearchIds.push(search.lbcSearchId);
    }

    // Les cookies ont pu être rafraîchis pendant la visite.
    await persistSession(context).catch(() => undefined);
  } catch (cause) {
    // Une trace de l'écran aide à distinguer un vrai blocage d'une page qui a
    // simplement changé de forme.
    const blocked = cause instanceof NeedsManualSession;
    const shot = await captureDiagnostic(page, blocked ? 'session' : 'erreur').catch(() => null);

    if (blocked) {
      status = 'needs_session';
      error = (cause as NeedsManualSession).message;
      log('Session à rétablir manuellement', error);
    } else {
      status = 'error';
      error = cause instanceof Error ? cause.message : String(cause);
      log('Relevé en échec', error);
    }
    if (shot) log(`Capture de la page enregistrée dans le dossier debug : ${shot}`);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    running = false;
  }

  await reportRun({ startedAt, status, stats, error, trackedSearchIds }).catch((cause) => {
    log("Impossible de remonter l'état du relevé", String(cause));
  });

  log('Relevé terminé', { status, ...stats });
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once');

  if (once) {
    await runOnce();
    return;
  }

  log(`Worker démarré · planification « ${config.schedule} »`);
  cron.schedule(config.schedule, () => {
    void runOnce();
  });

  if (config.runOnStart) {
    void runOnce();
  }

  // Arrêt propre : on laisse le relevé en cours se terminer.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log(`${signal} reçu, arrêt`);
      process.exit(0);
    });
  }
}

void main().catch((cause) => {
  log('Démarrage impossible', String(cause));
  process.exit(1);
});
