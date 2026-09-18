import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb } from './mongo';
import { encrypt } from './crypto';
import { readSecret } from './secret';

/**
 * Prépare la base pour le fonctionnement à plusieurs comptes.
 *
 * Reprend l'installation d'origine, qui n'avait qu'un utilisateur et des
 * données sans propriétaire : le compte décrit par les variables
 * d'environnement reçoit un identifiant, et tout ce qui a été collecté
 * jusque-là lui est rattaché. Sans quoi ces annonces n'appartiendraient à
 * personne et disparaîtraient de l'écran.
 */
export async function ensureBaseline(): Promise<void> {
  const db = await getDb();
  const users = db.collection('users');
  const listings = db.collection('listings');
  const pricePoints = db.collection('price_points');
  const searches = db.collection('searches');
  const runs = db.collection('runs');

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = readSecret('ADMIN_PASSWORD_HASH');
  const lbcPassword = readSecret('LBC_PASSWORD');

  if (email && passwordHash) {
    const existing = await users.findOne({ email });
    if (!existing) {
      await users.insertOne({
        uid: randomUUID(),
        email,
        passwordHash,
        lbcPassword: lbcPassword ? encrypt(lbcPassword) : null,
        lbcSession: null,
        lbcStatus: 'ok',
        lbcCheckedAt: null,
        createdAt: new Date(),
      });
    } else if (!existing.uid) {
      // Compte créé avant le cloisonnement : il lui manque son identifiant.
      await users.updateOne(
        { email },
        {
          $set: {
            uid: randomUUID(),
            lbcPassword: lbcPassword ? encrypt(lbcPassword) : (existing.lbcPassword ?? null),
            lbcStatus: existing.lbcStatus ?? 'ok',
            lbcCheckedAt: existing.lbcCheckedAt ?? null,
          },
        },
      );
    }
  }

  // Rattacher l'historique existant au plus ancien compte, le seul qui
  // pouvait l'avoir collecté.
  const orphan = await listings.findOne({ uid: { $exists: false } }, { projection: { _id: 1 } });
  if (!orphan) return;

  const owner = await users.find({}, { projection: { uid: 1 } }).sort({ createdAt: 1 }).next();
  if (!owner?.uid) return;

  await Promise.all([
    listings.updateMany({ uid: { $exists: false } }, { $set: { uid: owner.uid } }),
    pricePoints.updateMany({ uid: { $exists: false } }, { $set: { uid: owner.uid } }),
    searches.updateMany({ uid: { $exists: false } }, { $set: { uid: owner.uid } }),
    runs.updateMany({ uid: { $exists: false } }, { $set: { uid: owner.uid } }),
  ]);
}

/** Conservé sous son ancien nom pour les appels existants. */
export const ensureAdminUser = ensureBaseline;
