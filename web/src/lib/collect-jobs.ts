import { randomUUID } from 'node:crypto';
import type { Collection } from 'mongodb';
import { env } from './env';

/**
 * Cycle de vie commun aux collectes confiées au collecteur — la cote d'un
 * modèle de voiture comme le marché d'une ville — : envoi, avancement, arrêt,
 * collecte morte, abandon au redémarrage.
 *
 * Écrit une fois pour les deux domaines : chaque règle ici (ne jamais rester
 * « en cours » pour toujours, garder la collecte précédente en cas d'échec,
 * écarter un envoi remplacé) a coûté un bug pour être trouvée.
 */
export interface CollectJob {
  id: string;
  uid: string;
  /** Clé de mutualisation : même demande, même collecte. */
  key: string;
  status: 'queued' | 'running' | 'done' | 'error';
  pages: number;
  ads: number;
  error: string | null;
  /** Annonces retenues par la dernière collecte réussie. */
  adIds: string[];
  /** Celles de la collecte en cours, basculées dans adIds une fois finie. */
  pendingIds: string[];
  createdAt: Date;
  /** Dernière nouvelle du collecteur : sans elle depuis trop longtemps, la collecte est morte. */
  updatedAt?: Date;
  collectedAt: Date | null;
  /** Ce que fait le collecteur en ce moment, pour l'écran d'attente. */
  activity?: unknown;
  /** Arrêt demandé depuis l'application : le collecteur garde ce qu'il a lu et s'arrête. */
  stopRequested?: boolean;
  /** Identifie l'envoi en cours au collecteur : un envoi plus ancien qui se réveille est écarté. */
  runId?: string;
}

export interface ProgressPatch {
  runId?: string;
  status?: 'running' | 'done' | 'error';
  pages?: number;
  ads?: number;
  error?: string;
  activity?: unknown;
  /** Ce que la collecte a appris en chemin (codes d'un modèle, forme d'un lieu). */
  learned?: Record<string, unknown>;
}

/** Une collecte de moins d'un jour est réutilisée plutôt que refaite. */
export const FRESH_FOR = 24 * 60 * 60 * 1000;

/** Collectes simultanées par compte et par domaine : chacune occupe le navigateur plusieurs minutes. */
export const MAX_ACTIVE = 3;

/**
 * Sans nouvelles du collecteur depuis ce délai, une collecte ne progresse
 * plus : collecteur redémarré, Chrome fermé. Une collecte dure quelques
 * minutes, mais peut attendre derrière un relevé complet de tous les comptes.
 */
const STALE_AFTER = 20 * 60 * 1000;

