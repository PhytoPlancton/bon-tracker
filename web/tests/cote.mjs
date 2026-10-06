/**
 * Cote dans le temps, annonces parties et signaux, de bout en bout : photo
 * quotidienne de la cote, disparitions repérées sur un relevé complet
 * seulement, réapparition, signaux (prix, kilométrage, republication,
 * description) dans l'estimation, l'export et la fiche de négociation.
 */
import { checker, collect, listing, market, startStack } from './lib.mjs';

const { check, state } = checker();
const stack = await startStack({ db: 'bon_tracker_cote', port: 3462 });
const { call, raw, database } = stack;
const ads = database.collection('market_ads');

try {
  const alice = await stack.login('alice');
  const estimation = await call('POST', '/api/estimations', alice, { brand: 'Porsche', model: 'Boxster', yearMin: 2000, yearMax: 2004 });
  const base = market();
  await collect(stack, estimation.id, base);

  console.log('\nCote dans le temps');
  let view = await call('GET', `/api/estimations/${estimation.id}`, alice);
  check('photo prise au relevé', view.history?.length === 1 && view.history[0].median > 0 && view.history[0].count === base.length - 1, view.history); // l'affaire à −47 %, prix suspect, hors cote
  check('par motorisation', view.history[0].versions.some((item) => item.name === 'Boxster 3.2 S' && item.median > 0), view.history[0].versions);
  await collect(stack, estimation.id, base);
  view = await call('GET', `/api/estimations/${estimation.id}`, alice);
  check('une seule photo par jour', view.history.length === 1, view.history.length);
  const key = (await database.collection('market_queries').findOne({ id: estimation.id })).key;
  await database.collection('market_snapshots').insertOne({
    key,
    day: new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10),
    at: new Date(Date.now() - 35 * 86_400_000),
    count: 40,
    median: 15_000,
    p25: 12_000,
    p75: 19_000,
    versions: [],
  });
  view = await call('GET', `/api/estimations/${estimation.id}`, alice);
  check('historique trié, du plus ancien au plus récent', view.history.length === 2 && view.history[0].median === 15_000 && view.history[0].day < view.history[1].day, view.history.map((item) => item.day));

  console.log('\nAnnonces parties');
  const leaving = base.slice(0, 5).map((ad) => ad.lbcId);
  const staying = base.filter((ad) => !leaving.includes(ad.lbcId));
  await collect(stack, estimation.id, staying);
  const goneDocs = await ads.find({ goneAt: { $ne: null } }).toArray();
  check('absentes d’un relevé complet : parties', goneDocs.length === 5 && goneDocs.every((doc) => leaving.includes(doc.lbcId)), goneDocs.map((doc) => doc.lbcId));
  view = await call('GET', `/api/estimations/${estimation.id}`, alice);
  check('exposées avec leur durée en ligne', view.gone.length === 5 && view.gone.every((ad) => typeof ad.daysOnline === 'number' && ad.version), view.gone);
  check('plus parmi les annonces du marché', !view.ads.some((ad) => leaving.includes(ad.lbcId)), null);

  await collect(stack, estimation.id, staying.slice(0, 20));
  check('relevé nettement plus court : rien de plus déclaré parti', (await ads.countDocuments({ goneAt: { $ne: null } })) === 5, await ads.countDocuments({ goneAt: { $ne: null } }));
  await collect(stack, estimation.id, staying);
  await collect(stack, estimation.id, staying.slice(0, 10), { mode: 'fresh' });
  check('relevé des nouveautés : rien déclaré parti', (await ads.countDocuments({ goneAt: { $ne: null } })) === 5, null);

  const back = base.find((ad) => ad.lbcId === leaving[0]);
  await collect(stack, estimation.id, [...staying, back]);
  check('annonce revenue : plus partie', (await ads.findOne({ lbcId: back.lbcId })).goneAt === null, null);

  console.log('\nSignaux');
  // Partie hier : la même voiture revient sous un autre numéro, moins chère.
  const original = base.find((ad) => ad.lbcId === leaving[1]);
  const reposted = { ...original, lbcId: '3700000001', url: 'https://www.leboncoin.fr/ad/voitures/3700000001', price: original.price - 1_000 };
  const scam = listing(3_700_000_002, 'Boxster 3.2 S', 2002, 100_000, 8_000, { title: 'Porsche Boxster S urgent cause départ' });
  const lowKm = listing(3_700_000_003, 'Boxster 3.2 S', 2001, 30_000, 23_000);
  const described = listing(3_700_000_004, 'Boxster 3.2 S', 2003, 95_000, 22_500, {
    body: 'Carnet complet tamponné, CT OK. Embrayage à prévoir.',
  });
  const current = [...staying, back, reposted, scam, lowKm, described];
  await collect(stack, estimation.id, current);
  view = await call('GET', `/api/estimations/${estimation.id}`, alice);
  const labels = (id) => (view.signals?.[id] ?? []).map((signal) => signal.label);
  check('republiée repérée', labels('3700000001').includes('Republiée'), view.signals?.['3700000001']);
  check('détail de la republication chiffré', /1\s000 € plus cher/.test(view.signals['3700000001'].find((signal) => signal.label === 'Republiée').detail), view.signals['3700000001']);
  check('prix anormalement bas', labels('3700000002').includes('Prix anormalement bas'), view.signals?.['3700000002']);
  check('kilométrage trop faible pour l’âge', labels('3700000003').includes('Très peu de km'), view.signals?.['3700000003']);
  check('ce qui rassure dans la description', labels('3700000004').includes('Entretien suivi') && labels('3700000004').includes('CT vierge'), labels('3700000004'));
  check('ce qui inquiète dans la description', labels('3700000004').includes('Frais à prévoir'), labels('3700000004'));
  check('annonce ordinaire sans signal', !view.signals?.[staying[10].lbcId], view.signals?.[staying[10].lbcId]);
  check('descriptions gardées au serveur', !JSON.stringify(view.ads).includes('Carnet complet'), null);

  const csv = Buffer.from(await (await raw('GET', `/api/estimations/${estimation.id}/export`, alice)).arrayBuffer()).toString('utf8');
  check('signaux dans l’export', /Republiée : Une annonce identique/.test(csv) && /\+ Entretien suivi/.test(csv), null);

  const negotiation = await call('POST', '/api/negociations', alice, { annonce: '3700000001' });
  // Sa plage d'années n'a pas encore de cote : le relevé demandé est joué.
  if (negotiation.status !== 'ready') await collect(stack, stack.jobs.market.at(-1).queryId, current);
  const sheet = await call('GET', `/api/negociations/${negotiation.id}`, alice);
  check('signaux sur la fiche de négociation', sheet.signals?.some((signal) => signal.label === 'Republiée'), sheet.signals);
  check('la republication devient un argument', sheet.sheet?.arguments.some((argument) => argument.weight === 'strong' && /Une annonce identique/.test(argument.text)), sheet.sheet?.arguments);

  check('anonyme refusé', (await raw('GET', `/api/estimations/${estimation.id}`, '')).status === 401, null);
} finally {
  await stack.stop();
  console.log(`\n${state.passed} vérifications réussies, ${state.failed} en échec\n`);
  process.exit(state.failed ? 1 : 0);
}
