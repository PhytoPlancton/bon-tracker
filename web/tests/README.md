# Tests

Six scénarios, exécutés contre un MongoDB éphémère et le serveur réellement
compilé — pas des simulacres.

```bash
npm run build      # les tests lancent .next/standalone
npm test
```

| Fichier | Ce qu'il garantit |
|---|---|
| `cloisonnement.mjs` | Aucune donnée ne passe d'un compte à un autre : annonces, historiques, recherches, relevés, accès directs par identifiant. |
| `migration.mjs` | Une installation d'avant le cloisonnement retrouve toutes ses données, et son mot de passe continue d'ouvrir l'application. |
| `reparation.mjs` | Des données attribuées au mauvais compte lors d'une migration antérieure reviennent au compte légitime, et le compte fautif disparaît. |
| `estimation.mjs` | La cote d'un modèle tombe juste sur un marché connu : collecte confiée au collecteur, motorisations, courbe prix / km, bonnes affaires, valeur d'une voiture donnée, silence faute de comparables, réutilisation d'une collecte récente par un autre compte, arrêt et envoi remplacé, cloisonnement. |
| `connexion.mjs` | Une adresse sans compte est dite comme telle ; un mot de passe changé sur leboncoin est accepté après vérification auprès du site ; une adresse suivie d'une espace passe ; chaque visiteur a son propre compteur de tentatives. |
| `immo.mjs` | Bon Tracker Immo : bascule de mode, données auto et immo séparées, recherche de commune (référentiel en panne compris), prix au m², pièces, décote des passoires, affaires, valeur d'un bien donné, rendement face aux loyers, réutilisation, arrêt, cloisonnement. |

Sans accès au site de MongoDB, pointer `MONGOMS_SYSTEM_BINARY` vers un `mongod`
local (celui de l'image `mongo:7` convient).

Le collecteur a son propre test, `worker/tests/collecte.mjs` : le vrai code
pilote un vrai Chromium face à un faux leboncoin servi en HTTPS.

À rejouer après toute modification du modèle de données ou des règles d'accès.
