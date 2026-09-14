#!/usr/bin/env node
/**
 * Mise en service guidée : génère les secrets manquants, demande les comptes,
 * et écrit la configuration. Relançable sans risque — les valeurs déjà
 * renseignées sont conservées, seules les cases vides sont demandées.
 *
 * Deux fichiers sont produits, pour une raison précise :
 *   .env         ce dont Docker Compose a besoin pour construire le
 *                docker-compose.yml. Compose y interprète « $ », donc aucune
 *                valeur de ce fichier ne doit en contenir.
 *   secrets.env  clés et mots de passe, transmis littéralement aux containers
 *                par `env_file`. Un hash bcrypt (« $2a$12$… ») placé dans .env
 *                serait amputé par Compose, qui prendrait « $12 » pour une
 *                variable à remplacer.
 *
 * Appelé par setup.cmd avec le dossier du projet en argument.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { stdin, stdout } from 'node:process';

const CTRL_C = String.fromCharCode(3);
const BACKSPACE = String.fromCharCode(127);

const bcrypt = loadBcrypt();
const projectDir = process.argv[2] || '.';
const envPath = join(projectDir, '.env');
const secretsPath = join(projectDir, 'secrets.env');

/** Clés destinées au .env ; toutes les autres vont dans secrets.env. */
const ENV_KEYS = [
  'MONGO_USER',
  'MONGO_PASSWORD',
  'MONGO_DB',
  'TUNNEL_TOKEN',
  'COMPOSE_PROFILES',
  'CRON_SCHEDULE',
];

const ENV_HEADER = `# Réglages de Docker Compose — écrit par setup.cmd, ne pas versionner.
# Aucune valeur ici ne doit contenir de « $ » : Compose y verrait une variable
# à remplacer. Les clés et mots de passe sont dans secrets.env.`;

const SECRETS_HEADER = `# Clés et mots de passe — écrit par setup.cmd, ne pas versionner.
# Transmis tels quels aux containers : Compose n'interprète pas ce fichier.`;

// Les deux fichiers sont relus ensemble : une installation antérieure a pu
// tout ranger dans .env, on récupère alors ses valeurs sans rien redemander.
const values = new Map([
  ...parse(await readFile(envPath, 'utf8').catch(() => '')),
  ...parse(await readFile(secretsPath, 'utf8').catch(() => '')),
]);

const input = { buffer: '', pending: null, ended: false };
stdin.on('data', onChunk);
stdin.on('end', () => {
  input.ended = true;
  if (input.pending) settle(input.buffer.trim());
});

console.log('\n─────────────────────────────────────────');
console.log('  Bon Tracker — mise en service');
console.log('─────────────────────────────────────────\n');

// --- 1. Secrets techniques, tirés au sort une fois pour toutes -------------
const generated = [];
for (const [key, make] of [
  ['MONGO_USER', () => 'bontracker'],
  ['MONGO_PASSWORD', () => randomBytes(24).toString('base64url')],
  ['MONGO_DB', () => 'bon_tracker'],
  ['ENCRYPTION_KEY', () => randomBytes(32).toString('base64')],
  ['SESSION_SECRET', () => randomBytes(48).toString('base64url')],
  ['WORKER_TOKEN', () => randomBytes(32).toString('base64url')],
  ['CRON_SCHEDULE', () => '17 */6 * * *'],
]) {
  if (!read(key)) {
    set(key, make());
    generated.push(key);
  }
}
console.log(
  generated.length
    ? `✓ Secrets générés : ${generated.join(', ')}\n`
    : '✓ Secrets déjà en place\n',
);

// --- 2. Compte d'accès à l'application -------------------------------------
if (!read('ADMIN_PASSWORD_HASH')) {
  console.log('Compte pour te connecter à l’application :');
  const email = await askEmail('  E-mail          : ');

  let password = '';
  for (;;) {
    password = await ask('  Mot de passe    : ', { mask: true });
    if (password.length < 10) {
      console.log('  ⚠ 10 caractères minimum.');
      continue;
    }
    const again = await ask('  Confirmation    : ', { mask: true });
    if (again !== password) {
      console.log('  ⚠ Les deux saisies diffèrent.');
      continue;
    }
    break;
  }

  set('ADMIN_EMAIL', email);
  set('ADMIN_PASSWORD_HASH', await bcrypt.hash(password, 12));
  console.log('✓ Mot de passe haché — il n’est stocké nulle part en clair\n');
} else {
  console.log(`✓ Compte d’accès déjà configuré (${read('ADMIN_EMAIL')})\n`);
}

// --- 3. Compte leboncoin du collecteur -------------------------------------
if (!read('LBC_PASSWORD')) {
  console.log('Compte leboncoin que le collecteur utilisera :');
  set('LBC_EMAIL', await askEmail('  E-mail          : '));
  set('LBC_PASSWORD', await ask('  Mot de passe    : ', { mask: true }));
  console.log('✓ Enregistré dans .env, sur cette machine uniquement\n');
} else {
  console.log(`✓ Compte leboncoin déjà configuré (${read('LBC_EMAIL')})\n`);
}

