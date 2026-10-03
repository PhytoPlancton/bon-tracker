import { mkdir, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config, LBC_ORIGIN } from './config.js';

/** Le Chrome dédié n'est pas joignable, ou personne n'y est connecté au site. */
export class NeedsManualSession extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeedsManualSession';
  }
}

/**
 * Se rattache au Chrome dédié lancé sur la machine.
 *
 * L'adresse est résolue en IP avant la connexion : Chrome refuse les requêtes
 * de débogage dont l'en-tête Host n'est ni une adresse IP ni « localhost », ce
 * qui écarterait « host.docker.internal ».
 */
export async function connectToChrome(log: (message: string) => void = () => undefined): Promise<Browser> {
  let address = config.chromeHost;
  try {
    address = (await lookup(config.chromeHost)).address;
  } catch {
    // Nom déjà sous forme d'IP, ou résolution indisponible : on tente tel quel.
  }

  const endpoint = `http://${address}:${config.chromePort}`;
  for (const note of await releaseStuckTabs(endpoint)) log(note);

  try {
    return await chromium.connectOverCDP(endpoint, { timeout: 60_000 });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    // Distinguer les deux cas : un Chrome absent et un Chrome qui tarde
    // appellent des gestes différents.
    const reachable = /ws connected/i.test(detail);
    // Le journal d'appels de Playwright n'apprend rien à qui lit l'application.
    const summary = detail.split('\n')[0];
    throw new NeedsManualSession(
      reachable
        ? `Chrome répond sur ${endpoint} mais un de ses onglets ne répond plus. Ouvre le Chrome dédié : un onglet attend sans doute une réponse (alerte, « Quitter le site ? »). Réponds-y ou ferme-le, puis relance. (${summary})`
        : `Chrome introuvable sur ${endpoint}. Lance start-chrome.cmd sur le PC et laisse la fenêtre ouverte. (${summary})`,
    );
  }
}

/** Délai au-delà duquel un onglet est tenu pour figé. */
const TAB_PROBE_MS = 5_000;

/**
 * Débloque les onglets figés par une boîte de dialogue.
 *
 * Playwright ne rend la main qu'une fois chaque onglet ouvert prêt à être
 * piloté. Une alerte, une confirmation ou un « Quitter le site ? » restés sans
 * réponse dans un seul onglet suffisent à le bloquer jusqu'au délai : l'onglet
 * ne répond plus à rien tant que la boîte est ouverte. Ce n'est pas le nombre
 * d'onglets qui compte — trente se rattachent en une fraction de seconde.
 *
 * Chrome ne laisse pas fermer à distance une boîte ouverte avant notre
 * arrivée. Recharger l'onglet la fait disparaître en gardant la page ; seul le
 * « Quitter le site ? » résiste, et on referme alors l'onglet, ce que la
 * personne avait demandé en le quittant.
 *
 * Tout échec ici est sans conséquence : le rattachement qui suit dira mieux
 * que nous si Chrome est absent.
 */
async function releaseStuckTabs(endpoint: string): Promise<string[]> {
  let cdp: CdpConnection | null = null;
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(TAB_PROBE_MS) });
    const { webSocketDebuggerUrl } = (await response.json()) as { webSocketDebuggerUrl: string };
    cdp = await openCdp(webSocketDebuggerUrl);
    const connection = cdp;

    const { targetInfos } = await connection.send<{ targetInfos: TargetInfo[] }>('Target.getTargets');
    const tabs = targetInfos.filter((target) => target.type === 'page');
    const outcomes = await Promise.all(tabs.map((tab) => reloadIfStuck(connection, tab)));
    const stuck = tabs.filter((_, index) => outcomes[index] === 'stuck');
    const notes = tabs
      .filter((_, index) => outcomes[index] === 'reloaded')
      .map((tab) => `Onglet « ${tabName(tab)} » figé par une boîte de dialogue : rechargé`);

    // Refermer le dernier onglet fermerait Chrome avec lui.
    if (stuck.length && stuck.length === tabs.length) {
      await connection.send('Target.createTarget', { url: 'about:blank' });
    }
    for (const tab of stuck) {
      await connection.send('Target.closeTarget', { targetId: tab.targetId });
      notes.push(`Onglet « ${tabName(tab)} » figé par une boîte de dialogue : refermé`);
    }
    return notes;
  } catch {
    return [];
  } finally {
    cdp?.close();
  }
}

