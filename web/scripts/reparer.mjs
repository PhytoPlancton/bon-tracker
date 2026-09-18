#!/usr/bin/env node
/**
 * Montre à qui appartiennent les données, et les rend à leur propriétaire.
 *
 * Le passage à plusieurs comptes a pu attribuer un historique au mauvais
 * compte — celui né d'une adresse mal saisie — ou le laisser rattaché à un
 * compte disparu. Dans les deux cas l'application paraît vide alors que tout
 * est là. Ce script constate, répare, et reconstate.
 *
 *   docker compose run --rm web node scripts/reparer.mjs
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'bon_tracker';
const configured = process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? null;

if (!uri) {
  console.error('MONGODB_URI manquant.');
  process.exit(1);
}

/**
 * Une adresse exploitable : lettres, chiffres et ponctuation courante.
 *
 * Chercher ce qui cloche ne marche pas — une saisie fautive peut contenir
 * n'importe quel caractère invisible, et « contient une espace » laisse
 * passer le reste. On reconnaît donc ce qui est valide, et le reste ne l'est
 * pas.
 */
const VALID_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const users = db.collection('users');
const owned = [
  db.collection('listings'),
  db.collection('price_points'),
  db.collection('searches'),
  db.collection('runs'),
];

console.log('\n─────────────────────────────────────────');
console.log('  État actuel');
console.log('─────────────────────────────────────────\n');
await describe();

// --- Qui doit posséder les données ? ---------------------------------------
const everyone = await users.find({}).sort({ createdAt: 1 }).toArray();
const valid = everyone.filter((user) => VALID_EMAIL.test(user.email ?? ''));
const owner =
  (configured ? valid.find((user) => user.email === configured) : null) ?? valid[0] ?? null;

if (!owner) {
  console.log('Aucun compte valide : rien à réparer.');
  await client.close();
  process.exit(0);
}

if (!owner.uid) {
  const { randomUUID } = await import('node:crypto');
  owner.uid = randomUUID();
  await users.updateOne({ _id: owner._id }, { $set: { uid: owner.uid } });
  console.log(`Identifiant attribué à ${owner.email}`);
}

console.log(`\nPropriétaire retenu : ${owner.email}\n`);

// --- Rendre ce qui est mal placé -------------------------------------------
const knownUids = new Set((await users.find({}, { projection: { uid: 1 } }).toArray()).map((u) => u.uid));
let moved = 0;

for (const collection of owned) {
  // Sans propriétaire, ou rattaché à un compte qui n'existe plus.
  const orphans = await collection.countDocuments({
    $or: [{ uid: { $exists: false } }, { uid: { $nin: [...knownUids] } }],
  });
  if (orphans) {
    await collection.updateMany(
      { $or: [{ uid: { $exists: false } }, { uid: { $nin: [...knownUids] } }] },
      { $set: { uid: owner.uid } },
    );
    moved += orphans;
  }
}

// Comptes nés d'une saisie fautive : ils n'ont jamais rien collecté.
const ghosts = everyone.filter((user) => !VALID_EMAIL.test(user.email ?? ''));
for (const ghost of ghosts) {
  if (!ghost.uid || ghost.uid === owner.uid) {
    await users.deleteOne({ _id: ghost._id });
    continue;
  }
  for (const collection of owned) {
    const count = await collection.countDocuments({ uid: ghost.uid });
    if (!count) continue;
    await collection.updateMany({ uid: ghost.uid }, { $set: { uid: owner.uid } }).catch(() => undefined);
    moved += count;
  }
  await users.deleteOne({ _id: ghost._id });
  console.log(`Compte « ${ghost.email} » absorbé`);
}

console.log(`\n${moved} document(s) rendus à ${owner.email}`);

console.log('\n─────────────────────────────────────────');
console.log('  Après réparation');
console.log('─────────────────────────────────────────\n');
await describe();

await client.close();

async function describe() {
  const all = await users.find({}, { projection: { _id: 0, email: 1, uid: 1 } }).toArray();
  const byUid = new Map(all.map((user) => [user.uid, user.email]));

  for (const user of all) {
    console.log(`  ${user.email}${user.uid ? '' : '   (sans identifiant)'}`);
  }
  if (!all.length) console.log('  aucun compte');

  console.log('');
  for (const collection of owned) {
    const groups = await collection
      .aggregate([{ $group: { _id: '$uid', count: { $sum: 1 } } }, { $sort: { count: -1 } }])
      .toArray();

    const name = collection.collectionName.padEnd(13);
    if (!groups.length) {
      console.log(`  ${name} vide`);
      continue;
    }
    const detail = groups
      .map((group) => {
        const who = group._id ? (byUid.get(group._id) ?? 'compte disparu') : 'sans propriétaire';
        return `${group.count} → ${who}`;
      })
      .join(' · ');
    console.log(`  ${name} ${detail}`);
  }
}
