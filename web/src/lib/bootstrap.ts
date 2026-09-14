import { collections } from './mongo';
import { readSecret } from './secret';

/**
 * Crée le compte d'accès à partir des variables d'environnement, une seule fois.
 * Seul le hash transite : le mot de passe en clair n'existe que sur la machine
 * qui a lancé `npm run hash-password`.
 */
export async function ensureAdminUser(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = readSecret('ADMIN_PASSWORD_HASH');
  if (!email || !passwordHash) return;

  const { users } = await collections();
  await users.updateOne(
    { email },
    { $set: { passwordHash }, $setOnInsert: { email, createdAt: new Date() } },
    { upsert: true },
  );
}
