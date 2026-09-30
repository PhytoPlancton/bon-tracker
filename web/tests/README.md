# Tests

Quatre scénarios, exécutés contre un MongoDB éphémère et le serveur réellement
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
| `estimation.mjs` | La cote d'un modèle tombe juste sur un marché connu : collecte confiée au collecteur, motorisations, courbe prix / km, bonnes affaires, valeur d'une voiture donnée, silence faute de comparables, réutilisation d'une collecte récente par un autre compte, cloisonnement. |

À rejouer après toute modification du modèle de données ou des règles d'accès.