export function collectJobs<J extends CollectJob>(options: {
  collection: () => Promise<Collection<J>>;
  /** Commande du collecteur qui mène ces collectes : « /market », « /immo ». */
  workerPath: string;
  /** Ce que le collecteur doit savoir de la demande. */
  payload: (job: J) => Record<string, unknown>;
}) {
  // Les filtres portent sur les seuls champs communs : on les écrit contre
  // le type commun, que tout document de domaine étend.
  const jobs = async () => (await options.collection()) as unknown as Collection<CollectJob>;

  /** Collectes laissées en cours par un collecteur qui vient de redémarrer. */
  async function abandon(before: Date): Promise<number> {
    const collection = await jobs();
    const result = await collection.updateMany(
      {
        status: { $in: ['queued', 'running'] },
        $or: [
          { updatedAt: { $lt: before } },
          { updatedAt: { $exists: false }, createdAt: { $lt: before } },
        ],
      },
      {
        $set: {
          status: 'error',
          error: 'Le collecteur a redémarré pendant la collecte. Actualise pour la relancer.',
          updatedAt: new Date(),
        },
      },
    );
    return result.modifiedCount;
  }

  /** Rend la main sur les collectes mortes, pour qu'on puisse les relancer. */
  async function settleStale(): Promise<void> {
    const collection = await jobs();
    const cutoff = new Date(Date.now() - STALE_AFTER);
    await collection.updateMany(
      {
        status: { $in: ['queued', 'running'] },
        $or: [
          { updatedAt: { $lt: cutoff } },
          { updatedAt: { $exists: false }, createdAt: { $lt: cutoff } },
        ],
      },
      {
        $set: {
          status: 'error',
          error: 'Collecte interrompue sans nouvelles du collecteur. Vérifie que la fenêtre Chrome dédiée est ouverte, puis Actualise.',
        },
      },
    );
  }

  /** Confie la collecte au collecteur, qui répond aussitôt et travaille ensuite. */
  async function dispatch(job: J): Promise<void> {
    const collection = await jobs();
    // Annuler puis relancer aussitôt laisse l'ancien envoi dans la file du
    // collecteur : sans cette marque, il repartirait à côté du nouveau.
    const runId = randomUUID();
    await collection.updateOne({ id: job.id }, { $set: { runId } });
    try {
      const response = await fetch(`${env.workerUrl}${options.workerPath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-worker-token': env.workerToken },
        body: JSON.stringify({ queryId: job.id, runId, ...options.payload(job) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`réponse ${response.status}`);
    } catch (cause) {
      await collection.updateOne(
        { id: job.id },
        {
          $set: {
            status: 'error',
            error: `Collecteur injoignable (${cause instanceof Error ? cause.message : String(cause)}). Vérifie qu'il tourne et que le Chrome dédié est ouvert.`,
          },
        },
      );
    }
  }

  /** Relance une collecte terminée ou en échec ; une collecte en cours est laissée telle quelle. */
  async function refresh(uid: string, id: string): Promise<J | null> {
    await settleStale();
    const collection = await jobs();
    const job = (await collection.findOne({ uid, id }, { projection: { _id: 0 } })) as J | null;
    if (!job) return null;
    if (job.status === 'queued' || job.status === 'running') return job;

    const next = { ...job, status: 'queued' as const, error: null, stopRequested: false };
    await collection.updateOne(
      { id },
      { $set: { status: 'queued', error: null, stopRequested: false, updatedAt: new Date() } },
    );
    await dispatch(next);
    return next;
  }

  /**
   * Arrête une collecte. En attente, elle est annulée sur-le-champ ; en cours,
   * le collecteur le lit à la page suivante, garde ce qu'il a déjà lu et
   * s'arrête. Une collecte en attente n'a pas encore occupé le navigateur :
   * rien à garder.
   */
  async function stop(uid: string, id: string): Promise<J | null> {
    const collection = await jobs();
    const job = await collection.findOne({ uid, id }, { projection: { _id: 0 } });
    if (!job) return null;

    if (job.status === 'queued') {
      await collection.updateOne(
        { id, status: 'queued' },
        {
          $set: {
            status: 'error',
            error: 'Collecte annulée avant d’avoir commencé.',
            stopRequested: true,
            activity: null,
            updatedAt: new Date(),
          },
        },
      );
    } else if (job.status === 'running') {
      await collection.updateOne({ id, status: 'running' }, { $set: { stopRequested: true } });
    }
    return (await collection.findOne({ uid, id }, { projection: { _id: 0 } })) as J | null;
  }

  /**
   * Avancement remonté par le collecteur, page après page. La réponse lui dit
   * de s'arrêter quand l'application l'a demandé, ou quand un envoi plus
   * récent a pris la collecte en charge.
   */
  async function progress(id: string, patch: ProgressPatch): Promise<{ found: boolean; stop: boolean }> {
    const collection = await jobs();
    const current = await collection.findOne({ id }, { projection: { stopRequested: 1, runId: 1 } });
    if (!current) return { found: false, stop: false };
    const superseded = Boolean(patch.runId && current.runId && patch.runId !== current.runId);
    // Un envoi remplacé ne doit plus rien écrire : la collecte appartient au nouveau.
    if (superseded) return { found: true, stop: true };
    const stop = current.stopRequested === true;
    // Une collecte annulée en attente ne doit pas repartir quand son tour vient.
    if (stop && patch.status === 'running') return { found: true, stop };

    if (patch.status === 'done') {
      // La collecte réussie remplace la précédente d'un bloc : jamais de
      // mélange entre deux relevés.
      const result = await collection.updateOne({ id }, [
        {
          $set: {
            status: 'done',
            adIds: '$pendingIds',
            ads: { $size: '$pendingIds' },
            pendingIds: [],
            collectedAt: '$$NOW',
            updatedAt: '$$NOW',
            activity: null,
            error: null,
            stopRequested: false,
            ...(patch.pages !== undefined ? { pages: patch.pages } : {}),
          },
        },
      ]);
      return { found: result.matchedCount > 0, stop };
    }

    const set: Record<string, unknown> = { updatedAt: new Date(), ...(patch.learned ?? {}) };
    if (patch.status) set.status = patch.status;
    if (patch.pages !== undefined) set.pages = patch.pages;
    if (patch.ads !== undefined) set.ads = patch.ads;
    if (patch.activity !== undefined) set.activity = patch.activity;
    if (patch.status === 'running') {
      set.error = null;
      if (patch.activity === undefined) set.activity = null;
      // Seul le démarrage repart de zéro : une remontée d'avancement qui
      // répéterait « en cours » ne doit pas perdre les annonces déjà reçues.
      await collection.updateOne({ id, status: { $ne: 'running' } }, { $set: { pendingIds: [] } });
    }
    // En cas d'échec, la dernière collecte réussie reste consultable.
    if (patch.status === 'error') {
      set.error = patch.error ?? 'Échec de la collecte';
      set.stopRequested = false;
    }

    const result = await collection.updateOne({ id }, { $set: set });
    return { found: result.matchedCount > 0, stop };
  }

  /** Rattache des annonces reçues à la collecte en cours. */
  async function attach(id: string, lbcIds: string[]): Promise<void> {
    const collection = await jobs();
    await collection.updateOne({ id }, { $addToSet: { pendingIds: { $each: lbcIds } } });
  }

  async function list(uid: string): Promise<J[]> {
    await settleStale();
    const collection = await jobs();
    return (await collection
      .find({ uid }, { projection: { _id: 0, adIds: 0, pendingIds: 0 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray()) as unknown as J[];
  }

  async function get(uid: string, id: string): Promise<J | null> {
    await settleStale();
    const collection = await jobs();
    return (await collection.findOne({ uid, id }, { projection: { _id: 0, pendingIds: 0 } })) as J | null;
  }

  async function remove(uid: string, id: string): Promise<boolean> {
    const collection = await jobs();
    const result = await collection.deleteOne({ uid, id });
    return result.deletedCount > 0;
  }

  async function activeCount(uid: string): Promise<number> {
    const collection = await jobs();
    return collection.countDocuments({ uid, status: { $in: ['queued', 'running'] } });
  }

  return { abandon, settleStale, dispatch, refresh, stop, progress, attach, list, get, remove, activeCount };
}
