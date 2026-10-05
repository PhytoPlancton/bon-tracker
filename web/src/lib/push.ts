import webpush from 'web-push';
import { collections } from './mongo';
import { decrypt, encrypt } from './crypto';

/**
 * Notifications Web Push, celles qu'un iPhone affiche pour une app ajoutée à
 * l'écran d'accueil (iOS 16.4 et suivants).
 *
 * Les clés VAPID qui signent chaque envoi sont tirées une fois pour toutes et
 * rangées chiffrées en base : rien à configurer à l'installation, et elles
 * survivent aux mises à jour. Les clés d'abonnement de chaque appareil sont
 * chiffrées elles aussi : elles suffisent à lui écrire.
 */

const VAPID_SECRET = 'vapid';

/** Identité de l'expéditeur, exigée par les services de notification. */
const SUBJECT = process.env.PUBLIC_URL || 'https://bontracker.nmt.ovh';

/** Une alerte de bonne affaire ne vaut plus grand-chose au bout de 12 h. */
const TTL_SECONDS = 12 * 60 * 60;

type Keys = { publicKey: string; privateKey: string };

const globalForPush = globalThis as unknown as { _vapid?: Promise<Keys> };

export function vapidKeys(): Promise<Keys> {
  if (!globalForPush._vapid) {
    globalForPush._vapid = loadOrCreateKeys().catch((error) => {
      globalForPush._vapid = undefined;
      throw error;
    });
  }
  return globalForPush._vapid;
}

async function loadOrCreateKeys(): Promise<Keys> {
  const { secrets } = await collections();
  const existing = await secrets.findOne({ key: VAPID_SECRET });
  if (existing) return JSON.parse(decrypt(existing)) as Keys;

  const fresh = webpush.generateVAPIDKeys();
  // Deux requêtes simultanées peuvent arriver ici : seule la première écrit,
  // la seconde relit ce qui a été retenu.
  await secrets.updateOne(
    { key: VAPID_SECRET },
    { $setOnInsert: { key: VAPID_SECRET, ...encrypt(JSON.stringify(fresh)), updatedAt: new Date() } },
    { upsert: true },
  );
  const stored = await secrets.findOne({ key: VAPID_SECRET });
  return JSON.parse(decrypt(stored!)) as Keys;
}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Seuls les services de notification, en https, sont acceptés : sans cela,
 * un abonnement forgé ferait écrire le serveur vers n'importe quelle adresse
 * de son réseau interne (la base, le collecteur).
 */
export function acceptableEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') return false;
    return !INTERNAL_HOSTS.test(url.hostname) || process.env.PUSH_ALLOW_LOCAL === 'true';
  } catch {
    return false;
  }
}

/** Noms qui désignent le réseau de la maison ou de Docker, jamais un service de notification. */
const INTERNAL_HOSTS = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|mongo$|web$|worker$|host\.docker\.internal$)/i;

export async function saveSubscription(uid: string, subscription: BrowserSubscription, userAgent: string | null) {
  const { pushSubscriptions } = await collections();
  await pushSubscriptions.updateOne(
    { endpoint: subscription.endpoint },
    {
      $set: {
        uid,
        endpoint: subscription.endpoint,
        keys: encrypt(JSON.stringify(subscription.keys)),
        userAgent: userAgent?.slice(0, 200) ?? null,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}

export async function removeSubscription(uid: string, endpoint: string): Promise<void> {
  const { pushSubscriptions } = await collections();
  await pushSubscriptions.deleteOne({ uid, endpoint });
}

export async function countSubscriptions(uid: string): Promise<number> {
  const { pushSubscriptions } = await collections();
  return pushSubscriptions.countDocuments({ uid });
}

export interface PushPayload {
  title: string;
  body: string;
  /** Page ouverte au toucher de la notification. */
  url: string;
  /** Une notification du même tag remplace la précédente plutôt que de s'empiler. */
  tag?: string;
  image?: string | null;
}

/**
 * Envoie à tous les appareils d'un compte. Un appareil que le service déclare
 * disparu (application supprimée, autorisation retirée) est oublié.
 */
export async function sendToUser(uid: string, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  const { pushSubscriptions } = await collections();
  const devices = await pushSubscriptions.find({ uid }).toArray();
  if (!devices.length) return { sent: 0, failed: 0 };

  const { publicKey, privateKey } = await vapidKeys();
  let sent = 0;
  let failed = 0;

  await Promise.all(
    devices.map(async (device) => {
      try {
        await webpush.sendNotification(
          { endpoint: device.endpoint, keys: JSON.parse(decrypt(device.keys)) },
          JSON.stringify(payload),
          { TTL: TTL_SECONDS, urgency: 'high', vapidDetails: { subject: SUBJECT, publicKey, privateKey } },
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await pushSubscriptions.deleteOne({ endpoint: device.endpoint });
        } else {
          console.warn('[notifications] envoi échoué :', status ?? (error as Error).message);
        }
      }
    }),
  );
  return { sent, failed };
}
