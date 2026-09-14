import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from './env';

const ALGORITHM = 'aes-256-gcm';

function key(): Buffer {
  const raw = Buffer.from(env.encryptionKey, 'base64');
  if (raw.length !== 32) {
    throw new Error('ENCRYPTION_KEY doit être 32 octets encodés en base64');
  }
  return raw;
}

export interface Encrypted {
  ciphertext: string;
  iv: string;
  tag: string;
}

/** Chiffre un secret (session leboncoin) avant de le poser en base. */
export function encrypt(plaintext: string): Encrypted {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decrypt(payload: Encrypted): string {
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