async function reloadIfStuck(cdp: CdpConnection, tab: TargetInfo): Promise<'ok' | 'reloaded' | 'stuck'> {
  let sessionId: string;
  try {
    ({ sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId: tab.targetId,
      flatten: true,
    }));
  } catch {
    return 'ok';
  }

  try {
    if (await responds(cdp, sessionId)) return 'ok';
    await cdp.send('Page.reload', {}, sessionId).catch(() => undefined);
    return (await responds(cdp, sessionId)) ? 'reloaded' : 'stuck';
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
}

/**
 * L'onglet répond-il ? Une erreur est une réponse : seule une page bloquée
 * se tait, une page en plein chargement dit qu'elle n'a pas encore de contexte.
 */
async function responds(cdp: CdpConnection, sessionId: string): Promise<boolean> {
  try {
    await cdp.send('Runtime.evaluate', { expression: '0' }, sessionId);
    return true;
  } catch (cause) {
    return !(cause instanceof CdpTimeout);
  }
}

function tabName(tab: TargetInfo): string {
  return (tab.title || tab.url).slice(0, 80);
}

interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
}

class CdpTimeout extends Error {}

interface CdpConnection {
  send<T = unknown>(method: string, params?: object, sessionId?: string): Promise<T>;
  close(): void;
}

/**
 * Le strict nécessaire du protocole de Chrome. Playwright n'en offre pas
 * d'accès en dehors d'un rattachement complet — celui-là même qui reste
 * bloqué.
 */
function openCdp(url: string): Promise<CdpConnection> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    let lastId = 0;

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      const waiter = message.id === undefined ? undefined : pending.get(message.id);
      if (!waiter || message.id === undefined) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const waiter of pending.values()) waiter.reject(new Error('Connexion à Chrome fermée'));
      pending.clear();
    });
    socket.addEventListener('error', () => reject(new Error('Connexion à Chrome impossible')));
    socket.addEventListener('open', () =>
      resolve({
        send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
          return new Promise<T>((resolveSend, rejectSend) => {
            const id = ++lastId;
            const timer = setTimeout(() => {
              pending.delete(id);
              rejectSend(new CdpTimeout(`${method} sans réponse`));
            }, TAB_PROBE_MS);
            pending.set(id, {
              resolve: (value) => {
                clearTimeout(timer);
                resolveSend(value as T);
              },
              reject: (error) => {
                clearTimeout(timer);
                rejectSend(error);
              },
            });
            socket.send(JSON.stringify({ id, method, params, sessionId }));
          });
        },
        close: () => socket.close(),
      }),
    );
  });
}

/**
 * Réutilise le contexte du navigateur, celui qui porte la session de
 * l'utilisateur. En créer un nouveau reviendrait à repartir déconnecté.
 */
export function mainContext(browser: Browser): BrowserContext {
  const [existing] = browser.contexts();
  if (!existing) {
    throw new NeedsManualSession('Le Chrome dédié ne présente aucune fenêtre ouverte');
  }
  return existing;
}

/**
 * Refuse le pistage, et surtout dégage la page.
 *
 * Ce bandeau recouvre le contenu : tant qu'il est là, aucune annonce n'est
 * lisible. Le refus se présente tantôt en bouton, tantôt en lien, et arrive
 * parfois après le premier affichage — on ratisse donc large, et on réessaie.
 */
