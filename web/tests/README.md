# Tests

Douze scénarios, exécutés contre un MongoDB éphémère et le serveur réellement
compilé — pas des simulacres.

```bash
npm run build      # les tests lancent .next/standalone
npm test
```

`lib.mjs` réunit ce qu'ils partagent : base éphémère, serveur compilé, faux
collecteur et faux service de notification (https, certificat de test
généré par `openssl`).

| Fichier | Ce qu'il garantit |
|---|---|
| `cloisonnement.mjs` | Aucune donnée ne passe d'un compte à un autre : annonces, historiques, recherches, relevés, accès directs par identifiant. |
| `migration.mjs` | Une installation d'avant le cloisonnement retrouve toutes ses données, et son mot de passe continue d'ouvrir l'application. |
| `reparation.mjs` | Des données attribuées au mauvais compte lors d'une migration antérieure reviennent au compte légitime, et le compte fautif disparaît. |
| `alertes.mjs` | Les veilles préviennent juste : affaires déjà en ligne listées sans sonner, nouvelle affaire et nouvelle baisse notifiées (vrai chiffrement Web Push vers un faux service https), pause respectée, un seul relevé par modèle quel que soit le nombre de comptes, relevé des nouveautés qui complète sans effacer, appareils disparus oubliés, clés chiffrées, cloisonnement. |
| `negociation.mjs` | La fiche de négociation tombe juste : prix juste d'après les comparables, trois prix ordonnés et ronds, durée en ligne et baisses retrouvées, marge selon le vendeur, message prêt à envoyer ; annonce connue aussitôt prête, inconnue lue puis comparée ; liens douteux refusés, cloisonnement. |
| `estimation.mjs` | La cote d'un modèle tombe juste sur un marché connu : collecte confiée au collecteur, motorisations, courbe prix / km, bonnes affaires, valeur d'une voiture donnée, silence faute de comparables, réutilisation d'une collecte récente par un autre compte, arrêt et envoi remplacé, cloisonnement. |
| `export.mjs` | L'export CSV d'une estimation se lit tel quel : séparateur « ; », marque d'ordre des octets, guillemets ; une ligne par annonce avec comparables, écart, baisses datées, durée en ligne, caractéristiques publiées et description ; annonces écartées ou à risque exportées avec leur raison ; synthèse par motorisation (médianes, quartiles, décote pour 10 000 km) ; cloisonnement. |
| `cote.mjs` | La cote se photographie à chaque relevé (une par jour) ; une annonce n'est déclarée partie qu'après un relevé complet — jamais sur un relevé partiel, nettement plus court ou de nouveautés — et redevient en ligne si elle revient ; signaux (republication chiffrée, prix anormalement bas, kilométrage trop faible, description) dans l'estimation, l'export et la fiche de négociation, descriptions gardées au serveur. |
| `vente.ts` | « Pour la vendre » : trois prix ronds et croissants tirés des comparables ; durées tirées des annonces parties, à défaut de celles encore en ligne (et dit) ; autre motorisation ignorée ; silence faute de comparables. Test unitaire, lancé par `tsx`. |
| `moteurs.ts` | Des voitures se comparent par moteur (carburant et puissance à 8 % près), pas par libellé de version : une 125i essence de 218 ch ne se compare ni aux 118d ni aux 123d diesel ; jamais de mélange, même faute de comparables. Test unitaire, lancé par `tsx`. |
| `connexion.mjs` | Une adresse sans compte est dite comme telle ; un mot de passe changé sur leboncoin est accepté après vérification auprès du site ; une adresse suivie d'une espace passe ; chaque visiteur a son propre compteur de tentatives. |
| `immo.mjs` | Bon Tracker Immo : bascule de mode, données auto et immo séparées, recherche de commune (référentiel en panne compris), prix au m², pièces, décote des passoires, affaires, valeur d'un bien donné, rendement face aux loyers, réutilisation, arrêt, cloisonnement. |

Sans accès au site de MongoDB, pointer `MONGOMS_SYSTEM_BINARY` vers un `mongod`
local (celui de l'image `mongo:7` convient).

Le collecteur a son propre test, `worker/tests/collecte.mjs` : le vrai code
pilote un vrai Chromium face à un faux leboncoin servi en HTTPS — pages de
résultats et pages d'annonce, relevé complet, relevé des nouveautés, arrêt,
lecture d'une annonce pour la négocier, immobilier.

Le faux site doit écouter sur le port 443, réservé à l'administrateur sur un
Mac : il se lance alors dans l'image Playwright, code monté tel quel.

```bash
cd worker && npx tsc
docker run --rm -v "$PWD":/w -w /w -e CHROMIUM=/ms-playwright/chromium-1243/chrome-linux-arm64/chrome mcr.microsoft.com/playwright:v1.63.0-noble node tests/collecte.mjs
```

À rejouer après toute modification du modèle de données ou des règles d'accès.
