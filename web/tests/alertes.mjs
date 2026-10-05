/**
 * Veilles et alertes, de bout en bout : abonnement aux notifications,
 * création d'une veille, planification des relevés, nouvelle affaire, nouvelle
 * baisse, pause, appareils disparus, mutualisation et cloisonnement.
 */
import { createECDH, randomBytes } from 'node:crypto';
import { checker, collect, listing, market, startStack } from './lib.mjs';

const { check, state } = checker();
const stack = await startStack({ db: 'bon_tracker_alertes', port: 3452 });
const { call, raw, worker, pushes, database } = stack;

/** Un abonnement comme en produit un navigateur : vraies clés, sinon le chiffrement échoue. */
function device(path) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `${stack.pushUrl}/${path}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

const ageQuery = (id, fields) => database.collection('market_queries').updateOne({ id }, { $set: fields });
const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000);

try {
  const alice = await stack.login('alice');
  const bob = await stack.login('bob');

  console.log('\nNotifications');
  const key = await call('GET', '/api/push', alice);
  check('clé publique fournie', typeof key.publicKey === 'string' && key.publicKey.length > 80, key);
  const again = await call('GET', '/api/push', alice);
  check('clé stable d’un appel à l’autre', again.publicKey === key.publicKey, null);
  const stored = await database.collection('secrets').findOne({ key: 'vapid' });
  check('clé privée chiffrée en base', stored && stored.ciphertext && !JSON.stringify(stored).includes('privateKey'), null);

  const badEndpoint = await raw('POST', '/api/push', alice, { endpoint: 'ftp://exemple/x', keys: device('x').keys });
  check('adresse d’envoi douteuse refusée', badEndpoint.status === 400, badEndpoint.status);
  const plainHttp = await raw('POST', '/api/push', alice, { ...device('x'), endpoint: 'http://exemple.org/x' });
  check('adresse non chiffrée refusée', plainHttp.status === 400, plainHttp.status);
  const subscribed = await raw('POST', '/api/push', alice, device('iphone-alice'));
  check('appareil abonné', subscribed.status === 200, subscribed.status);
  const subscription = await database.collection('push_subscriptions').findOne({ uid: 'uid-alice' });
  check('clés de l’appareil chiffrées', subscription && subscription.keys.ciphertext && !subscription.keys.p256dh, null);

  const test = await call('POST', '/api/push/test', alice);
  check('notification d’essai envoyée', test.sent === 1 && pushes.length === 1, { test, pushes: pushes.length });
  check('envoi signé et chiffré', /^vapid /i.test(pushes[0]?.headers.authorization ?? '') && pushes[0].headers['content-encoding'] === 'aes128gcm' && pushes[0].size > 0, pushes[0]?.headers);
  check('notification à durée limitée', Number(pushes[0]?.headers.ttl) > 0, pushes[0]?.headers.ttl);

  console.log('\nVeille sur un modèle');
  const estimation = await call('POST', '/api/estimations', alice, { brand: 'Porsche', model: 'Boxster', yearMin: 2000, yearMax: 2004 });
  await collect(stack, estimation.id, market());
  const before = pushes.length;
  const created = await call('POST', '/api/watches', alice, { queryId: estimation.id, version: 'Boxster 3.2 S', gearbox: null, kmMax: null, priceMax: null, threshold: 0.15 });
  check('veille créée', created.watch?.id && created.watch.label.startsWith('Boxster 3.2 S'), created);
  check('affaire déjà en ligne repérée', created.initial === 1, created.initial);
  check('…sans notification', pushes.length === before, pushes.length - before);
  const initialAlerts = await call('GET', '/api/alerts', alice);
  check('listée parmi les alertes', initialAlerts.alerts.length === 1 && initialAlerts.alerts[0].lbcId === '3300000001' && initialAlerts.alerts[0].initial === true, initialAlerts.alerts);
  check('déjà lue', initialAlerts.unread === 0, initialAlerts.unread);
  const wrongThreshold = await raw('POST', '/api/watches', alice, { queryId: estimation.id, threshold: 0.37 });
  check('seuil inconnu refusé', wrongThreshold.status === 400, wrongThreshold.status);

  console.log('\nPlanification');
  const fresh = await call('POST', '/api/internal/market/claim', worker);
  check('modèle tout juste relevé : rien à faire', fresh.jobs.length === 0, fresh.jobs);
  await ageQuery(estimation.id, { freshAt: hoursAgo(3), collectedAt: hoursAgo(3) });
  const due = await call('POST', '/api/internal/market/claim', worker);
  check('relevé des nouveautés dû', due.jobs.length === 1 && due.jobs[0].queryId === estimation.id && due.jobs[0].mode === 'fresh', due.jobs);
  check('codes du site transmis', due.jobs[0]?.codes?.model === 'PORSCHE_Boxster', due.jobs[0]);
  const twice = await call('POST', '/api/internal/market/claim', worker);
  check('réservé : pas repris au passage suivant', twice.jobs.length === 0, twice.jobs);

  console.log('\nNouvelle affaire');
  const total = (await call('GET', `/api/estimations/${estimation.id}`, alice)).ads.length;
  const newcomer = listing(3_400_000_001, 'Boxster 3.2 S', 2002, 100_000, 14_000);
  const ordinary = listing(3_400_000_002, 'Boxster 3.2 S', 2003, 90_000, 23_500);
  await collect(stack, estimation.id, [newcomer, ordinary], { mode: 'fresh' });
  const merged = await call('GET', `/api/estimations/${estimation.id}`, alice);
  check('nouveautés ajoutées sans rien effacer', merged.ads.length === total + 2, { avant: total, après: merged.ads.length });
  const query = await database.collection('market_queries').findOne({ id: estimation.id });
  check('relevé complet inchangé, nouveautés datées', query.collectedAt < hoursAgo(2) && query.freshAt > hoursAgo(0.1), { collectedAt: query.collectedAt, freshAt: query.freshAt });
  const afterNew = await call('GET', '/api/alerts', alice);
  const alert = afterNew.alerts.find((item) => item.lbcId === '3400000001');
  check('alerte créée', alert && !alert.initial && alert.ratio > 0.3, alert);
  check('annonce ordinaire ignorée', !afterNew.alerts.some((item) => item.lbcId === '3400000002'), null);
  check('notification envoyée', pushes.length === before + 1, pushes.length - before);
  const unread = await call('GET', '/api/alerts?compter=1', alice);
  check('compteur de non-lues', unread.unread === 1 && !unread.alerts, unread);

  console.log('\nNouvelle baisse');
  await collect(stack, estimation.id, [{ ...newcomer, price: 13_000 }], { mode: 'fresh' });
  const dropped = (await call('GET', '/api/alerts', alice)).alerts.find((item) => item.lbcId === '3400000001');
  check('alerte mise à jour au nouveau prix', dropped.price === 13_000 && dropped.id === alert.id, dropped);
  check('re-notifiée', pushes.length === before + 2, pushes.length - before);
  const history = await database.collection('market_ads').findOne({ lbcId: '3400000001' });
  check('historique des prix tenu', history.priceHistory.map((step) => step.price).join('>') === '14000>13000', history.priceHistory);
  await collect(stack, estimation.id, [{ ...newcomer, price: 13_000 }], { mode: 'fresh' });
  check('même prix : pas de nouvelle notification', pushes.length === before + 2, pushes.length - before);

  await call('POST', '/api/alerts/read', alice);
  check('alertes marquées lues', (await call('GET', '/api/alerts?compter=1', alice)).unread === 0, null);

  console.log('\nPause');
  await call('PATCH', `/api/watches/${created.watch.id}`, alice, { active: false });
  await collect(stack, estimation.id, [listing(3_400_000_003, 'Boxster 3.2 S', 2001, 110_000, 12_500)], { mode: 'fresh' });
  check('veille en pause : ni alerte ni notification', pushes.length === before + 2 && !(await call('GET', '/api/alerts', alice)).alerts.some((item) => item.lbcId === '3400000003'), null);
  await ageQuery(estimation.id, { freshAt: hoursAgo(3), collectedAt: hoursAgo(3) });
  check('modèle sans veille active : plus relevé', (await call('POST', '/api/internal/market/claim', worker)).jobs.length === 0, null);
  await call('PATCH', `/api/watches/${created.watch.id}`, alice, { active: true });

  console.log('\nMutualisation');
  const bobEstimation = await call('POST', '/api/estimations', bob, { brand: 'Porsche', model: 'Boxster', yearMin: 2000, yearMax: 2004 });
  check('estimation de bob reprise de celle d’alice', bobEstimation.reused === true, bobEstimation);
  const bobWatch = await call('POST', '/api/watches', bob, { queryId: bobEstimation.id, version: null, gearbox: null, kmMax: 150_000, priceMax: 20_000, threshold: 0.1 });
  check('veille de bob créée', Boolean(bobWatch.watch?.id), bobWatch);
  await ageQuery(estimation.id, { freshAt: hoursAgo(30), collectedAt: hoursAgo(30) });
  await ageQuery(bobEstimation.id, { freshAt: hoursAgo(30), collectedAt: hoursAgo(30) });
  const shared = await call('POST', '/api/internal/market/claim', worker);
  check('un seul relevé pour deux comptes', shared.jobs.length === 1, shared.jobs);
  check('relevé complet après une journée', shared.jobs[0]?.mode === 'full', shared.jobs[0]);
  await collect(stack, shared.jobs[0].queryId, [...market(), listing(3_400_000_004, 'Boxster 3.2 S', 2002, 105_000, 13_500)]);
  const other = shared.jobs[0].queryId === estimation.id ? bobEstimation.id : estimation.id;
  const otherQuery = await database.collection('market_queries').findOne({ id: other });
  check('l’autre estimation profite du relevé', otherQuery.collectedAt > hoursAgo(0.1) && otherQuery.adIds.includes('3400000004'), { collectedAt: otherQuery.collectedAt });
  check('relevé complet : annonces disparues retirées', !otherQuery.adIds.includes('3400000002'), null);
  const bobAlerts = await call('GET', '/api/alerts', bob);
  check('bob alerté selon ses propres critères', bobAlerts.alerts.some((item) => item.lbcId === '3400000004') && bobAlerts.alerts.every((item) => item.price <= 20_000), bobAlerts.alerts.map((item) => item.price));

  console.log('\nCloisonnement');
  const bobView = await call('GET', '/api/watches', bob);
  check('bob ne voit que sa veille', bobView.watches.length === 1 && bobView.watches[0].id === bobWatch.watch.id, bobView.watches.length);
  check('bob ne voit pas les alertes d’alice', !bobAlerts.alerts.some((item) => item.watchId === created.watch.id), null);
  check('bob ne met pas en pause la veille d’alice', (await raw('PATCH', `/api/watches/${created.watch.id}`, bob, { active: false })).status === 404, null);
  check('bob ne supprime pas la veille d’alice', (await raw('DELETE', `/api/watches/${created.watch.id}`, bob)).status === 404, null);
  check('bob ne surveille pas l’estimation d’alice', (await raw('POST', '/api/watches', bob, { queryId: estimation.id, threshold: 0.15 })).status === 404, null);
  check('route de planification réservée au collecteur', (await raw('POST', '/api/internal/market/claim', { 'content-type': 'application/json' })).status === 403, null);
  check('anonyme refusé', (await raw('GET', '/api/alerts', '')).status === 401, null);

  console.log('\nAppareil disparu');
  await raw('POST', '/api/push', bob, device('iphone-bob-disparu'));
  const gone = await call('POST', '/api/push/test', bob);
  const left = await database.collection('push_subscriptions').countDocuments({ uid: 'uid-bob' });
  check('appareil disparu oublié', gone.sent === 0 && gone.failed === 1 && left === 0, { gone, left });

  console.log('\nSuppression');
  check('veille supprimée', (await raw('DELETE', `/api/watches/${created.watch.id}`, alice)).status === 200, null);
  check('ses alertes avec', (await call('GET', '/api/alerts', alice)).alerts.length === 0, null);
} finally {
  await stack.stop();
  console.log(`\n${state.passed} vérifications réussies, ${state.failed} en échec\n`);
  process.exit(state.failed ? 1 : 0);
}
