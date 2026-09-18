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
  await dropSingleUserIndexes(db);
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

  // Un compte a pu être créé sous une adresse fautive avant que la saisie ne
  // soit contrôlée : chacun reçoit son identifiant, faute de quoi l'index qui
  // les distingue ne peut pas exister.
  const withoutUid = await users
    .find({ uid: { $exists: false } }, { projection: { _id: 1 } })
    .toArray();
  for (const doc of withoutUid) {
    await users.updateOne({ _id: doc._id }, { $set: { uid: randomUUID() } });
  }

  // Le compte configuré est le propriétaire légitime : c'est le sien qui
  // relevait jusqu'ici. Se fier au plus ancien attribuerait tout l'historique
  // à un compte né d'une adresse mal saisie, et laisserait le vrai vide.
  const configured = email ? await users.findOne({ email }, { projection: { uid: 1 } }) : null;
  const fallback = await users.find({}, { projection: { uid: 1 } }).sort({ createdAt: 1 }).next();
  const ownerUid = configured?.uid ?? fallback?.uid;
  if (!ownerUid) return;

  const collections_ = [listings, pricePoints, searches, runs];

  const orphan = await listings.findOne({ uid: { $exists: false } }, { projection: { _id: 1 } });
  if (orphan) {
    await Promise.all(
      collections_.map((collection) =>
        collection.updateMany({ uid: { $exists: false } }, { $set: { uid: ownerUid } }),
      ),
    );
  }

  // Une adresse contenant une espace ne peut venir que d'une saisie fautive :
  // ce compte n'a jamais rien collecté, et ce qu'on lui a attribué revient au
  // compte configuré.
  if (configured?.uid) {
    const ghosts = await users
      .find({ email: { $regex: /\s/ } }, { projection: { uid: 1, email: 1 } })
      .toArray();

    for (const ghost of ghosts) {
      if (!ghost.uid || ghost.uid === configured.uid) continue;
      for (const collection of collections_) {
        await collection
          .updateMany({ uid: ghost.uid }, { $set: { uid: configured.uid } })
          // Un même identifiant des deux côtés : l'original prime, on laisse.
          .catch(() => undefined);
      }
      await users.deleteOne({ uid: ghost.uid });
    }
  }
}

/** Conservé sous son ancien nom pour les appels existants. */
export const ensureAdminUser = ensureBaseline;

/**
 * Retire les index de l'époque où l'application n'avait qu'un utilisateur.
 *
 * Ils imposaient qu'un identifiant d'annonce ou de recherche soit unique dans
 * toute la base : deux personnes suivant la même annonce n'auraient pas pu
 * coexister, la seconde collecte échouant sur un doublon.
 */
async function dropSingleUserIndexes(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  const obsolete: [string, string][] = [
    ['listings', 'lbcId_1'],
    ['listings', 'isActive_1_lastSeenAt_-1'],
    ['price_points', 'lbcId_1_observedAt_1'],
    ['searches', 'lbcSearchId_1'],
    ['runs', 'startedAt_-1'],
  ];

  await Promise.all(
    obsolete.map(([collection, index]) =>
      db
        .collection(collection)
        .dropIndex(index)
        // Absent, donc déjà retiré : rien à signaler.
        .catch(() => undefined),
    ),
  );
}
