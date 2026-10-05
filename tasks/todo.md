# bon-tracker — Plan

## Objectif
Tracker l'historique de prix des annonces leboncoin suivies (favoris + recherches
sauvegardées choisies). Un point sur le graphe par modification de prix.

## Décisions actées (2026-09-14)
- Hébergement : PC gaming sous Docker Desktop (choix revu en cours de session,
  initialement EDJ Labs) — l'IP résidentielle passe bien mieux l'anti-bot
- Accès distant : Cloudflare Tunnel vers bontracker.nmt.ovh (HTTPS obligatoire
  pour que l'installation PWA iOS fonctionne)
- Base : MongoDB local en container, volume Docker (ne consomme pas le quota Atlas)
- Périmètre : page Favoris (toujours) + recherches sauvegardées activées à la demande
- Pas d'alertes en V1 (tableau de bord seul)
- Auth maison (bcrypt + JWT cookie), pas de Clerk
- Relevé au démarrage + toutes les 6 h
- 2 images applicatives : `web` (Next) et `worker` (Playwright)
- Le worker n'accède jamais à Mongo : il passe par l'API interne (jeton)

## Architecture
```
worker (Playwright+cron) --x-worker-token--> web (/api/internal/*) --> MongoDB
                                             web (/api/*) <-- front (cookie session)
cloudflared --> web:3000
```

## Modèle de données
- `users`        : { email, passwordHash, createdAt }
- `secrets`      : { key:'lbc_session', ciphertext, iv, tag, updatedAt } (AES-256-GCM)
- `listings`     : { lbcId, title, url, imageUrl, category, sellerType, location,
                     currentPrice, firstSeenAt, lastSeenAt, isActive, sources[] }
- `price_points` : { lbcId, price, observedAt } — écrit seulement si le prix change
- `searches`     : { lbcSearchId, name, url, category, tracked, lastRunAt, itemCount }
- `runs`         : { startedAt, finishedAt, status, stats, error }

## Étapes
- [x] 1. Scaffold repo (web/ + worker/ + tasks/)
- [x] 2. web : lib (mongo singleton pool=5, crypto AES-GCM, auth bcrypt+jose)
- [x] 3. web : API interne worker (session, ingest, searches, runs)
- [x] 4. web : API front (listings, détail, searches, status, session de secours)
- [x] 5. web : UI mobile-first (login, tableau de bord, détail + graphe, recherches, réglages)
- [x] 5b. PWA installable iOS : manifest, icônes générées, meta standalone,
       safe-area insets, bottom nav, service worker
- [x] 6. worker : Playwright login + session storageState chiffrée côté web
- [x] 7. worker : scrape favoris + recherches (interception réseau + repli DOM)
- [x] 8. worker : cron + relevé au démarrage + remontée d'état
- [x] 9. Dockerfiles + compose (mongo, web, worker, cloudflared) + workflow GHCR optionnel
- [x] 10. Doc de déploiement Docker Desktop + Cloudflare Tunnel
- [x] 11. Test d'intégration bout en bout (35 vérifications) + contrôle visuel mobile

## Vérifié
- 35 vérifications d'intégration contre un MongoDB réel : cycle de vie des prix,
  multi-sources, désactivation, chiffrement, cloisonnement des accès.
- Rendu mobile 375×812 contrôlé sur les quatre écrans, infobulle du graphe testée.
- Build de production des deux projets sans erreur ni avertissement de type.

## Reste à faire par l'utilisateur
- Créer le tunnel Cloudflare et récupérer le token.
- Renseigner `.env` (secrets, compte d'accès, identifiants leboncoin).
- `docker compose up -d`, puis installer l'app sur l'iPhone.

## Non vérifiable ici
Le parcours de connexion réel à leboncoin et la structure exacte de ses pages :
cela demande le compte et une IP résidentielle. Le repli manuel (coller une
session) couvre le cas où l'automatisation échoue.

## Multi-utilisateur (2026-09-18)
- [x] Cloisonnement : chaque annonce, point de prix, recherche et relevé
      appartient à un compte ; 21 vérifications d'isolation passent
- [x] Inscription par identifiants leboncoin : le collecteur ouvre une vraie
      session pour les éprouver avant de créer le compte
- [x] Connexion à l'app avec les mêmes identifiants
- [x] Collecte multi-comptes : un contexte de navigateur par personne, en série
- [ ] Éprouver le parcours complet avec un deuxième compte réel

## Lecture de marché (2026-09-18)
- [x] Repères par segment : médiane, quartiles, tendance sur 30 jours
- [x] Annonces sous le marché, situées par leur écart au premier quartile
- [x] Vendeurs qui baissent, classés par terrain cédé
- [x] Durée de vie d'une annonce, dès qu'assez d'annonces sont parties
- [x] Répartition des prix du segment, chaque annonce à sa place
- [ ] Statistiques d'activité (messages envoyés) — décidé en second

## Cote d'un modèle (2026-09-30)
Remplace la lecture par segment : on choisit une voiture, on voit ce qu'elle vaut.
- [x] Demande marque / modèle / années ; le collecteur bâtit la recherche
      leboncoin (codes internes du modèle déduits de la 1re page), tourne
      jusqu'à 20 pages avec des pauses de 3 à 6 s
- [x] Collectes mutualisées : un même modèle relevé il y a moins de 24 h est
      réutilisé, quel que soit le compte qui l'a demandé
- [x] Graphique prix / km, couleur par motorisation ou par année, une courbe
      médiane par moteur, filtre par motorisation avec effectifs
- [x] « Ta voiture » : valeur d'après les comparables (même moteur, années et
      km proches, élargis seulement faute de mieux, silence sous 4 voitures)
- [x] Annonces à 15 % ou plus sous leurs propres comparables
- [x] 42 vérifications (tests/estimation.mjs), dont réutilisation et cloisonnement
- [x] Éprouvé sur leboncoin réel : 187 Cayman 2006–2008, `u_car_version`
      présent sur 80 % des annonces
- [x] Motorisations regroupées (préfixe de finition retiré, boîte séparée),
      moteur déduit du titre quand il manque, filtre Boîte
- [x] Annonces à risque (volant à droite, accident, panne) visibles mais hors
      de tout calcul
- [x] Fiche au survol / au toucher : photo, prix, km, boîte, vendeur, écart à
      la médiane au même km
- [x] Graphique manipulable comme une carte : prix en abscisse, km en
      ordonnée, molette / trackpad / pincement pour zoomer sous le curseur,
      glisser pour se déplacer, raccourcis Tout / Cœur du marché / Ta voiture
- [x] Écran de collecte en direct : étapes, compteur, avancement, annonces
      lues qui défilent
- [x] Médiane par moteur ; pas d'« affaire » sans moteur connu

## Bon Tracker Immo (2026-10-04)
Un second domaine dans la même app, bien séparé : on bascule dans les réglages.
- [x] Mode auto / immo porté par le compte (suit l'iPhone comme l'ordinateur) ;
      thème bleu, marque « Bon Tracker Immo », onglet Marché vers /immo
- [x] Suivi, recherches et compteurs filtrés par domaine (catégorie de
      l'annonce dans son adresse, catégorie de la recherche) ; rien n'est
      effacé, le collecteur relève toujours tout
- [x] Données à part : collections `immo_queries` et `immo_ads` ; seul le cycle
      de vie des collectes est partagé (`collect-jobs`, `collect`)
- [x] Demande : achat ou location, appartement ou maison, commune (référentiel
      geo.api.gouv.fr, arrondissements compris), rayon, surface du bien ; la
      recherche couvre 0,65 à 1,5 fois cette surface
- [x] Le collecteur découvre la forme du lieu que leboncoin comprend (nom et
      code postal, centre et rayon…) en vérifiant que les annonces sont du
      coin ; la forme retenue est réutilisée pour ce lieu
- [x] Prix au m² médian et quartiles, par pièces, décote des passoires (DPE F,
      G) à taille égale, écart du neuf ; graphique prix / surface
- [x] « Ton appartement » : valeur d'après les biens de surface proche et même
      nombre de pièces ; affaires à 15 % sous leurs comparables au m²
- [x] Viager, nue-propriété, enchères, résidences services, colocation,
      courte durée mis à part ; travaux, neuf, vendu loué signalés
- [x] Rendement brut quand loyers et prix de vente du même lieu sont connus
- [x] 88 vérifications (tests/immo.mjs) ; 36 pour le collecteur face à un faux
      leboncoin (worker/tests/collecte.mjs)
- [ ] Éprouver sur leboncoin réel : forme du lieu retenue, clés `square`,
      `rooms`, `real_estate_type`, `energy_rate` présentes
## Fusion (2026-10-05)
- [x] Branche immobilier réunie à `main` : cycle de vie commun des collectes
      étendu au relevé des nouveautés, graphique générique, barre du bas par
      mode (Alertes en auto seulement), boutons à second appui
- [x] Commits de la branche réécrits sans mention d'attribution
- [x] 311 vérifications web, 45 pour le collecteur (faux leboncoin)

## Alertes et négociation (2026-10-05)
Objectif : une raison d'ouvrir l'app chaque jour — être prévenu le premier
d'une bonne affaire, et arriver armé pour la négocier.

### Fondations
- [x] Date de publication de chaque annonce, historique de ses prix sur le marché
- [x] Relevé « frais » : 2 premières pages (les plus récentes) d'un modèle
      surveillé, fusionnées sans effacer le reste ; relevé complet une fois par jour
- [x] Planification côté collecteur : modèles surveillés toutes les 2 h,
      jamais la nuit (1 h – 7 h), une collecte à la fois
### Alertes
- [x] Veille sur une estimation : moteur, boîte, km max, prix max, seuil (10/15/20 %)
- [x] À chaque relevé : annonces sous leurs comparables → alerte ; à la création,
      les affaires déjà en ligne sont listées sans notification
- [x] Nouvelle baisse d'une annonce déjà signalée → nouvelle notification
- [x] Notifications iPhone (Web Push, clés VAPID générées et chiffrées en base)
- [x] Page Alertes : fil des affaires, veilles (pause / suppression), activation
      des notifications, onglet avec pastille de non-lus
### Négociation
- [x] Coller le lien d'une annonce ; si elle est inconnue, le collecteur la lit,
      puis relève son modèle
- [x] Fiche : prix juste (comparables), offre d'ouverture / cible / plafond,
      arguments chiffrés, durée en ligne, baisses, 3 comparables moins chères,
      message prêt à copier
- [x] Accès depuis les affaires, les alertes et les annonces suivies
### Vérification
- [x] Tests de bout en bout (alertes avec faux service de notification,
      négociation annonce connue / inconnue, cloisonnement)
- [x] Contrôle visuel mobile, documentation, commit, push
- [ ] Éprouver sur le PC : notifications sur l'iPhone installé, lecture d'une
      annonce réelle, premier relevé de nouveautés planifié

## Hors scope V1
E-mail/Telegram, application native.
