import type { AnyBulkWriteOperation } from 'mongodb';
import { collections } from './mongo';
import type { Listing, ListingSource, PricePoint, ScrapedListing } from './types';

export interface IngestResult {
  seen: number;
  created: number;
  priceChanges: number;
  deactivated: number;
}

/**
 * Enregistre un lot d'annonces observées pour une source donnée.
 *
 * Règles :
 *  - un point de prix n'est écrit que si le prix a réellement bougé (ou à la
 *    première observation) : le graphe reste donc une suite de changements ;
 *  - une annonce peut appartenir à plusieurs sources (favoris + recherches) ;
 *    elle n'est désactivée que lorsqu'elle a disparu de toutes ses sources.
 */
export async function ingestListings(
  uid: string,
  source: ListingSource,
  scraped: ScrapedListing[],
): Promise<IngestResult> {
  const { listings, pricePoints } = await collections();
  const now = new Date();
  const result: IngestResult = { seen: scraped.length, created: 0, priceChanges: 0, deactivated: 0 };

  const seenIds = scraped.map((item) => item.lbcId);
  const existing = seenIds.length
    ? await listings.find({ uid, lbcId: { $in: seenIds } }).toArray()
    : [];
  const byId = new Map(existing.map((doc) => [doc.lbcId, doc]));

  const listingOps: AnyBulkWriteOperation<Listing>[] = [];
  const newPoints: PricePoint[] = [];

  for (const item of scraped) {
    const previous = byId.get(item.lbcId);
    const priceChanged =
      item.price !== null && (!previous || previous.currentPrice !== item.price);

    if (!previous) result.created += 1;
    if (priceChanged) {
      if (previous) result.priceChanges += 1;
      newPoints.push({ uid, lbcId: item.lbcId, price: item.price as number, observedAt: now });
    }

    listingOps.push({
      updateOne: {
        filter: { uid, lbcId: item.lbcId },
        update: {
          $set: {
            title: item.title,
            url: item.url,
            imageUrl: item.imageUrl ?? null,
            category: item.category ?? null,
            sellerType: item.sellerType ?? null,
            location: item.location ?? null,
            lastSeenAt: now,
            isActive: true,
            ...(item.price !== null ? { currentPrice: item.price } : {}),
          },
          $setOnInsert: {
            uid,
            lbcId: item.lbcId,
            firstSeenAt: now,
            ...(item.price === null ? { currentPrice: null } : {}),
          },
          $addToSet: { sources: source },
        },
        upsert: true,
      },
    });
  }

  if (listingOps.length) await listings.bulkWrite(listingOps, { ordered: false });
  if (newPoints.length) await pricePoints.insertMany(newPoints, { ordered: false });

  // Annonces qui étaient rattachées à cette source et qu'on n'a plus vues.
  const gone = await listings
    .find(
      { uid, sources: source, lbcId: { $nin: seenIds } },
      { projection: { lbcId: 1, sources: 1 } },
    )
    .toArray();

  if (gone.length) {
    await listings.bulkWrite(
      gone.map((doc) => {
        const remaining = (doc.sources ?? []).filter((s) => s !== source);
        if (remaining.length === 0) result.deactivated += 1;
        return {
          updateOne: {
            filter: { uid, lbcId: doc.lbcId },
            update: {
              $pull: { sources: source },
              ...(remaining.length === 0 ? { $set: { isActive: false } } : {}),
            },
          },
        } as AnyBulkWriteOperation<Listing>;
      }),
      { ordered: false },
    );
  }

  return result;
}

export interface ListingSummary {
  lbcId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  location: string | null;
  sellerType: 'pro' | 'private' | null;
  currentPrice: number | null;
  initialPrice: number | null;
  priceChangeCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  isActive: boolean;
  sources: string[];
  /** Prix successifs, pour le graphe miniature de la liste. */
  history: number[];
}

/** Liste enrichie du premier prix connu et du nombre de changements de prix. */
export async function listListings(
  uid: string,
  options: { includeInactive?: boolean; source?: string } = {},
): Promise<ListingSummary[]> {
  const { listings } = await collections();
  const filter: Record<string, unknown> = { uid };
  if (!options.includeInactive) filter.isActive = true;
  if (options.source) filter.sources = options.source;

  const docs = await listings
    .aggregate<ListingSummary & { _id?: unknown }>([
      { $match: filter },
      { $sort: { lastSeenAt: -1 } },
      { $limit: 500 },
      {
        $lookup: {
          from: 'price_points',
          as: 'points',
          let: { owner: '$uid', ad: '$lbcId' },
          // La jointure porte aussi sur le propriétaire : deux personnes
          // peuvent suivre la même annonce sans mélanger leurs historiques.
          pipeline: [
            {
              $match: {
                $expr: { $and: [{ $eq: ['$uid', '$$owner'] }, { $eq: ['$lbcId', '$$ad'] }] },
              },
            },
            { $sort: { observedAt: 1 } },
            { $project: { price: 1, observedAt: 1, _id: 0 } },
          ],
        },
      },
      {
        $project: {
          _id: 0,
          lbcId: 1,
          title: 1,
          url: 1,
          imageUrl: 1,
          location: 1,
          sellerType: 1,
          currentPrice: 1,
          isActive: 1,
          sources: 1,
          firstSeenAt: 1,
          lastSeenAt: 1,
          initialPrice: { $ifNull: [{ $first: '$points.price' }, null] },
          priceChangeCount: { $max: [{ $subtract: [{ $size: '$points' }, 1] }, 0] },
          history: '$points.price',
        },
      },
    ])
    .toArray();

  return docs.map(serializeSummary);
}

function serializeSummary(doc: ListingSummary): ListingSummary {
  return {
    ...doc,
    firstSeenAt: new Date(doc.firstSeenAt).toISOString(),
    lastSeenAt: new Date(doc.lastSeenAt).toISOString(),
  };
}

export async function getListingDetail(uid: string, lbcId: string) {
  const { listings, pricePoints } = await collections();
  const listing = await listings.findOne({ uid, lbcId }, { projection: { _id: 0 } });
  if (!listing) return null;
  const points = await pricePoints
    .find({ uid, lbcId }, { projection: { _id: 0, price: 1, observedAt: 1 } })
    .sort({ observedAt: 1 })
    .toArray();

  return {
    ...listing,
    firstSeenAt: listing.firstSeenAt.toISOString(),
    lastSeenAt: listing.lastSeenAt.toISOString(),
    history: points.map((point) => ({
      price: point.price,
      observedAt: point.observedAt.toISOString(),
    })),
  };
}
