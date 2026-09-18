import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { collections } from './mongo';
import { decrypt, encrypt } from './crypto';
import type { LbcStatus, Sealed, User } from './types';

/**
 * Comptes de l'application.
 *
 * Le compte leboncoin sert d'identité : la même adresse et le même mot de
 * passe ouvrent l'application. Le mot de passe est conservé deux fois, pour
 * deux usages distincts — un condensat bcrypt pour vérifier une connexion
 * sans jamais pouvoir le relire, et une copie chiffrée que le collecteur
 * déchiffre pour rouvrir une session sur le site quand elle expire.
 */
export async function createUser(email: string, password: string): Promise<User> {
  const { users } = await collections();
  const user: User = {
    uid: randomUUID(),
    email: email.trim().toLowerCase(),
    passwordHash: await bcrypt.hash(password, 12),
    lbcPassword: encrypt(password),
    lbcSession: null,
    lbcStatus: 'ok',
    lbcCheckedAt: null,
    createdAt: new Date(),
  };

  await users.insertOne(user);
  return user;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const { users } = await collections();
  return users.findOne({ email: email.trim().toLowerCase() }, { projection: { _id: 0 } });
}

export async function findUserByUid(uid: string): Promise<User | null> {
  const { users } = await collections();
  return users.findOne({ uid }, { projection: { _id: 0 } });
}

/** Compare en temps constant, et sans révéler si l'adresse existe. */
export async function verifyPassword(user: User | null, password: string): Promise<boolean> {
  const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const matches = await bcrypt.compare(password, hash);
  return Boolean(user) && matches;
}

/**
 * Met à jour le mot de passe conservé pour le site, lorsqu'il a changé de leur
 * côté et qu'une nouvelle connexion l'a confirmé.
 */
export async function updateLbcPassword(uid: string, password: string): Promise<void> {
  const { users } = await collections();
  await users.updateOne(
    { uid },
    { $set: { passwordHash: await bcrypt.hash(password, 12), lbcPassword: encrypt(password) } },
  );
}

export async function setLbcSession(uid: string, storageState: unknown): Promise<void> {
  const { users } = await collections();
  await users.updateOne(
    { uid },
    { $set: { lbcSession: encrypt(JSON.stringify(storageState)), lbcStatus: 'ok', lbcCheckedAt: new Date() } },
  );
}

export async function setLbcStatus(uid: string, status: LbcStatus): Promise<void> {
  const { users } = await collections();
  await users.updateOne({ uid }, { $set: { lbcStatus: status, lbcCheckedAt: new Date() } });
}

export function openSealed(sealed: Sealed | null): string | null {
  if (!sealed) return null;
  try {
    return decrypt(sealed);
  } catch {
    // Clé de chiffrement changée ou donnée abîmée : on repart d'une connexion.
    return null;
  }
}

/** Comptes que le collecteur doit relever, avec de quoi ouvrir leur session. */
export async function usersToCollect(): Promise<
  { uid: string; email: string; password: string | null; session: unknown | null }[]
> {
  const { users } = await collections();
  const all = await users.find({}, { projection: { _id: 0 } }).toArray();

  return all.map((user) => {
    const session = openSealed(user.lbcSession);
    return {
      uid: user.uid,
      email: user.email,
      password: openSealed(user.lbcPassword),
      session: session ? (JSON.parse(session) as unknown) : null,
    };
  });
}
