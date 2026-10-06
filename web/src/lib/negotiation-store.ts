import { randomUUID } from 'node:crypto';
import { collections } from './mongo';
import { env } from './env';
import { harmonize, screen, type Ad } from './estimation';
import { createQuery, ingestMarketAds, loadAds, loadGoneAds, pretty, prettyModel } from './market-store';
import { signalsFor, type Signal } from './signals';
import { buildSheet, type Sheet } from './negotiation';
import type { MarketAd, Negotiation, ScrapedListing } from './types';

/**
 * Négociations : une annonce précise, mise face au marché de son modèle.
 *
 * Une annonce déjà connue (relevée dans un marché ou parmi les favoris) se
 * négocie aussitôt. Une inconnue est d'abord lue par le collecteur ; dans les
 * deux cas, la cote de son modèle est calculée — ou reprise si elle date de
 * moins d'un jour — avant que la fiche ne s'affiche.
 */

/** Un numéro d'annonce, tel qu'il figure dans tout lien du site. */
export function lbcIdFrom(input: string): string | null {
  const text = input.trim();
  if (/^\d{6,12}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (!/(^|\.)leboncoin\.fr$/.test(url.hostname)) return null;
    return url.pathname.match(/(\d{6,12})(?:\.htm)?\/?$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export type StartOutcome = { kind: 'ok'; negotiation: Negotiation } | { kind: 'invalid' } | { kind: 'error'; message: string };

export async function startNegotiation(uid: string, input: string): Promise<StartOutcome> {
  const lbcId = lbcIdFrom(input);
  if (!lbcId) return { kind: 'invalid' };
  const { negotiations, marketAds } = await collections();

  // La même annonce renégociée reprend sa fiche, mise à jour.
  const existing = await negotiations.findOne({ uid, lbcId }, { projection: { _id: 0 } });
  const now = new Date();
  const negotiation: Negotiation = existing ?? {
    id: randomUUID(),
    uid,
    lbcId,
    url: `https://www.leboncoin.fr/ad/voitures/${lbcId}`,
    status: 'reading',
    queryId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  if (!existing) await negotiations.insertOne({ ...negotiation });

  const ad = await marketAds.findOne({ lbcId }, { projection: { _id: 0 } });
  if (ad && ad.brandCode && ad.modelCode && ad.year) {
    return attach(negotiation, ad);
  }

  await negotiations.updateOne({ id: negotiation.id }, { $set: { status: 'reading', error: null, updatedAt: now } });
  await dispatchRead({ ...negotiation, status: 'reading' });
  return { kind: 'ok', negotiation: { ...negotiation, status: 'reading', error: null } };
}

/** Rattache l'annonce à la cote de son modèle, en la lançant au besoin. */
async function attach(negotiation: Negotiation, ad: MarketAd): Promise<StartOutcome> {
  const { negotiations } = await collections();
  const brand = pretty(ad.brandCode!);
  const outcome = await createQuery(negotiation.uid, {
    brand,
    model: prettyModel(ad.brandCode!, ad.modelCode!),
    // Deux ans de part et d'autre : assez pour réunir des comparables, sans
    // déborder sur une autre génération dans la plupart des cas.
    yearMin: ad.year! - 2,
    yearMax: ad.year! + 2,
    powerMin: null,
    powerMax: null,
    codes: { brand: ad.brandCode!, model: ad.modelCode! },
  });

  if (outcome.kind === 'too_many') {
    return fail(negotiation, 'Trois estimations sont déjà en cours : réessaie dans quelques minutes.');
  }
  const status = outcome.query.status === 'done' ? 'ready' : 'collecting';
  const update = { status, queryId: outcome.query.id, error: null, updatedAt: new Date() } as const;
  await negotiations.updateOne({ id: negotiation.id }, { $set: update });
  return { kind: 'ok', negotiation: { ...negotiation, ...update } };
}

async function fail(negotiation: Negotiation, message: string): Promise<StartOutcome> {
  const { negotiations } = await collections();
  await negotiations.updateOne(
    { id: negotiation.id },
    { $set: { status: 'error', error: message, updatedAt: new Date() } },
  );
  return { kind: 'error', message };
}

async function dispatchRead(negotiation: Negotiation): Promise<void> {
  try {
    const response = await fetch(`${env.workerUrl}/ad`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-token': env.workerToken },
      body: JSON.stringify({ negotiationId: negotiation.id, lbcId: negotiation.lbcId, url: negotiation.url }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`réponse ${response.status}`);
  } catch (cause) {
    await fail(
      negotiation,
      `Collecteur injoignable (${cause instanceof Error ? cause.message : String(cause)}). Vérifie qu'il tourne et que le Chrome dédié est ouvert.`,
    );
  }
}

/** Le collecteur a lu l'annonce, ou n'a pas pu. */
export async function receiveAd(id: string, ad: ScrapedListing | null, error: string | null): Promise<boolean> {
  const { negotiations, marketAds } = await collections();
  const negotiation = await negotiations.findOne({ id }, { projection: { _id: 0 } });
  if (!negotiation) return false;

  if (!ad || error) {
    await fail(negotiation, error ?? 'Annonce introuvable : elle a peut-être été retirée.');
    return true;
  }
  await ingestMarketAds(null, [ad]);
  const stored = await marketAds.findOne({ lbcId: ad.lbcId }, { projection: { _id: 0 } });
  if (!stored?.brandCode || !stored.modelCode || !stored.year) {
    await fail(negotiation, 'Ce n’est pas une annonce de voiture, ou sa marque, son modèle et son année n’y sont pas renseignés.');
    return true;
  }
  await attach(negotiation, stored);
  return true;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export interface NegotiationView {
  negotiation: Negotiation;
  ad: (Ad & { priceHistory: { price: number; at: Date }[] }) | null;
  query: { id: string; brand: string; model: string; status: string; pages: number; ads: number; activity: unknown } | null;
  sheet: Sheet | null;
  pool: Ad[];
  /** À vérifier, et ce qui rassure : prix, kilométrage, republication, description. */
  signals: Signal[];
}

export async function getNegotiation(uid: string, id: string): Promise<NegotiationView | null> {
  const { negotiations, marketAds, marketQueries } = await collections();
  let negotiation = await negotiations.findOne({ uid, id }, { projection: { _id: 0 } });
  if (!negotiation) return null;

  const query = negotiation.queryId
    ? await marketQueries.findOne({ id: negotiation.queryId }, { projection: { _id: 0, pendingIds: 0 } })
    : null;

  // L'état suit celui de la cote : prête quand elle l'est, en échec si elle
  // a échoué sans rien laisser d'exploitable.
  if (negotiation.status === 'collecting' && query) {
    const next =
      query.status === 'done' || (query.status === 'error' && query.adIds.length)
        ? { status: 'ready' as const, error: null }
        : query.status === 'error'
          ? { status: 'error' as const, error: query.error ?? 'La cote du modèle n’a pas pu être établie.' }
          : null;
    if (next) {
      await negotiations.updateOne({ id }, { $set: { ...next, updatedAt: new Date() } });
      negotiation = { ...negotiation, ...next };
    }
  }

  const doc = await marketAds.findOne({ lbcId: negotiation.lbcId }, { projection: { _id: 0 } });
  let ad: NegotiationView['ad'] = null;
  let sheet: Sheet | null = null;
  let pool: Ad[] = [];
  let signals: Signal[] = [];

  if (doc) {
    const raw = adFrom(doc);
    const others = query && negotiation.status === 'ready' ? await loadAds(query.adIds.filter((other) => other !== doc.lbcId)) : [];
    // Harmonisés ensemble : le moteur d'une annonce muette se déduit de ceux
    // que portent les autres annonces du modèle.
    const [harmonized, ...rest] = screen([raw, ...others]);
    ad = { ...harmonized, priceHistory: doc.priceHistory ?? [{ price: doc.price, at: doc.firstSeenAt }] };
    pool = rest;
    if (negotiation.status === 'ready') {
      sheet = buildSheet({ ad: harmonized, pool, history: ad.priceHistory });
    }

    // Les annonces parties du modèle disent si celle-ci a déjà été publiée
    // sous un autre numéro ; la description, ce que le vendeur avoue.
    const goneRaw = query ? await loadGoneAds(query.codes) : [];
    const gone = harmonize([...rest, ...goneRaw]).slice(rest.length) as typeof goneRaw;
    signals = signalsFor(
      { ...harmonized, description: doc.description ?? null, firstSeenAt: doc.firstSeenAt },
      { median: sheet?.fair?.median ?? null, gone: gone.filter((other) => other.lbcId !== doc.lbcId), live: rest },
    );
    if (sheet) {
      const republished = signals.find((signal) => signal.label === 'Republiée');
      // Une voiture remise en ligne pour paraître neuve cherche preneur depuis
      // plus longtemps qu'elle ne l'affiche : c'est un argument.
      if (republished) sheet.arguments.splice(1, 0, { text: republished.detail, weight: 'strong' });
      if (signals.some((signal) => signal.label === 'Prix anormalement bas')) {
        sheet.warnings = sheet.warnings.filter((warning) => !warning.startsWith('Prix très inférieur'));
      }
    }
  }

  return {
    negotiation,
    ad,
    query: query
      ? {
          id: query.id,
          brand: query.brand,
          model: query.model,
          status: query.status,
          pages: query.pages,
          ads: query.ads,
          activity: query.activity ?? null,
        }
      : null,
    sheet,
    pool,
    signals,
  };
}

function adFrom(doc: MarketAd): Ad {
  return {
    lbcId: doc.lbcId,
    title: doc.title,
    url: doc.url,
    price: doc.price,
    km: doc.km ?? null,
    year: doc.year ?? null,
    version: doc.version ?? null,
    location: doc.location ?? null,
    imageUrl: doc.imageUrl ?? null,
    sellerType: doc.sellerType ?? null,
    gearbox: doc.gearbox ?? null,
    fuel: doc.fuel ?? null,
    onlineSince: doc.publishedAt ?? doc.firstSeenAt ?? null,
  };
}

export async function listNegotiations(uid: string) {
  const { negotiations, marketAds } = await collections();
  const list = await negotiations.find({ uid }, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(30).toArray();
  const ads = await marketAds
    .find({ lbcId: { $in: list.map((item) => item.lbcId) } }, { projection: { _id: 0, lbcId: 1, title: 1, price: 1, imageUrl: 1 } })
    .toArray();
  const byId = new Map(ads.map((ad) => [ad.lbcId, ad]));
  return list.map((item) => ({ ...item, ad: byId.get(item.lbcId) ?? null }));
}

export async function deleteNegotiation(uid: string, id: string): Promise<boolean> {
  const { negotiations } = await collections();
  const result = await negotiations.deleteOne({ uid, id });
  return result.deletedCount > 0;
}
