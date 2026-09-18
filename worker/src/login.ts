import type { BrowserContext, Page } from 'playwright';
import { LBC_ORIGIN } from './config.js';
import { dismissCookieBanner, isBlocked } from './browser.js';

export type LoginOutcome =
  | 'ok'
  | 'blocked'
  | 'verification_required'
  | 'bad_credentials'
  | 'unknown_form';

export interface LoginResult {
  outcome: LoginOutcome;
  detail: string;
}

/**
 * Connecte un compte leboncoin dans un contexte de navigateur donné.
 *
 * Le contexte doit appartenir au Chrome installé sur la machine : un
 * navigateur lancé par Playwright se fait reconnaître dès l'ouverture du
 * formulaire. Chaque utilisateur reçoit son propre contexte, donc ses propres
 * cookies, sans interférer avec les autres.
 */
export async function loginToLeboncoin(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<LoginResult> {
  const page = await context.newPage();

  try {
    // On n'écrit pas l'adresse du formulaire en dur : c'est un flux OAuth dont
    // les paramètres changent à chaque visite. Ouvrir une page réservée aux
    // membres fait produire au site lui-même le lien correct, comme pour un
    // visiteur ordinaire.
    await page.goto(`${LBC_ORIGIN}/favorites`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await dismissCookieBanner(page);

    await page
      .waitForURL(/auth\.leboncoin\.fr/, { timeout: 20_000 })
      .catch(() => undefined);
    await dismissCookieBanner(page);
    await humanPause(page, 1200, 2200);

    if (await isBlocked(page)) {
      return { outcome: 'blocked', detail: 'Vérification anti-robot sur la page de connexion' };
    }
    if (!/auth\.leboncoin\.fr/.test(page.url())) {
      return {
        outcome: 'unknown_form',
        detail: `Pas de redirection vers la connexion (${page.url()})`,
      };
    }

    const emailFilled = await typeInto(
      page,
      [
        'input[type="email"]',
        'input[name="email"]',
        'input[id*="email" i]',
        'input[autocomplete="username"]',
        // Dernier recours : le premier champ de saisie visible du formulaire.
        'form input:not([type="hidden"]):not([type="password"]):not([type="checkbox"])',
      ],
      email,
    );
    if (!emailFilled) {
      return {
        outcome: 'unknown_form',
        detail: `Champ e-mail introuvable sur ${page.url()}`,
      };
    }

    // Écran en deux temps : un bouton fait apparaître le champ mot de passe.
    const passwordVisible = await page
      .locator('input[type="password"]')
      .first()
      .isVisible({ timeout: 2500 })
      .catch(() => false);

    if (!passwordVisible) {
      await clickFirst(page, [
        'button[type="submit"]',
        'button:has-text("Continuer")',
        'button:has-text("Se connecter")',
      ]);
      await humanPause(page, 1800, 3000);
    }

    const passwordFilled = await typeInto(
      page,
      ['input[type="password"]', 'input[name="password"]'],
      password,
    );
    if (!passwordFilled) {
      return { outcome: 'unknown_form', detail: 'Champ mot de passe introuvable' };
    }

    await humanPause(page, 600, 1200);
    await clickFirst(page, [
      'button[type="submit"]',
      'button:has-text("Se connecter")',
      'button:has-text("Connexion")',
    ]);

    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await humanPause(page, 2000, 3200);

    if (await isBlocked(page)) {
      return { outcome: 'blocked', detail: 'Vérification anti-robot après envoi du formulaire' };
    }
    if (await hasText(page, [/code de v[ée]rification/i, /nous vous avons envoy/i])) {
      return {
        outcome: 'verification_required',
        detail: 'leboncoin demande un code envoyé par e-mail',
      };
    }
    if (await hasText(page, [/identifiant.{0,20}incorrect/i, /mot de passe.{0,20}incorrect/i])) {
      return { outcome: 'bad_credentials', detail: 'Identifiants refusés' };
    }
    if (/\/(connexion|login)/.test(page.url())) {
      return { outcome: 'unknown_form', detail: `Toujours sur la page de connexion (${page.url()})` };
    }

    return { outcome: 'ok', detail: `Connecté, redirigé vers ${page.url()}` };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Saisit au clavier, caractère par caractère : un remplissage instantané se voit. */
async function typeInto(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if (await field.isVisible({ timeout: 2500 }).catch(() => false)) {
      await field.click({ timeout: 5000 }).catch(() => undefined);
      await field.type(value, { delay: 60 + Math.random() * 90 });
      return true;
    }
  }
  return false;
}

async function clickFirst(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const button = page.locator(selector).first();
    if (await button.isVisible({ timeout: 2500 }).catch(() => false)) {
      await button.click({ timeout: 5000 }).catch(() => undefined);
      return true;
    }
  }
  return false;
}

async function hasText(page: Page, patterns: RegExp[]): Promise<boolean> {
  const body = await page.textContent('body').catch(() => '');
  return patterns.some((pattern) => pattern.test(body ?? ''));
}

function humanPause(page: Page, min: number, max: number): Promise<void> {
  return page.waitForTimeout(min + Math.random() * (max - min));
}
