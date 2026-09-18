# Tests

Deux scénarios, exécutés contre un MongoDB éphémère et le serveur réellement
compilé — pas des simulacres.

```bash
npm run build      # les tests lancent .next/standalone
npm test
```

| Fichier | Ce qu'il garantit |
|---|---|
| `cloisonnement.mjs` | Aucune donnée ne passe d'un compte à un autre : annonces, historiques, recherches, relevés, accès directs par identifiant. |
| `migration.mjs` | Une installation d'avant le cloisonnement retrouve toutes ses données, et son mot de passe continue d'ouvrir l'application. |

À rejouer après toute modification du modèle de données ou des règles d'accès.