export async function dismissCookieBanner(page: Page): Promise<boolean> {
  const candidates = [
    '#didomi-notice-disagree-button',
    '[id*="disagree" i]',
    '[aria-label*="Continuer sans accepter" i]',
    // Le refus n'est pas toujours un bouton : sur certaines pages c'est un lien.
    ':is(button, a, span, div)[role="button"]:has-text("Continuer sans accepter")',
    'button:has-text("Continuer sans accepter")',
    'a:has-text("Continuer sans accepter")',
    'button:has-text("Tout refuser")',
    'button:has-text("Refuser")',
  ];

  // Le bandeau peut surgir après le chargement : deux passes valent mieux
  // qu'un seul essai trop tôt.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const selector of candidates) {
      const target = page.locator(selector).first();
      if (await target.isVisible({ timeout: 1200 }).catch(() => false)) {
        await target.click({ timeout: 4000 }).catch(() => undefined);
        await page.waitForTimeout(800);
        return true;
      }
    }
    await page.waitForTimeout(1500);
  }

  return false;
}

/** Le bandeau masque-t-il encore le contenu ? */
export async function consentBannerVisible(page: Page): Promise<boolean> {
  for (const selector of ['#didomi-popup', '[id*="didomi-notice"]', '[class*="didomi-popup"]']) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false);
    if (visible) return true;
  }
  return false;
}

export type SessionState = 'logged_in' | 'logged_out' | 'challenged';

/**
 * Établit l'état de la session en ouvrant les favoris.
 *
 * Le collecteur ne tente plus de se connecter lui-même : remplir un formulaire
 * de connexion est précisément ce qui déclenche les vérifications, et un échec
 * fait marquer l'adresse IP du domicile. L'utilisateur se connecte une fois à
 * la main dans le Chrome dédié, qui garde ensuite la session.
 */
export async function checkSession(page: Page): Promise<SessionState> {
  await page.goto(`${LBC_ORIGIN}/favorites`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await dismissCookieBanner(page);
  await page.waitForTimeout(2000);

  if (await isBlocked(page)) return 'challenged';

  if (/\/(login|connexion)/.test(page.url()) || page.url().includes('compte.leboncoin.fr')) {
    return 'logged_out';
  }
  return 'logged_in';
}

/**
 * Reconnaît un blocage réel, et lui seul.
 *
 * Le script anti-robot est chargé sur toutes les pages du site : sa simple
 * présence ne veut rien dire. Seuls comptent la page de vérification servie à
 * la place du contenu, l'iframe du captcha, ou le message qui l'accompagne.
 */
export async function isBlocked(page: Page): Promise<boolean> {
  if (/geo\.captcha-delivery\.com|\/challenge|captcha-delivery/i.test(page.url())) return true;

  const captchaFrame = page
    .frames()
    .some((frame) => /captcha-delivery\.com|geo\.captcha/i.test(frame.url()));
  if (captchaFrame) return true;

  for (const marker of [
    'text=/acc[èe]s temporairement restreint/i',
    'text=/on s.assure qu.on s.adresse bien [àa] vous/i',
    'text=/vous avez été bloqué/i',
  ]) {
    const visible = await page
      .locator(marker)
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false);
    if (visible) return true;
  }

  return false;
}

/**
 * Enregistre ce que le navigateur voyait au moment d'un échec. Sans cette
 * trace, diagnostiquer une page qu'on ne peut pas ouvrir soi-même relève de
 * la devinette.
 */
export async function captureDiagnostic(page: Page, label: string): Promise<string | null> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `/app/debug/${stamp}-${label}`;
  try {
    await mkdir('/app/debug', { recursive: true });
    await page.screenshot({ path: `${base}.png`, fullPage: false });
    await writeFile(`${base}.html`, await page.content(), 'utf8');
    await writeFile(`${base}.txt`, `URL : ${page.url()}\nTitre : ${await page.title()}\n`, 'utf8');
    return `${base}.png`;
  } catch {
    return null;
  }
}
