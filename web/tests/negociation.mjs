/**
 * Négociation, de bout en bout : annonce déjà connue, annonce inconnue lue
 * par le collecteur, fiche (prix juste, trois prix, arguments, message),
 * erreurs et cloisonnement.
 */
import { checker, collect, listing, market, startStack } from './lib.mjs';

const { check, state } = checker();
const stack = await startStack({ db: 'bon_tracker_negociation', port: 3454 });
const { call, raw, worker, jobs, database } = stack;
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000);

try {
  const alice = await stack.login('alice');
  const bob = await stack.login('bob');

  // Le marché du modèle, et l'annonce à négocier : une 3.2 S de 2002 à
  // 100 000 km affichée 25 900 €, en ligne depuis 45 jours, déjà baissée.
  const estimation = await call('POST', '/api/estimations', alice, { brand: 'Porsche', model: 'Boxster', yearMin: 2000, yearMax: 2004 });
  const target = listing(3_500_000_001, 'Boxster 3.2 S TipTronic S', 2002, 100_000, 26_900, {
    publishedAt: daysAgo(45).toISOString().slice(0, 19).replace('T', ' '),
  });
  await collect(stack, estimation.id, market());
  await call('POST', '/api/internal/market/ads', worker, { queryId: null, ads: [target] });
  await call('POST', '/api/internal/market/ads', worker, { queryId: null, ads: [{ ...target, price: 25_900 }] });

  console.log('\nLiens');
  check('lien étranger refusé', (await raw('POST', '/api/negociations', alice, { annonce: 'https://exemple.org/ad/voitures/3500000001' })).status === 400, null);
  check('texte quelconque refusé', (await raw('POST', '/api/negociations', alice, { annonce: 'une belle voiture' })).status === 400, null);

  console.log('\nAnnonce connue');
  const marketJobs = jobs.market.length;
  const started = await call('POST', '/api/negociations', alice, { annonce: 'https://www.leboncoin.fr/ad/voitures/3500000001' });
  check('négociation créée', Boolean(started.id), started);
  check('pas de lecture d’annonce nécessaire', jobs.ad.length === 0, jobs.ad);
  // 2002 → 2000–2004 : la cote de ce modèle vient d'être relevée, elle est reprise.
  check('cote récente du modèle reprise, sans nouveau relevé', started.status === 'ready' && jobs.market.length === marketJobs, { started, jobs: jobs.market.length - marketJobs });
  const view = await call('GET', `/api/negociations/${started.id}`, alice);
  const { sheet, ad } = view;
  check('fiche prête', view.negotiation.status === 'ready' && sheet, view.negotiation);
  check('annonce harmonisée : moteur et boîte séparés', ad.version === 'Boxster 3.2 S' && ad.gearbox === 'Automatique', { version: ad.version, gearbox: ad.gearbox });
  // Modèle de prix du marché : 26 000 − 100 000 × 0,05 + 2 × 800 = 22 600.
  check('prix juste proche du modèle', sheet.fair && Math.abs(sheet.fair.median - 22_600) < 1_200, sheet.fair?.median);
  check('jugée au-dessus du marché', sheet.verdict === 'above' && sheet.position > 0.05, { verdict: sheet.verdict, position: sheet.position });
  check('trois prix ordonnés', sheet.opening <= sheet.target && sheet.target <= sheet.ceiling && sheet.ceiling <= ad.price, [sheet.opening, sheet.target, sheet.ceiling, ad.price]);
  check('plafond au prix du marché', Math.abs(sheet.ceiling - sheet.fair.median) <= 100, [sheet.ceiling, sheet.fair.median]);
  check('prix ronds', [sheet.opening, sheet.target, sheet.ceiling].every((price) => price % 100 === 0), [sheet.opening, sheet.target, sheet.ceiling]);
  check('durée en ligne lue', sheet.daysOnline >= 44 && sheet.daysOnline <= 46, sheet.daysOnline);
  check('baisse retrouvée', sheet.drops.length === 1 && sheet.drops[0].from === 26_900 && sheet.drops[0].to === 25_900, sheet.drops);
  check('marge élargie par la durée et la baisse', Math.abs(sheet.room - (0.06 + 0.025 + 0.01)) < 1e-9, sheet.room);
  const texts = sheet.arguments.map((argument) => argument.text).join(' | ');
  check('argument des comparables', /voitures comparables .* médiane/.test(texts), texts);
  check('argument de la durée', /En ligne depuis 4[456] jours/.test(texts), texts);
  check('argument de la baisse', /Déjà baissée de 1\s000 €/.test(texts), texts);
  check('comparables moins chères, au plus trois', sheet.cheaper.length > 0 && sheet.cheaper.length <= 3 && sheet.cheaper.every((other) => other.price < ad.price), sheet.cheaper.map((other) => other.price));
  check('affaire bradée jamais citée au vendeur', !sheet.cheaper.some((other) => other.lbcId === '3300000001') && sheet.cheaper.every((other) => other.price >= sheet.fair.p25 * 0.95), sheet.cheaper.map((other) => other.price));
  check('message avec l’offre d’ouverture', sheet.message.includes(`${sheet.opening.toLocaleString('fr-FR')} €`) && sheet.message.startsWith('Bonjour'), sheet.message);
  check('aucun nom dans le message', !/nicolas|monniot/i.test(sheet.message), null);
  check('nuage du marché fourni pour le graphique', view.pool.length >= 40 && !view.pool.some((other) => other.lbcId === '3500000001'), view.pool.length);

  const resumed = await call('POST', '/api/negociations', alice, { annonce: '3500000001' });
  check('même annonce : même fiche reprise', resumed.id === started.id, resumed);

  console.log('\nAnnonce déjà sous le marché');
  const bargain = listing(3_500_000_002, 'Boxster 3.2 S', 2002, 100_000, 18_000);
  await call('POST', '/api/internal/market/ads', worker, { queryId: null, ads: [bargain] });
  const cheap = await call('POST', '/api/negociations', alice, { annonce: '3500000002' });
  const cheapView = await call('GET', `/api/negociations/${cheap.id}`, alice);
  check('cote reprise, fiche aussitôt prête', cheap.status === 'ready' && cheapView.sheet, cheap);
  check('jugée sous le marché', cheapView.sheet.verdict === 'below', cheapView.sheet.verdict);
  check('plafond au prix demandé', cheapView.sheet.ceiling === 18_000, cheapView.sheet.ceiling);
  check('négociation douce', cheapView.sheet.target >= 18_000 * 0.95, cheapView.sheet.target);
  check('seules les vraiment moins chères sont citées', cheapView.sheet.cheaper.every((other) => other.price < 18_000), cheapView.sheet.cheaper.map((other) => other.price));

  console.log('\nAnnonce inconnue');
  const unknown = await call('POST', '/api/negociations', alice, { annonce: 'https://www.leboncoin.fr/ad/voitures/3600000001.htm' });
  check('lecture confiée au collecteur', unknown.status === 'reading' && jobs.ad.at(-1)?.lbcId === '3600000001', { unknown, job: jobs.ad.at(-1) });
  check('seul le numéro est transmis', !('url' in (jobs.ad.at(-1) ?? {})) || jobs.ad.at(-1).url.endsWith('/3600000001'), jobs.ad.at(-1));
  const forbidden = await raw('POST', `/api/internal/negotiations/${unknown.id}`, { 'content-type': 'application/json' }, { ad: null });
  check('route interne fermée sans jeton', forbidden.status === 403, forbidden.status);
  await call('POST', `/api/internal/negotiations/${unknown.id}`, worker, {
    ad: listing(3_600_000_001, 'Boxster 3.2 S', 2003, 80_000, 24_500, { sellerType: 'pro' }),
  });
  // 2003 → 2001–2005 : une autre plage d'années, dont la cote reste à relever.
  const reading = await call('GET', `/api/negociations/${unknown.id}`, alice);
  const job = jobs.market.at(-1);
  check('annonce lue, cote de son modèle demandée', reading.negotiation.status === 'collecting' && job.yearMin === 2001 && job.yearMax === 2005, { status: reading.negotiation.status, job });
  check('avec les codes lus sur l’annonce, sans recherche libre', job?.codes?.model === 'PORSCHE_Boxster', job);
  check('fiche en attente de la cote', reading.sheet === null && reading.query?.id === job.queryId, reading.query);
  await collect(stack, job.queryId, market());
  const read = await call('GET', `/api/negociations/${unknown.id}`, alice);
  check('cote relevée, fiche prête', read.negotiation.status === 'ready' && read.sheet?.fair, read.negotiation);
  check('vendeur pro : marge plus serrée', read.sheet.room < 0.05 && read.sheet.arguments.some((argument) => /professionnel/.test(argument.text)), read.sheet.room);

  console.log('\nÉchecs');
  const notCar = await call('POST', '/api/negociations', alice, { annonce: '3700000001' });
  await call('POST', `/api/internal/negotiations/${notCar.id}`, worker, {
    ad: { lbcId: '3700000001', title: 'Canapé trois places', url: 'https://www.leboncoin.fr/ad/ameublement/3700000001', price: 150 },
  });
  const notCarView = await call('GET', `/api/negociations/${notCar.id}`, alice);
  check('pas une voiture : échec expliqué', notCarView.negotiation.status === 'error' && /voiture/.test(notCarView.negotiation.error), notCarView.negotiation);
  const removed = await call('POST', '/api/negociations', alice, { annonce: '3700000002' });
  await call('POST', `/api/internal/negotiations/${removed.id}`, worker, { ad: null, error: 'Annonce introuvable ou sans prix : elle a peut-être été retirée.' });
  check('annonce retirée : échec expliqué', (await call('GET', `/api/negociations/${removed.id}`, alice)).negotiation.error.includes('retirée'), null);

  console.log('\nCloisonnement');
  check('bob ne lit pas la négociation d’alice', (await raw('GET', `/api/negociations/${started.id}`, bob)).status === 404, null);
  check('bob ne la supprime pas', (await raw('DELETE', `/api/negociations/${started.id}`, bob)).status === 404, null);
  check('liste de bob vide', (await call('GET', '/api/negociations', bob)).negotiations.length === 0, null);
  const list = await call('GET', '/api/negociations', alice);
  check('liste d’alice complète, titres joints', list.negotiations.length === 5 && list.negotiations.some((item) => item.ad?.title?.includes('Boxster')), list.negotiations.length);
  check('suppression', (await raw('DELETE', `/api/negociations/${started.id}`, alice)).status === 200, null);
  check('anonyme refusé', (await raw('GET', '/api/negociations', '')).status === 401, null);
  const stored = await database.collection('negotiations').countDocuments({ uid: 'uid-alice' });
  check('base cohérente', stored === 4, stored);
} finally {
  await stack.stop();
  console.log(`\n${state.passed} vérifications réussies, ${state.failed} en échec\n`);
  process.exit(state.failed ? 1 : 0);
}
