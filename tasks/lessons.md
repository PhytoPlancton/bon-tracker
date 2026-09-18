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

- [2026-09-15] | Le hash bcrypt arrivait amputé dans le container : Docker
  Compose interprète « $ » et prenait « $12$zikBy7QA1 » pour une variable à
  remplacer par du vide. Déplacer les secrets vers un fichier `env_file` n'y a
  rien changé — Compose interprète aussi ce fichier, ce que l'avertissement
  persistant a fini par prouver. | Aucune valeur contenant « $ » ne doit
  transiter par un fichier d'environnement lu par Compose, quel qu'il soit :
  les secrets concernés sont encodés en base64, qui n'emploie aucun caractère
  interprété, et décodés à la lecture.
- [2026-09-15] | Deux correctifs successifs posés sur la même cause sans
  vérifier que le premier avait produit l'effet attendu : l'avertissement
  « variable is not set » était resté visible entre les deux, et disait déjà
  que le problème subsistait. | Lire les avertissements qui persistent après
  un correctif : ils décrivent l'état réel, pas l'état espéré.
- [2026-09-15] | `const ENV_HEADER` déclaré après son utilisation au niveau
  racine du module : ReferenceError à l'exécution, que `node --check` ne voit
  pas. | Une constante utilisée par du code de premier niveau se déclare avant
  lui ; seules les fonctions remontent.

- [2026-09-15] | En déplaçant les secrets vers `secrets.env`, l'étape de
  configuration est devenue impossible à lancer : Compose exige que tout
  fichier `env_file` existe, et c'est précisément cette étape, exécutée par
  Compose, qui devait le créer. | Quand un script produit un fichier dont son
  propre lanceur dépend, créer ce fichier vide en amont.

- [2026-09-15] | Le collecteur lançait un relevé à chaque démarrage de
  container. Une dizaine de recréations pendant une mise au point ont fait
  marquer l'adresse IP du domicile comme robot par le site, bloquant du même
  coup le navigateur personnel. | Ne jamais déclencher d'accès à un service
  tiers au démarrage d'un container : la mise au point en recrée beaucoup. Une
  action visible de l'extérieur se déclenche sur planification ou à la demande.

- [2026-09-16] | Trois jours passés à vouloir faire naviguer un Chromium piloté
  par Playwright sur un site protégé par DataDome : blocages en série, y compris
  du navigateur personnel de la maison. La capture d'écran ajoutée au collecteur
  a montré une vraie page de vérification, écartant enfin l'hypothèse d'un faux
  positif. | Contre une protection anti-robot sérieuse, ne pas chercher à
  déguiser un navigateur automatisé : piloter un vrai navigateur déjà installé,
  avec sa vraie empreinte et sa vraie session. Et instrumenter tôt (capture
  d'écran) plutôt que de deviner ce que voit un navigateur qu'on n'observe pas.

- [2026-09-16] | Deux corrections successives du nom des recherches, fondées
  sur des suppositions de structure : le nom venait du lien, puis du titre de
  la page. Les cartes ne contiennent aucun titre de section, ce qu'une seule
  inspection aurait révélé d'emblée. | Avant d'écrire un sélecteur, faire
  afficher la structure réelle de la page ; une ligne dans la console d'un
  navigateur connecté coûte moins qu'un aller-retour de correction.

- [2026-09-17] | Le bouton ↻ du tableau de bord rechargeait l'affichage, ce
  que l'utilisateur prenait pour une collecte : rien dans l'app ne permettait
  de déclencher un relevé, il fallait la ligne de commande. | Une action qui
  ne fait pas ce que son icône laisse croire doit être nommée ; et toute
  opération qu'on se surprend à lancer en ligne de commande plusieurs fois a
  sa place dans l'interface.

- [2026-09-18] | La connexion au site échouait depuis deux jours ; le test a
  montré que l'adresse employée, /connexion, renvoyait simplement une 404. Le
  formulaire vit sur un autre domaine, derrière un flux OAuth aux paramètres
  renouvelés. | Avant de conclure qu'une protection bloque, vérifier que la
  page visée existe. Et pour atteindre un formulaire, suivre la redirection
  que le site propose plutôt que d'écrire son adresse en dur.

## Règles permanentes du projet
- Un seul client MongoDB, `maxPoolSize` bas : le quota de 500 connexions est
  partagé entre plusieurs applications.
- Jamais de secret en clair : mot de passe hashé (bcrypt), session leboncoin
  chiffrée AES-256-GCM.
- Aucune identité personnelle dans le code, les commits ou les messages.
- Le front ne requête jamais Mongo directement : tout passe par l'API.
- Un prix ne s'interpole pas : le graphe est en marches d'escalier, une ligne
  droite entre deux relevés inventerait des valeurs qui n'ont pas existé.
