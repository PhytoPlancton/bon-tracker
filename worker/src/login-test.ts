/**
 * Vérifie si une connexion leboncoin passe depuis le Chrome piloté.
 *
 * Point décisif pour la suite : si elle passe, on peut inscrire un
 * utilisateur à partir de ses seuls identifiants ; sinon, il faut un autre
 * chemin. À lancer une fois, avec un compte de test si possible.
 *
 *   docker compose run --rm worker node dist/login-test.js
 */
import { captureDiagnostic, connectToChrome } from './browser.js';
import { loginToLeboncoin } from './login.js';
import { log } from './run.js';

const email = process.env.TEST_LBC_EMAIL || process.env.LBC_EMAIL;
const password = process.env.TEST_LBC_PASSWORD || decodeB64(process.env.LBC_PASSWORD_B64);

if (!email || !password) {
  console.error(
    'Renseigne TEST_LBC_EMAIL et TEST_LBC_PASSWORD, ou laisse le compte configuré dans secrets.env.',
  );
  process.exit(1);
}

const browser = await connectToChrome();

// Contexte neuf : la session déjà ouverte dans le Chrome ne doit pas masquer
// le résultat, c'est bien une connexion depuis zéro qu'on mesure.
let context;
try {
  context = await browser.newContext();
  log('Contexte isolé créé dans le Chrome piloté');
} catch (cause) {
  log(
    'Impossible de créer un contexte isolé — il faudra un Chrome par utilisateur',
    String(cause),
  );
  await browser.close().catch(() => undefined);
  process.exit(2);
}

log(`Tentative de connexion pour ${email.replace(/(.{2}).*(@.*)/, '$1***$2')}`);

const result = await loginToLeboncoin(context, email, password);
log(`Résultat : ${result.outcome} — ${result.detail}`);

const page = await context.newPage();
await page.goto('https://www.leboncoin.fr/favorites', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
const shot = await captureDiagnostic(page, `login-${result.outcome}`);
if (shot) log(`Capture enregistrée : ${shot}`);

await context.close().catch(() => undefined);
await browser.close().catch(() => undefined);

console.log('\n─────────────────────────────────────────');
console.log(result.outcome === 'ok' ? '  CONNEXION RÉUSSIE' : `  ÉCHEC : ${result.outcome}`);
console.log('─────────────────────────────────────────\n');
process.exit(result.outcome === 'ok' ? 0 : 1);

function decodeB64(value?: string): string | undefined {
  if (!value) return undefined;
  return Buffer.from(value, 'base64').toString('utf8').trim() || undefined;
}
