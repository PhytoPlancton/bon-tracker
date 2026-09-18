#!/usr/bin/env node
/**
 * Montre les annonces telles qu'elles sont enregistrées.
 *
 * Quand des chiffres paraissent faux, il vaut mieux regarder ce qui a été
 * collecté que supposer d'où vient l'erreur. Affiche les extrêmes de chaque
 * segment, ce qui permet de distinguer une vraie annonce d'une valeur lue de
 * travers.
 *
 *   docker compose run --rm web node scripts/inspecter.mjs
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI manquant.');
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bon_tracker');
const listings = db.collection('listings');

const total = await listings.countDocuments({ isActive: true });
const untitled = await listings.countDocuments({
  isActive: true,
  title: { $regex: /^Annonce \d+$/ },
});
const noLocation = await listings.countDocuments({ isActive: true, location: null });
const withAttributes = await listings.countDocuments({
  isActive: true,
  attributes: { $exists: true, $ne: {} },
});

console.log('\n─────────────────────────────────────────');
console.log('  Ce qui est enregistré');
console.log('─────────────────────────────────────────\n');
console.log(`  annonces en ligne        ${total}`);
console.log(`  sans titre (numérotées)  ${untitled}`);
console.log(`  sans lieu                ${noLocation}`);
console.log(`  avec caractéristiques    ${withAttributes}`);

console.log('\n─────────────────────────────────────────');
console.log('  Les dix prix les plus élevés');
console.log('─────────────────────────────────────────\n');
await show(await listings.find({ isActive: true }).sort({ currentPrice: -1 }).limit(10).toArray());

console.log('\n─────────────────────────────────────────');
console.log('  Les cinq prix les plus bas');
console.log('─────────────────────────────────────────\n');
await show(
  await listings
    .find({ isActive: true, currentPrice: { $ne: null } })
    .sort({ currentPrice: 1 })
    .limit(5)
    .toArray(),
);

// Les caractéristiques disent si une sous-segmentation est envisageable.
const sample = await listings.findOne({ attributes: { $exists: true, $ne: {} } });
if (sample) {
  console.log('\n─────────────────────────────────────────');
  console.log('  Caractéristiques d’une annonce');
  console.log('─────────────────────────────────────────\n');
  for (const [key, value] of Object.entries(sample.attributes)) {
    console.log(`  ${key.padEnd(22)} ${value}`);
  }
}

await client.close();

async function show(rows) {
  for (const row of rows) {
    const price = row.currentPrice === null ? 'sans prix' : `${row.currentPrice} €`;
    console.log(`  ${price.padStart(12)}  ${String(row.title).slice(0, 52)}`);
    console.log(`                ${row.url}`);
    console.log(`                sources : ${(row.sources ?? []).join(', ') || 'aucune'}`);
  }
  if (!rows.length) console.log('  aucune');
}
