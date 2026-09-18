import type { Browser, BrowserContext } from 'playwright';
import { config, LBC_ORIGIN } from './config.js';
import {
  fetchTrackedSearches,
  fetchUsers,
  ingest,
  reportLbcStatus,
  reportRun,
  reportSearches,
  storeSession,
  type CollectableUser,
  type RunStats,
} from './api.js';
import {
  NeedsManualSession,
  captureDiagnostic,
  checkSession,
  connectToChrome,
} from './browser.js';
import { loginToLeboncoin } from './login.js';
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

/**
 * Relève tous les comptes, l'un après l'autre.
 *
 * Chaque compte reçoit son propre contexte de navigateur : ses cookies lui
 * restent propres, et deux personnes peuvent suivre la même annonce sans que
 * leurs sessions se mélangent. Les comptes sont traités en série, jamais en
 * parallèle : trois navigations simultanées depuis une même connexion se
 * remarquent.
 */
export async function runOnce(): Promise<void> {
  if (running) {
    log('Relevé déjà en cours, passage ignoré');
    return;
  }
  running = true;

  let browser: Browser | null = null;
  try {
    const { users } = await fetchUsers();
    if (!users.length) {
      log('Aucun compte à relever');
      return;
    }

    browser = await connectToChrome();
    log(`${users.length} compte(s) à relever`);

    for (const [index, user] of users.entries()) {
      if (index > 0) await pause(config.pageDelayMs * 2);
      await collectForUser(browser, user);
    }
  } catch (cause) {
    log('Relevé impossible', cause instanceof Error ? cause.message : String(cause));
  } finally {
    await browser?.close().catch(() => undefined);
    running = false;
  }
}

async function collectForUser(browser: Browser, user: CollectableUser): Promise<void> {
  const startedAt = new Date().toISOString();
  let stats: RunStats = { seen: 0, created: 0, priceChanges: 0, deactivated: 0 };
  let status: 'ok' | 'error' | 'needs_session' = 'ok';
  let error: string | null = null;
  const trackedSearchIds: string[] = [];

  const label = user.email.replace(/(.{2}).*(@.*)/, '$1***$2');
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext(
      user.session ? { storageState: user.session as never } : undefined,
    );
    const page = await context.newPage();

    let state = await checkSession(page);

    if (state !== 'logged_in') {
      if (!user.password) {
        throw new NeedsManualSession(
          'Session expirée et aucun mot de passe enregistré : reconnecte-toi depuis l’application.',
        );
      }

      log(`[${label}] session absente, connexion en cours`);
      const result = await loginToLeboncoin(context, user.email, user.password);

      if (result.outcome !== 'ok') {
        await reportLbcStatus(
          user.uid,
          result.outcome === 'bad_credentials' ? 'needs_login' : result.outcome === 'blocked' ? 'blocked' : 'verification_required',
        ).catch(() => undefined);
        throw new NeedsManualSession(result.detail);
      }

      await storeSession(user.uid, (await context.storageState()) as never).catch(() => undefined);
      state = await checkSession(page);
      if (state !== 'logged_in') {
        throw new NeedsManualSession('Connexion acceptée mais session inutilisable');
      }
      log(`[${label}] connexion réussie`);
    }

    const favorites = await collectListings(page, `${LBC_ORIGIN}/favorites`);
    log(`[${label}] favoris : ${favorites.length} annonces`);
    reportAttributes(label, favorites);
    if (favorites.length) {
      stats = add(stats, await ingest(user.uid, 'favorites', favorites));
    }

    const discovered = await collectSavedSearches(page).catch((cause) => {
      log(`[${label}] recherches sauvegardées illisibles`, String(cause));
      return [];
    });
    if (discovered.length) {
      await reportSearches(user.uid, discovered);
      log(`[${label}] recherches sauvegardées : ${discovered.length} détectées`);
    }

    const { searches } = await fetchTrackedSearches(user.uid);
    for (const search of searches) {
      await pause(config.pageDelayMs);
      const listings = await collectListings(page, search.url);
      log(`[${label}] « ${search.name} » : ${listings.length} annonces`);
      if (listings.length) {
        stats = add(stats, await ingest(user.uid, `search:${search.lbcSearchId}`, listings));
      }
      trackedSearchIds.push(search.lbcSearchId);
    }

    // Les cookies ont pu être rafraîchis pendant la visite.
    await storeSession(user.uid, (await context.storageState()) as never).catch(() => undefined);
  } catch (cause) {
    const blocked = cause instanceof NeedsManualSession;
    status = blocked ? 'needs_session' : 'error';
    error = cause instanceof Error ? cause.message : String(cause);
    log(`[${label}] ${blocked ? 'intervention nécessaire' : 'échec'}`, error);

    const page = context?.pages()[0];
    if (page) {
      const shot = await captureDiagnostic(page, `${user.uid.slice(0, 8)}-${status}`).catch(
        () => null,
      );
      if (shot) log(`[${label}] capture enregistrée : ${shot}`);
    }
  } finally {
    await context?.close().catch(() => undefined);
  }

  await reportRun({ uid: user.uid, startedAt, status, stats, error, trackedSearchIds }).catch(
    (cause) => log(`[${label}] état du relevé non remonté`, String(cause)),
  );
  log(`[${label}] terminé`, { status, ...stats });
}

/**
 * Énumère les caractéristiques rencontrées, avec un exemple de valeur.
 *
 * Le site n'attache pas les mêmes à toutes les catégories, et rien ne dit
 * d'avance sous quel nom figure la puissance ou le kilométrage. Les lire une
 * fois vaut mieux que les supposer.
 */
function reportAttributes(label: string, listings: { attributes?: Record<string, string> }[]): void {
  const seen = new Map<string, string>();
  for (const listing of listings) {
    for (const [key, value] of Object.entries(listing.attributes ?? {})) {
      if (!seen.has(key)) seen.set(key, value);
    }
  }

  if (!seen.size) {
    log(`[${label}] aucune caractéristique structurée reçue`);
    return;
  }

  const sample = [...seen.entries()]
    .slice(0, 30)
    .map(([key, value]) => `${key}=${value}`)
    .join(' · ');
  log(`[${label}] caractéristiques (${seen.size}) : ${sample}`);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
