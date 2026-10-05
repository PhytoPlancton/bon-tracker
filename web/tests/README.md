# Tests

Six scénarios, exécutés contre un MongoDB éphémère et le serveur réellement
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
| `estimation.mjs` | La cote d'un modèle tombe juste sur un marché connu : collecte confiée au collecteur, motorisations, courbe prix / km, bonnes affaires, valeur d'une voiture donnée, silence faute de comparables, réutilisation d'une collecte récente par un autre compte, cloisonnement. |

À rejouer après toute modification du modèle de données ou des règles d'accès.
