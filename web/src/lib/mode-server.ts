import { cache } from 'react';
import { currentUid } from './auth';
import { isMode, type Mode } from './mode';
import { collections } from './mongo';

/**
 * Mode du compte connecté. Lu une fois par rendu : la mise en page et son
 * titre le demandent tous deux.
 *
 * Une base injoignable ne doit pas empêcher l'app de s'afficher : le mode
 * auto, celui d'avant le choix, sert alors de repli.
 */
export const currentMode = cache(async (): Promise<Mode> => {
  try {
    const uid = await currentUid();
    if (!uid) return 'auto';
    return await modeOf(uid);
  } catch {
    return 'auto';
  }
});

export async function modeOf(uid: string): Promise<Mode> {
  const { users } = await collections();
  const user = await users.findOne({ uid }, { projection: { _id: 0, mode: 1 } });
  return isMode(user?.mode) ? user.mode : 'auto';
}

export async function setMode(uid: string, mode: Mode): Promise<void> {
  const { users } = await collections();
  await users.updateOne({ uid }, { $set: { mode } });
}
