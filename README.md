# bon-tracker

Suivi de l'historique de prix des annonces leboncoin : les favoris, et les
recherches sauvegardées que tu choisis de suivre. **Un point sur le graphe par
changement de prix** — pas un par relevé.

Interface pensée pour le téléphone, installable sur l'écran d'accueil iOS.

Deux applications en une, au choix dans les réglages :

- **Bon Tracker** (auto) — suivi des annonces et cote d'un modèle de voiture
  d'après toutes ses annonces : prix / kilométrage, motorisations, affaires.
  - **Alertes** : une veille sur un modèle (moteur, boîte, km et budget max,
    seuil de −10 à −20 %), relue toutes les deux heures en journée ; une
    voiture qui sort sous ses comparables, ou qui baisse encore, arrive en
    notification sur l'iPhone.
  - **Négocier** : colle le lien d'une annonce ; la fiche donne le prix juste
    d'après ses comparables, trois prix (ouverture, cible, plafond), des
    arguments chiffrés et un message prêt à envoyer au vendeur.
  - **Évolution de la cote** : une photo par jour de relevé, suivie moteur par
    moteur (toutes motorisations confondues, la médiane suivrait le mélange
    des annonces, pas les prix).
  - **Pour la vendre** : trois prix d'annonce (vite, au marché, en
    patientant) et la durée en ligne observée des annonces parties à chaque
    niveau de prix.
  - **Signaux** : prix anormalement bas (mis à part des comparables, toujours
    signalé), kilométrage incohérent, annonce republiée, ce que dit la
    description (sans CT, à prévoir… / carnet, factures…).
  - **Export CSV** des annonces et de la synthèse, avec une consigne pour
    ChatGPT.
- **Bon Tracker Immo** — suivi des biens et marché d'un appartement ou d'une
  maison dans une commune : prix (ou loyer) au m², par pièces, décote des
  passoires énergétiques, valeur de ton bien, rendement brut.

Les données des deux modes vivent à part ; changer de mode n'efface rien.

## Organisation

```
web/      Next.js — interface mobile (PWA) + API. Seul composant à toucher Mongo.
worker/   Playwright + cron — relève les annonces et les pousse vers l'API.
tasks/    Plan de travail et leçons.
```

Le collecteur n'a aucun accès à la base : il parle à `/api/internal/*` avec un
jeton dédié. Une seule porte d'écriture, un seul pool de connexions Mongo.

## Démarrage

Tout est décrit dans [DEPLOIEMENT.md](DEPLOIEMENT.md) — compter 15 minutes.

```bash
cp .env.example .env    # puis suivre le guide
docker compose up -d
```

## Développement

```bash
cd web && npm install && npm run dev
```

```bash
cd worker && npm install && npx playwright install chromium
npm run dev                  # un relevé unique, sans planification
HEADLESS=false npm run dev   # même chose, mais en regardant le navigateur travailler
```

## Ce que fait le collecteur

1. Reprend la session leboncoin stockée (chiffrée) ; se reconnecte si elle a expiré.
2. Relève la page Favoris.
3. Remonte la liste des recherches sauvegardées du compte.
4. Parcourt celles que tu as activées dans l'app.
5. Écrit un point de prix **uniquement quand le prix a bougé**.
6. Toutes les 20 minutes, demande à l'application quels modèles surveillés sont
   dus (un par modèle, quel que soit le nombre de comptes qui le surveillent) :
   les deux premières pages triées par date, un relevé complet une fois par
   jour, rien entre 1 h et 7 h.

Une annonce rattachée à plusieurs sources (favori *et* recherche) n'est retirée
du tableau de bord que lorsqu'elle a disparu de toutes. Son historique, lui, est
conservé.

## Sécurité

- Mot de passe d'accès : hash bcrypt (coût 12), jamais stocké ni transmis en clair.
- Session leboncoin : chiffrée AES-256-GCM avant écriture en base.
- Identifiants leboncoin : variables d'environnement du collecteur uniquement,
  jamais dans une image ni dans le dépôt.
- Session applicative : JWT signé, cookie `httpOnly` / `secure` / `sameSite=lax`.
- Connexion limitée à 5 tentatives par quart d'heure.
- Mongo et le collecteur ne publient aucun port ; seul le tunnel expose l'app.
- Notifications : clés VAPID tirées une fois et rangées chiffrées en base ;
  clés d'abonnement de chaque appareil chiffrées ; seules les adresses https
  extérieures sont acceptées comme destinataires.
- Négociation : seul le numéro d'une annonce est retenu d'un lien collé ; le
  collecteur ne visite jamais une adresse fournie telle quelle.

## Limites connues

- leboncoin peut opposer une vérification au collecteur. L'app le signale et
  permet de coller une session valide en dix secondes (écran Réglages).
- Une recherche sauvegardée très large génère beaucoup d'annonces éphémères :
  l'historique n'a de valeur que sur celles qui restent en ligne plusieurs jours.
- Le PC doit être allumé pour qu'un relevé ait lieu ; un relevé de rattrapage est
  lancé à chaque démarrage.
