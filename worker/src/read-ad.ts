import { reportAd } from './api.js';
import { connectToChrome, mainContext } from './browser.js';
import { LBC_ORIGIN } from './config.js';
import { collectListings } from './scrape.js';

/**
 * Lit une annonce isolée, pour la négocier. La page d'une annonce embarque sa
 * description complète — prix, caractéristiques, date de mise en ligne — au
 * milieu d'annonces « similaires » : seule celle demandée est retenue.
 */
export async function readAdJob(
  spec: { negotiationId: string; lbcId: string },
  log: (message: string) => void,
): Promise<void> {
  log(`[négociation] lecture de l'annonce ${spec.lbcId}`);
  let browser: Awaited<ReturnType<typeof connectToChrome>> | null = null;
  try {
    browser = await connectToChrome();
    const page = await mainContext(browser).newPage();
    try {
      // L'adresse est reconstruite à partir du seul numéro : on ne visite
      // jamais un lien fourni tel quel.
      const found = await collectListings(page, `${LBC_ORIGIN}/ad/voitures/${spec.lbcId}`);
      const ad = found.find((item) => item.lbcId === spec.lbcId) ?? null;
      if (!ad || ad.price === null) {
        await reportAd(spec.negotiationId, null, 'Annonce introuvable ou sans prix : elle a peut-être été retirée.');
        log(`[négociation] ${spec.lbcId} introuvable`);
        return;
      }
      await reportAd(spec.negotiationId, ad, null);
      log(`[négociation] ${spec.lbcId} lue : ${ad.title}`);
    } finally {
      await page.close().catch(() => undefined);
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    log(`[négociation] échec — ${message}`);
    await reportAd(spec.negotiationId, null, message.slice(0, 500)).catch(() => undefined);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