// --- 4. Tunnel Cloudflare ---------------------------------------------------
if (!read('TUNNEL_TOKEN')) {
  console.log('Tunnel Cloudflare — à créer sur one.dash.cloudflare.com :');
  console.log('  Networks → Tunnels → Create a tunnel → Cloudflared');
  console.log('  puis Public Hostname : bontracker.nmt.ovh → HTTP → web:3000');
  const token = (await ask('\n  Token du tunnel (vide pour plus tard) : ')).trim();
  set('TUNNEL_TOKEN', token);
  if (token) {
    console.log('✓ Tunnel configuré\n');
  } else {
    console.log('… ignoré. L’app restera accessible sur http://localhost:3000\n');
  }
} else {
  console.log('✓ Tunnel déjà configuré\n');
}

// Le service du tunnel ne démarre que lorsqu'il a de quoi se connecter.
set('COMPOSE_PROFILES', read('TUNNEL_TOKEN') ? 'tunnel' : '');

await writeFile(envPath, render(ENV_HEADER, (key) => ENV_KEYS.includes(key)), 'utf8');
await writeFile(secretsPath, render(SECRETS_HEADER, (key) => !ENV_KEYS.includes(key)), 'utf8');

console.log('─────────────────────────────────────────');
console.log('  Configuration enregistrée');
console.log('    .env         réglages de Docker Compose');
console.log('    secrets.env  clés et mots de passe');
console.log('─────────────────────────────────────────\n');

stdin.off('data', onChunk);
stdin.pause();

function read(key) {
  return values.get(key) || null;
}

function set(key, value) {
  values.set(key, value);
}

/**
 * Lit un fichier de configuration. Un éventuel commentaire de fin de ligne est
 * écarté : sans cela, « CLE=   # explication » passerait pour une valeur déjà
 * renseignée.
 */
function parse(content) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).split(' #')[0].trim();
      return [key, value];
    })
    .filter(([key, value]) => key && value);
}

function render(header, belongs) {
  const body = [...values.entries()]
    .filter(([key]) => belongs(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  return `${header}\n${body}\n`;
}


/**
 * Demande une adresse jusqu'à ce qu'elle en soit une. Sans ce garde-fou, une
 * commande collée par mégarde dans le champ serait acceptée telle quelle et
 * finirait comme identifiant de connexion.
 */
async function askEmail(prompt) {
  for (;;) {
    const value = (await ask(prompt)).trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value;
    console.log('  ⚠ Ce n’est pas une adresse e-mail. Recommence.');
  }
}

/**
 * Lecture d'une ligne sur l'entrée standard.
 *
 * `readline` ne convient pas ici : il se referme dès que l'entrée est un flux
 * déjà terminé, et rend alors toute question suivante impossible. On gère donc
 * le tampon nous-mêmes, ce qui couvre la frappe au clavier comme l'entrée
 * redirigée.
 */
function ask(prompt, { mask = false } = {}) {
  stdout.write(prompt);
  if (mask && stdin.isTTY) stdin.setRawMode(true);

  return new Promise((resolve) => {
    input.pending = { resolve, mask };
    flush();
    if (input.ended && input.pending) settle(input.buffer.trim());
  });
}

function onChunk(chunk) {
  const text = chunk.toString('utf8');

  // En saisie masquée le terminal est en mode brut : à nous de traiter
  // l'effacement et l'interruption, dont la ligne de commande s'occupe sinon.
  if (input.pending?.mask && stdin.isTTY) {
    for (const char of text) {
      if (char === CTRL_C) {
        stdout.write('\n');
        process.exit(130);
      }
      if (char === BACKSPACE || char === '\b') {
        input.buffer = input.buffer.slice(0, -1);
        continue;
      }
      input.buffer += char;
    }
  } else {
    input.buffer += text;
  }

  flush();
}

function flush() {
  if (!input.pending) return;
  const index = input.buffer.search(/[\r\n]/);
  if (index === -1) return;

  const line = input.buffer.slice(0, index);
  input.buffer = input.buffer.slice(index + 1).replace(/^\n/, '');
  settle(line);
}

function settle(line) {
  const { resolve, mask } = input.pending;
  input.pending = null;
  if (mask) {
    if (stdin.isTTY) stdin.setRawMode(false);
    stdout.write('\n');
  }
  resolve(line);
}

/** bcryptjs vit dans l'image web ; on accepte aussi une installation de passage. */
function loadBcrypt() {
  const require = createRequire(import.meta.url);
  for (const candidate of ['bcryptjs', '/app/node_modules/bcryptjs', '/tmp/node_modules/bcryptjs']) {
    try {
      return require(candidate);
    } catch {
      // Candidat suivant.
    }
  }
  throw new Error('bcryptjs introuvable : lancer ce script via setup.cmd');
}
