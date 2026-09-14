import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config, LBC_ORIGIN } from './config.js';
import { fetchStoredSession, storeSession } from './api.js';

/** Le site a opposé une vérification qu'un robot ne doit pas tenter de franchir. */
export class NeedsManualSession extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeedsManualSession';
  }
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: config.headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
}

export async function createContext(browser: Browser): Promise<BrowserContext> {
  const stored = await fetchStoredSession().catch(() => ({ storageState: null }));

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewport: { width: 1280, height: 900 },
    storageState: (stored.storageState as never) ?? undefined,
  });

  // Gomme le marqueur d'automatisation le plus grossier.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return context;
}

/** Refuse le pistage : c'est le choix le plus respectueux et il suffit à passer le bandeau. */
export async function dismissCookieBanner(page: Page): Promise<void> {
  const candidates = [
    '#didomi-notice-disagree-button',
    'button:has-text("Continuer sans accepter")',
    'button:has-text("Refuser")',
  ];

  for (const selector of candidates) {
    const button = page.locator(selector).first();
    if (await button.isVisible({ timeout: 1500 }).catch(() => false)) {
      await button.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      return;
    }
  }
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  await page.goto(`${LBC_ORIGIN}/favorites`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await dismissCookieBanner(page);
  await page.waitForTimeout(1500);

  if (isChallenged(page.url()) || (await hasCaptcha(page))) {
    throw new NeedsManualSession('Vérification anti-robot rencontrée en ouvrant les favoris');
  }

  // Redirigé vers la connexion : la session est morte.
  if (/\/(login|connexion)/.test(page.url()) || page.url().includes('compte.leboncoin.fr')) {
    return false;
  }
  return true;
}

/**
 * Connexion avec les identifiants du compte, fournis par les variables
 * d'environnement du stack. Le flux leboncoin demande l'e-mail puis le mot de
 * passe, parfois sur le même écran : on traite les deux cas.
 */
export async function login(page: Page): Promise<void> {
  await page.goto(`${LBC_ORIGIN}/connexion`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await dismissCookieBanner(page);
  await page.waitForTimeout(1200);

  if (isChallenged(page.url()) || (await hasCaptcha(page))) {
    throw new NeedsManualSession('Vérification anti-robot sur la page de connexion');
  }

  const emailFilled = await fillFirst(
    page,
    ['input[type="email"]', 'input[name="email"]', 'input[id*="email" i]'],
    config.lbcEmail,
  );
  if (!emailFilled) {
    throw new NeedsManualSession('Champ e-mail introuvable sur la page de connexion');
  }

  // Écran en deux temps : un bouton fait apparaître le champ mot de passe.
  const passwordVisible = await page
    .locator('input[type="password"]')
    .first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);

  if (!passwordVisible) {
    await clickFirst(page, [
      'button[type="submit"]',
      'button:has-text("Continuer")',
      'button:has-text("Se connecter")',
    ]);
    await page.waitForTimeout(2500);
  }

  const passwordFilled = await fillFirst(
    page,
    ['input[type="password"]', 'input[name="password"]'],
    config.lbcPassword,
  );
  if (!passwordFilled) {
    throw new NeedsManualSession('Champ mot de passe introuvable (vérification supplémentaire ?)');
  }

  await clickFirst(page, [
    'button[type="submit"]',
    'button:has-text("Se connecter")',
    'button:has-text("Connexion")',
  ]);

  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);

  if (await hasCaptcha(page)) {
    throw new NeedsManualSession('Vérification anti-robot après envoi du formulaire');
  }
  if (await needsDeviceVerification(page)) {
    throw new NeedsManualSession(
      'leboncoin demande une vérification par code : session à poser manuellement',
    );
  }
  if (/\/(connexion|login)/.test(page.url())) {
    throw new NeedsManualSession('Connexion refusée : identifiants ou vérification supplémentaire');
  }
}

/** Range la session fraîche, chiffrée côté web. */
export async function persistSession(context: BrowserContext): Promise<void> {
  const state = await context.storageState();
  await storeSession(state as unknown as Record<string, unknown>);
}

function isChallenged(url: string): boolean {
  return /captcha|challenge|geo\.captcha/i.test(url);
}

async function hasCaptcha(page: Page): Promise<boolean> {
  if (isChallenged(page.url())) return true;
  const frames = page.frames().some((frame) => /datadome|captcha/i.test(frame.url()));
  if (frames) return true;
  return page
    .locator('[id*="captcha" i], [class*="captcha" i]')
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
}

async function needsDeviceVerification(page: Page): Promise<boolean> {
  const markers = [
    'text=/code de v[ée]rification/i',
    'text=/nous vous avons envoy[ée]/i',
    'input[autocomplete="one-time-code"]',
  ];
  for (const marker of markers) {
    const visible = await page
      .locator(marker)
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    if (visible) return true;
  }
  return false;
}

async function fillFirst(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if (await field.isVisible({ timeout: 2000 }).catch(() => false)) {
      await field.fill(value, { timeout: 5000 });
      return true;
    }
  }
  return false;
}

async function clickFirst(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const button = page.locator(selector).first();
    if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
      await button.click({ timeout: 5000 }).catch(() => undefined);
      return true;
    }
  }
  return false;
}
