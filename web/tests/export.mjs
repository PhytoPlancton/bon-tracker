/**
 * Export CSV d'une estimation : fichier lisible tel quel (séparateur, marque
 * d'ordre des octets, guillemets), une ligne par annonce avec ses
 * comparables, baisses, caractéristiques et description, statut de chacune,
 * synthèse par motorisation, cloisonnement.
 */
import { checker, collect, listing, market, startStack } from './lib.mjs';

const { check, state } = checker();
const stack = await startStack({ db: 'bon_tracker_export', port: 3456 });
const { call, raw, worker } = stack;

/** Lecture d'un CSV « ; » avec guillemets, comme le ferait un tableur. */
function parse(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ';') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  if (value || row.length) rows.push([...row, value]);
  const [header, ...body] = rows;
  return { header, records: body.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']))) };
}

try {
  const alice = await stack.login('alice');
  const bob = await stack.login('bob');

  const estimation = await call('POST', '/api/estimations', alice, { brand: 'Porsche', model: 'Boxster', yearMin: 2000, yearMax: 2004 });
  const detailed = listing(3_800_000_001, 'Boxster 3.2 S', 2002, 104_000, 22_900, {
    title: 'Porsche Boxster S; "Carnet complet"',
    publishedAt: '2026-09-01 10:00:00',
    sellerType: 'pro',
    body: 'Entretien Porsche Centre.\nPneus neufs ; disques changés.',
    attributes: {
      u_car_brand: 'PORSCHE',
      u_car_model: 'PORSCHE_Boxster',
      u_car_version: 'Boxster 3.2 S',
      regdate: '2002',
      mileage: '104000',
      horse_power_din: '260',
      vehicle_color: 'gris',
      vehicle_color_label: 'Gris',
    },
  });
  const rhd = listing(3_800_000_002, 'Boxster 3.2 S', 2002, 100_000, 9_000, { title: 'Porsche Boxster S RHD' });
  const wreck = listing(3_800_000_003, 'Boxster 2.7', 2001, 230_000, 1_500);
  await collect(stack, estimation.id, [...market(), detailed, rhd, wreck]);
  // Une baisse de prix sur l'annonce détaillée, vue au relevé suivant.
  await collect(stack, estimation.id, [...market(), { ...detailed, price: 21_900 }, rhd, wreck]);

  console.log('\nFichier des annonces');
  const response = await raw('GET', `/api/estimations/${estimation.id}/export?quoi=annonces`, alice);
  // Lu en octets : décodé, le texte perdrait sa marque d'ordre des octets.
  const bytes = Buffer.from(await response.arrayBuffer());
  check('servi en CSV', response.status === 200 && response.headers.get('content-type')?.startsWith('text/csv'), response.headers.get('content-type'));
  check('téléchargé sous un nom parlant', /attachment; filename="cote-porsche-boxster-2000-2004-annonces-\d{4}-\d{2}-\d{2}\.csv"/.test(response.headers.get('content-disposition') ?? ''), response.headers.get('content-disposition'));
  check('marque d’ordre des octets pour les tableurs', bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, [...bytes.subarray(0, 3)]);
  const { header, records } = parse(bytes.subarray(3).toString('utf8'));
  check('une ligne par annonce', records.length === market().length + 3, records.length);
  for (const column of ['id_annonce', 'lien', 'prix_eur', 'historique_prix', 'kilometrage_km', 'motorisation', 'jours_en_ligne', 'comparables_mediane_eur', 'ecart_vs_comparables_pct', 'statut', 'affaire', 'description']) {
    check(`colonne ${column}`, header.includes(column), header);
  }
  check('caractéristiques publiées en colonnes, libellé lisible', header.includes('lbc_horse_power_din') && header.includes('lbc_vehicle_color'), header.filter((name) => name.startsWith('lbc_')));
  check('pas de doublon des colonnes dédiées', !header.includes('lbc_mileage') && !header.includes('lbc_regdate'), header.filter((name) => name.startsWith('lbc_')));

  const row = records.find((record) => record.id_annonce === '3800000001');
  check('titre avec « ; » et guillemets restitué', row?.titre === 'Porsche Boxster S; "Carnet complet"', row?.titre);
  check('description sur une ligne', row?.description === 'Entretien Porsche Centre. Pneus neufs ; disques changés.', row?.description);
  check('baisse comptée et datée', row?.nb_baisses === '1' && row.prix_initial_eur === '22900' && row.prix_eur === '21900' && row.baisse_totale_eur === '1000', row);
  check('historique lisible', /22900 > \d{4}-\d{2}-\d{2} 21900$/.test(row?.historique_prix ?? ''), row?.historique_prix);
  check('mise en ligne d’après le site', row?.mise_en_ligne === '2026-09-01' && row.mise_en_ligne_source === 'leboncoin' && Number(row.jours_en_ligne) > 0, row);
  check('vendeur et localisation', row?.vendeur === 'professionnel' && row.code_postal === '14000' && row.departement === '14', row);
  check('caractéristiques jointes', row?.lbc_horse_power_din === '260' && row.lbc_vehicle_color === 'Gris', row);
  check('comparables et écart', Number(row?.comparables_nb) >= 4 && Number(row.comparables_mediane_eur) > 0 && row.comparables_criteres.includes('même motorisation'), row);
  check('km par an', Number(row?.km_par_an) > 0, row?.km_par_an);

  const deal = records.find((record) => record.id_annonce === '3300000001');
  // À −46 %, l'affaire est aussi un prix suspect : signalée comme telle,
  // mise à part des comparables, mais toujours désignée.
  check('l’affaire repérée, avec sa mise en garde', deal?.affaire === 'oui, prix suspect' && Number(deal.ecart_vs_comparables_pct) < -15 && deal.statut === 'à risque : Prix anormalement bas' && /Prix anormalement bas/.test(deal.signaux), deal);
  check('les plus sous le marché en tête', records[0].affaire.startsWith('oui'), records.slice(0, 3).map((record) => record.ecart_vs_comparables_pct));
  const risky = records.find((record) => record.id_annonce === '3800000002');
  check('volant à droite : exporté, signalé, jamais « affaire »', risky?.statut === 'à risque : Volant à droite' && risky.affaire === 'non', risky);
  const excluded = records.find((record) => record.id_annonce === '3800000003');
  check('prix aberrant : exporté avec sa raison', excluded?.statut.startsWith('écartée'), excluded?.statut);

  console.log('\nSynthèse');
  const summaryResponse = await raw('GET', `/api/estimations/${estimation.id}/export?quoi=synthese`, alice);
  const summary = parse(Buffer.from(await summaryResponse.arrayBuffer()).subarray(3).toString('utf8')).records;
  check('nom de fichier de synthèse', /-synthese-/.test(summaryResponse.headers.get('content-disposition') ?? ''), summaryResponse.headers.get('content-disposition'));
  const all = summary.find((record) => record.motorisation === 'Toutes');
  // Retenues : le marché, plus l'annonce détaillée, moins l'affaire au prix suspect.
  check('ligne d’ensemble, hors annonces écartées', all && Number(all.annonces_retenues) === market().length && all.annonces_a_risque === '2', all);
  const s32 = summary.find((record) => record.motorisation === 'Boxster 3.2 S' && record.boite === 'Toutes');
  const s27 = summary.find((record) => record.motorisation === 'Boxster 2.7' && record.boite === 'Toutes');
  check('une ligne par motorisation', s32 && s27, summary.map((record) => `${record.motorisation}/${record.boite}`));
  check('médianes ordonnées', Number(s32.prix_median_eur) > Number(s27.prix_median_eur) && Number(s32.prix_p25_eur) <= Number(s32.prix_median_eur) && Number(s32.prix_median_eur) <= Number(s32.prix_p75_eur), s32);
  // Modèle de prix du marché : −0,05 € par km, soit −500 € pour 10 000 km.
  check('décote par 10 000 km retrouvée', Math.abs(Number(s32.decote_pour_10000_km_eur) + 500) < 250, s32.decote_pour_10000_km_eur);
  check('part des vendeurs pro', Number(s32.part_vendeurs_pro_pct) > 0 && Number(s32.part_vendeurs_pro_pct) < 10, s32.part_vendeurs_pro_pct);

  console.log('\nCloisonnement');
  check('bob n’exporte pas l’estimation d’alice', (await raw('GET', `/api/estimations/${estimation.id}/export`, bob)).status === 404, null);
  check('anonyme refusé', (await raw('GET', `/api/estimations/${estimation.id}/export`, '')).status === 401, null);
  void worker;
} finally {
  await stack.stop();
  console.log(`\n${state.passed} vérifications réussies, ${state.failed} en échec\n`);
  process.exit(state.failed ? 1 : 0);
}
