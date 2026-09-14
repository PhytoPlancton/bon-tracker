# Leçons

Format : [date] | ce qui a mal tourné | règle pour l'éviter

- [2026-09-14] | Un `<span>` en `absolute` sans `left-0` dans le toggle : le
  curseur partait de sa position statique (centrée par le `text-align` du
  bouton) et restait à droite dans les deux états. | Un élément positionné en
  absolu doit toujours recevoir son ancrage explicite (`left`/`top`), jamais
  compter sur sa position statique.
- [2026-09-14] | `scripts/hash-password.mjs` importait `bcryptjs` alors que Next
  l'inline dans ses bundles serveur : le module est absent de `node_modules`
  dans l'image `standalone`, le script aurait échoué au premier usage. | Vérifier
  le contenu réel de `.next/standalone/node_modules` avant de promettre qu'un
  script utilitaire tourne dans l'image de production.
- [2026-09-14] | Accord fautif « 1 changements de prix » sur l'écran Réglages. |
  Passer tout compteur affiché par une fonction d'accord plutôt que de
  concaténer un `s`.
- [2026-09-14] | Le validateur de palette a signalé vert↔orange à ΔE 6.3 en
  vision deutan. | Une information portée par la couleur (hausse/baisse) doit
  toujours être doublée d'un signe : flèche + montant signé.

- [2026-09-15] | Une commande donnée dans la conversation a été collée dans le
  champ « E-mail » d'un script interactif, qui l'a acceptée telle quelle. | Ne
  jamais fournir de commande à copier pendant qu'un script attend une saisie ;
  et valider toute réponse dont le format est connu plutôt que de faire
  confiance à ce qui arrive.
- [2026-09-14] | Les commandes de déploiement étaient écrites en bash alors que
  la machine cible tourne sous Windows, et l'étape « récupérer le code sur la
  machine cible » manquait. | Écrire la documentation pour la machine où elle
  sera exécutée, pas pour celle où le code a été écrit.

- [2026-09-15] | Le hash bcrypt passé par `.env` arrivait amputé dans le
  container : Docker Compose interprète « $ » dans ce fichier, et prenait
  « $12$zikBy7QA1 » pour une variable à remplacer par du vide. La connexion
  échouait avec le bon mot de passe. | Aucune valeur contenant « $ » ne doit
  transiter par `.env` : les secrets passent par un fichier dédié référencé
  en `env_file`, que Compose transmet sans l'interpréter.
- [2026-09-15] | `const ENV_HEADER` déclaré après son utilisation au niveau
  racine du module : ReferenceError à l'exécution, que `node --check` ne voit
  pas. | Une constante utilisée par du code de premier niveau se déclare avant
  lui ; seules les fonctions remontent.

- [2026-09-15] | En déplaçant les secrets vers `secrets.env`, l'étape de
  configuration est devenue impossible à lancer : Compose exige que tout
  fichier `env_file` existe, et c'est précisément cette étape, exécutée par
  Compose, qui devait le créer. | Quand un script produit un fichier dont son
  propre lanceur dépend, créer ce fichier vide en amont.

## Règles permanentes du projet
- Un seul client MongoDB, `maxPoolSize` bas : le quota de 500 connexions est
  partagé entre plusieurs applications.
- Jamais de secret en clair : mot de passe hashé (bcrypt), session leboncoin
  chiffrée AES-256-GCM.
- Aucune identité personnelle dans le code, les commits ou les messages.
- Le front ne requête jamais Mongo directement : tout passe par l'API.
- Un prix ne s'interpole pas : le graphe est en marches d'escalier, une ligne
  droite entre deux relevés inventerait des valeurs qui n'ont pas existé.
