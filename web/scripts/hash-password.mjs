#!/usr/bin/env node
/**
 * Génère le hash bcrypt du mot de passe d'accès à l'app.
 * Le mot de passe est saisi ici, en local : seul le hash part sur le serveur.
 *
 *   npm run hash-password
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import bcrypt from 'bcryptjs';

const ENTER = ['\r', '\n'];
const EOT = String.fromCharCode(4);
const ETX = String.fromCharCode(3);
const BACKSPACE = String.fromCharCode(127);

const rl = createInterface({ input: stdin, output: stdout });

const email = (await rl.question('E-mail de connexion : ')).trim().toLowerCase();

stdout.write('Mot de passe (masqué) : ');
const password = await readHidden();
stdout.write('\n');

if (password.length < 10) {
  console.error('\nMot de passe trop court : 10 caractères minimum.');
  rl.close();
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
rl.close();

console.log('\nÀ coller dans les variables d’environnement du stack :\n');
console.log(`ADMIN_EMAIL=${email}`);
console.log(`ADMIN_PASSWORD_HASH=${hash}`);

/** Lit une saisie sans l'afficher à l'écran. */
function readHidden() {
  const wasRaw = Boolean(stdin.isRaw);
  if (stdin.isTTY) stdin.setRawMode(true);

  return new Promise((resolve) => {
    let value = '';

    const onData = (chunk) => {
      const char = chunk.toString('utf8');

      if (ENTER.includes(char) || char === EOT) {
        stdin.off('data', onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        resolve(value);
        return;
      }
      if (char === ETX) {
        rl.close();
        process.exit(130);
      }
      if (char === BACKSPACE) {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };

    stdin.on('data', onData);
  });
}
