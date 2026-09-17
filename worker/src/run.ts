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
  connectToChrome,
  mainContext,
} from './browser.js';
import { collectListings, collectSavedSearches } from './scrape.js';

export function log(message: string, extra?: unknown): void {
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

/** Un relevé est-il en cours ? Le serveur de commandes s'en sert pour répondre. */
export function isRunning(): boolean {
  return running;
}

export async function runOnce(): Promise<void> {
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

  const browser = await connectToChrome();
  const context = mainContext(browser);
  // Un onglet à nous, pour ne pas détourner celui que l'utilisateur consulte.
  const page = await context.newPage();

  try {
    const state = await checkSession(page);

    if (state === 'challenged') {
      throw new NeedsManualSession(
        'Le site demande une vérification. Ouvre leboncoin dans le Chrome dédié, ' +
          'fais glisser le curseur, puis relance un relevé.',
      );
    }
    if (state === 'logged_out') {
      throw new NeedsManualSession(
        'Personne n’est connecté dans le Chrome dédié. Connecte-toi à leboncoin ' +
          'dans cette fenêtre : la session y restera.',
      );
    }
    log('Session valide dans le Chrome dédié');

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

      // Des noms tous identiques trahissent une extraction qui a ramassé un
      // libellé de bouton : on garde la page pour pouvoir viser juste.
      const distinct = new Set(discovered.map((search) => search.name));
      if (distinct.size < discovered.length / 2) {
        const shot = await captureDiagnostic(page, 'recherches').catch(() => null);
        log(
          `Noms de recherches douteux (${distinct.size} distincts sur ${discovered.length}).` +
            (shot ? ` Page enregistrée : ${shot}` : ''),
        );
      }
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
  } catch (cause) {
    const blocked = cause instanceof NeedsManualSession;
    const shot = await captureDiagnostic(page, blocked ? 'session' : 'erreur').catch(() => null);

    if (blocked) {
      status = 'needs_session';
      error = (cause as NeedsManualSession).message;
      log('Intervention nécessaire', error);
    } else {
      status = 'error';
      error = cause instanceof Error ? cause.message : String(cause);
      log('Relevé en échec', error);
    }
    if (shot) log(`Capture de la page enregistrée dans le dossier debug : ${shot}`);
  } finally {
    // On ferme notre onglet, jamais le navigateur : il appartient à l'utilisateur.
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    running = false;
  }

  await reportRun({ startedAt, status, stats, error, trackedSearchIds }).catch((cause) => {
    log("Impossible de remonter l'état du relevé", String(cause));
  });

  log('Relevé terminé', { status, ...stats });
}

