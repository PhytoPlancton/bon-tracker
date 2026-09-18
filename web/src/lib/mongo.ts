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
  return getClient().db(env.mongoDb);
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
      .then(async () => ensureIndexes(await getDb()))
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
  //
  // L'unicité de l'identifiant interne ne porte que sur les documents qui en
  // ont un : un index unique ordinaire refuserait deux valeurs absentes, et
  // ferait échouer toute requête sur une base d'avant le cloisonnement.
  const wanted: [string, Parameters<Db['collection']>[0], object, object][] = [
    ['users', 'users', { email: 1 }, { unique: true }],
    ['users', 'users', { uid: 1 }, { unique: true, partialFilterExpression: { uid: { $type: 'string' } } }],
    ['secrets', 'secrets', { key: 1 }, { unique: true }],
    ['listings', 'listings', { uid: 1, lbcId: 1 }, { unique: true }],
    ['listings', 'listings', { uid: 1, isActive: 1, lastSeenAt: -1 }, {}],
    ['price_points', 'price_points', { uid: 1, lbcId: 1, observedAt: 1 }, {}],
    ['searches', 'searches', { uid: 1, lbcSearchId: 1 }, { unique: true }],
    ['runs', 'runs', { uid: 1, startedAt: -1 }, {}],
  ];

  for (const [, collection, keys, options] of wanted) {
    await db
      .collection(collection)
      .createIndex(keys as never, options as never)
      .catch(async (error) => {
        // Un index déjà présent sous d'autres options bloque la création :
        // on retire l'ancien et on retente une fois.
        const name = Object.keys(keys)
          .map((key) => `${key}_${(keys as Record<string, number>)[key]}`)
          .join('_');
        await db.collection(collection).dropIndex(name).catch(() => undefined);
        await db
          .collection(collection)
          .createIndex(keys as never, options as never)
          .catch(() => {
            // L'application reste utilisable sans cet index, seulement moins
            // rapide : mieux vaut une lenteur qu'une panne.
            console.warn(`[base] index ${collection}.${name} non créé :`, error?.message ?? error);
          });
      });
  }
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
