import { MongoClient, type Collection, type Db } from 'mongodb';
import { env } from './env';
import type { Listing, PricePoint, Run, SavedSearch, User } from './types';

/**
 * Un seul client pour tout le process, avec un pool volontairement étroit :
 * le cluster est partagé entre plusieurs applications et plafonné à 500
 * connexions simultanées. Le client MongoDB gère lui-même la réutilisation
 * des sockets, il ne faut donc jamais ouvrir/fermer par requête.
 */
const globalForMongo = globalThis as unknown as {
  _mongoClient?: MongoClient;
  _mongoIndexes?: Promise<void>;
  _mongoBaseline?: Promise<void>;
};

function getClient(): MongoClient {
  if (!globalForMongo._mongoClient) {
    globalForMongo._mongoClient = new MongoClient(env.mongoUri, {
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 60_000,
      serverSelectionTimeoutMS: 10_000,
    });
  }
  return globalForMongo._mongoClient;
}

export async function getDb(): Promise<Db> {
  const client = getClient();
  const db = client.db(env.mongoDb);
  if (!globalForMongo._mongoIndexes) {
    globalForMongo._mongoIndexes = ensureIndexes(db).catch((error) => {
      globalForMongo._mongoIndexes = undefined;
      throw error;
    });
  }
  await globalForMongo._mongoIndexes;
  return db;
}

/**
 * Prépare la base une seule fois par processus : reprise d'une installation
 * antérieure, rattachement des données sans propriétaire. Chargée à la
 * demande, car elle s'appuie elle-même sur cette connexion.
 */
async function ensureBaselineOnce(): Promise<void> {
  if (!globalForMongo._mongoBaseline) {
    globalForMongo._mongoBaseline = import('./bootstrap')
      .then((module) => module.ensureBaseline())
      .catch((error) => {
        globalForMongo._mongoBaseline = undefined;
        throw error;
      });
  }
  await globalForMongo._mongoBaseline;
}

async function ensureIndexes(db: Db): Promise<void> {
  // Les identifiants du site ne sont uniques qu'au sein d'un compte : deux
  // personnes peuvent suivre la même annonce, chacune avec son historique.
  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('users').createIndex({ uid: 1 }, { unique: true }),
    db.collection('secrets').createIndex({ key: 1 }, { unique: true }),
    db.collection('listings').createIndex({ uid: 1, lbcId: 1 }, { unique: true }),
    db.collection('listings').createIndex({ uid: 1, isActive: 1, lastSeenAt: -1 }),
    db.collection('price_points').createIndex({ uid: 1, lbcId: 1, observedAt: 1 }),
    db.collection('searches').createIndex({ uid: 1, lbcSearchId: 1 }, { unique: true }),
    db.collection('runs').createIndex({ uid: 1, startedAt: -1 }),
  ]);
}

export async function collections() {
  const db = await getDb();
  await ensureBaselineOnce();
  return {
    users: db.collection<User>('users'),
    secrets: db.collection<{ key: string; ciphertext: string; iv: string; tag: string; updatedAt: Date }>('secrets'),
    listings: db.collection<Listing>('listings') as Collection<Listing>,
    pricePoints: db.collection<PricePoint>('price_points') as Collection<PricePoint>,
    searches: db.collection<SavedSearch>('searches') as Collection<SavedSearch>,
    runs: db.collection<Run>('runs') as Collection<Run>,
  };
}
