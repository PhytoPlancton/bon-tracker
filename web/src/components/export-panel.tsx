'use client';

import { useState } from 'react';

/**
 * Export d'une estimation : les annonces et la synthèse en CSV, et une
 * consigne prête à coller dans un assistant avec le fichier. Sans elle,
 * l'assistant devine le sens des colonnes ; avec, il sait ce qui a été écarté
 * et pourquoi.
 */
export function ExportPanel({ id, label }: { id: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const prompt = [
    `Voici l'export des annonces leboncoin d'un modèle de voiture : ${label}. Une ligne par annonce, séparateur « ; ».`,
    '',
    'Colonnes utiles :',
    '- prix_eur, prix_initial_eur, nb_baisses, historique_prix : prix demandé et ses baisses ;',
    '- annee, kilometrage_km, km_par_an, motorisation, boite, carburant, vendeur, localisation ;',
    '- jours_en_ligne : depuis quand l’annonce est publiée ;',
    '- comparables_* et ecart_vs_comparables_pct : médiane des voitures les plus proches (même moteur, années et km voisins) et écart de cette annonce à cette médiane (négatif = moins chère) ;',
    '- statut : « retenue », « écartée » (prix hors de la fourchette du modèle) ou « à risque » (volant à droite, accident, panne) — ces dernières sont exclues des médianes ;',
    '- lbc_* : caractéristiques publiées telles quelles (puissance, finition, couleur…) ; description : texte du vendeur.',
    '',
    'Ce sont des prix demandés, pas des prix de vente. Aide-moi à :',
    '1. dire ce qui fait vraiment varier le prix (motorisation, km, année, boîte, options) ;',
    '2. repérer les 5 annonces les plus intéressantes à acheter, en lisant aussi les descriptions (entretien, défauts, options) ;',
    '3. dire à quel prix chacune pourrait se négocier, et avec quels arguments.',
  ].join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="mt-3 rounded-2xl border border-ink-line bg-ink-soft p-4">
      <h2 className="text-[15px] font-medium text-zinc-100">Exporter</h2>
      <p className="mb-3 text-[11px] text-zinc-500">
        Toutes les annonces relevées, avec leurs comparables, baisses, durée en ligne, caractéristiques et
        descriptions — pour ChatGPT ou un tableur.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <a
          href={`/api/estimations/${id}/export?quoi=annonces`}
          download
          className="rounded-xl bg-accent py-2.5 text-center text-[13px] font-semibold text-black"
        >
          Annonces (CSV)
        </a>
        <a
          href={`/api/estimations/${id}/export?quoi=synthese`}
          download
          className="rounded-xl border border-ink-line py-2.5 text-center text-[13px] text-zinc-200"
        >
          Synthèse (CSV)
        </a>
      </div>
      <button
        type="button"
        onClick={copy}
        className="mt-2 w-full rounded-xl border border-ink-line py-2.5 text-[13px] text-zinc-300"
      >
        {copied ? 'Consigne copiée ✓' : 'Copier la consigne pour ChatGPT'}
      </button>
      <p className="mt-2 text-[11px] text-zinc-600">
        Joins le fichier des annonces à ta conversation, puis colle la consigne.
      </p>
    </section>
  );
}
