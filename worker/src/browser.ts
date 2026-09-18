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
export async function connectToChrome(): Promise<Browser> {
  let address = config.chromeHost;
  try {
    address = (await lookup(config.chromeHost)).address;
  } catch {
    // Nom déjà sous forme d'IP, ou résolution indisponible : on tente tel quel.
  }

  const endpoint = `http://${address}:${config.chromePort}`;
  try {
    // Le rattachement énumère les onglets ouverts : quelques secondes ne
    // suffisent pas sur un navigateur chargé, et l'échec ressemble alors à
    // un Chrome absent alors qu'il répond.
    return await chromium.connectOverCDP(endpoint, { timeout: 60_000 });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    // Distinguer les deux cas : un Chrome absent et un Chrome qui tarde
    // appellent des gestes différents.
    const reachable = /ws connected/i.test(detail);
    throw new NeedsManualSession(
      reachable
        ? `Chrome répond sur ${endpoint} mais tarde à s'ouvrir. Ferme les onglets inutiles du Chrome dédié, puis relance. (${detail})`
        : `Chrome introuvable sur ${endpoint}. Lance start-chrome.cmd sur le PC et laisse la fenêtre ouverte. (${detail})`,
    );
  }
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
