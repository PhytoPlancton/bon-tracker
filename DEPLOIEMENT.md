# Déploiement — PC gaming, Docker Desktop

Quatre containers : la base, l'interface, le collecteur, le tunnel HTTPS.
Tout tourne chez toi ; rien n'est ouvert sur ta box.

```
iPhone ──HTTPS──> Cloudflare ──tunnel sortant──> cloudflared ──> web ──> mongo
                                                                  ▲
                                                               worker (Chromium)
```

> **À taper dans PowerShell** (Menu Démarrer → *Windows PowerShell*), pas dans
> l'invite de commandes classique.
>
> **Une commande à la fois** : copier plusieurs lignes d'un coup les colle
> souvent bout à bout et produit des erreurs du genre
> `cd bon-trackerCopy-Item`. Valider chaque ligne avec Entrée avant la suivante.

---

## 1. Récupérer le code sur le PC

Le projet a été développé ailleurs : il faut d'abord l'amener ici.

```powershell
cd $HOME\Documents
git clone https://github.com/PhytoPlancton/bon-tracker.git
cd bon-tracker
```

Sans git installé : télécharger le ZIP depuis GitHub (bouton **Code → Download
ZIP**), l'extraire dans `Documents\bon-tracker`, puis `cd $HOME\Documents\bon-tracker`.

Toutes les commandes suivantes se lancent **depuis ce dossier** (celui qui
contient `docker-compose.yml`).

## 2. Tout installer en une commande

```powershell
.\setup.cmd
```

Le script vérifie Docker, construit les images, génère les secrets, demande les
deux comptes et le tunnel, puis démarre les services. Il est relançable : les
valeurs déjà renseignées sont conservées.

Ce qu'il demande :

| Question | Ce qu'il faut donner |
|---|---|
| Compte de l'application | Un e-mail et un mot de passe **de ton choix**, pour te connecter à Bon Tracker. Le mot de passe n'est jamais stocké : seul son hash bcrypt est écrit. |
| Compte leboncoin | Les identifiants de **ton compte leboncoin**, dont le collecteur a besoin pour voir tes favoris. Ils restent dans le `.env`, sur cette machine. |
| Token du tunnel | Voir l'étape suivante. Tu peux laisser vide et y revenir plus tard. |

Les saisies de mot de passe n'affichent rien à l'écran — c'est normal, continue
de taper puis valide avec Entrée.

## 3. Créer le tunnel Cloudflare

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com) → **Networks → Tunnels**
2. **Create a tunnel** → type **Cloudflared** → nom : `bon-tracker`
3. Copier le **token** affiché → `TUNNEL_TOKEN` dans `.env`
4. Onglet **Public Hostname** → **Add a public hostname** :
   - Subdomain : `bontracker`
   - Domain : `nmt.ovh`
   - Service : **HTTP** → `web:3000`
5. Cloudflare crée le DNS tout seul : rien à ajouter à la main.

Si tu avais laissé le token vide, relance `.\setup.cmd` : il ne redemandera que
celui-ci.

## 3 bis. Lancer le Chrome dédié

Le collecteur ne navigue pas lui-même : il pilote un Chrome installé sur la
machine. Un navigateur lancé par un robot est reconnu comme tel dès la première
page par la protection du site, quels que soient les cookies fournis.

```powershell
.\start-chrome.cmd
```

Une fenêtre Chrome s'ouvre, avec un profil séparé de ta navigation habituelle.
**Connecte-toi à leboncoin dedans, une seule fois.** La session y reste ensuite.

Laisse cette fenêtre ouverte : sans elle, aucun relevé n'a lieu. Tu peux la
réduire, elle n'a pas besoin d'être visible.

Pour qu'elle revienne à chaque démarrage du PC : `Win+R`, taper `shell:startup`,
et y glisser un raccourci vers `start-chrome.cmd`.

> Ce Chrome écoute sur le port 9222 pour être pilotable, ce qui le rend visible
> depuis le réseau local. Sur un réseau domestique c'est sans conséquence ;
> évite-le sur un réseau partagé, ou bloque le port 9222 dans le pare-feu
> Windows sauf pour Docker.

## 4. Vérifier que ça tourne

```powershell
docker compose ps
docker compose logs -f worker
```

Le collecteur lance un relevé immédiatement, puis toutes les 6 h — et refait un
relevé à chaque démarrage du PC, ce qui rattrape les périodes d'extinction.
Quitter l'affichage des logs : `Ctrl+C`.

## 5. Installer sur iPhone

Safari → `https://bontracker.nmt.ovh` → se connecter → **Partager** →
**Sur l'écran d'accueil**. L'app s'ouvre en plein écran, sans barre Safari.

> Cette étape n'a jamais fonctionné en `http://` : iOS n'installe une app web que
> depuis une origine sécurisée. C'est la raison d'être du tunnel.

---

## Exploitation

| Besoin | Commande |
|---|---|
| Voir les relevés | `docker compose logs -f worker` |
| Forcer un relevé | `docker compose run --rm worker node dist/index.js --once` |
| Récupérer les dernières modifications | `git pull` puis `docker compose up -d --build` |
| Sauvegarder la base | `docker compose exec -T mongo mongodump --archive --db bon_tracker --username bontracker --password "<MONGO_PASSWORD>" --authenticationDatabase admin > sauvegarde.archive` |
| Restaurer | `Get-Content sauvegarde.archive -Raw \| docker compose exec -T mongo mongorestore --archive --username bontracker --password "<MONGO_PASSWORD>" --authenticationDatabase admin` |
| Tout arrêter | `docker compose down` (les données survivent dans le volume) |

Dans Docker Desktop, cocher **Start Docker Desktop when you sign in** pour que la
pile remonte d'elle-même après un redémarrage du PC.

---

## Dépannage

**« Session leboncoin à rétablir » dans l'app**
Trois causes possibles, que le message précise :
- le Chrome dédié n'est pas lancé → `.\start-chrome.cmd` ;
- personne n'y est connecté → se connecter à leboncoin dans cette fenêtre ;
- le site demande une vérification → l'ouvrir dans ce Chrome et faire glisser
  le curseur soi-même, puis relancer un relevé.

**Le worker redémarre en boucle**
Une variable d'environnement manque : il s'arrête volontairement plutôt que de
tourner à moitié. `docker compose logs worker` nomme la variable fautive.

**`bontracker.nmt.ovh` ne répond pas**
`docker compose logs cloudflared`. Le plus souvent : le Public Hostname pointe
ailleurs que `http://web:3000`, ou le token a été régénéré côté Cloudflare.

**Aucune annonce après un relevé « Collecte OK »**
La page favoris était vide, ou la structure du site a changé. Les logs du worker
indiquent le nombre d'annonces vues par source. Pour observer le navigateur en
action, lancer un relevé unique en fenêtre visible depuis `worker/` :
`HEADLESS=false npm run dev`.

**Chromium plante en cours de relevé**
Mémoire partagée insuffisante. `shm_size` est déjà à 1 Go dans le compose ;
augmenter la RAM allouée à Docker Desktop si le PC est chargé.

---

## Variante GHCR (optionnelle)

`.github/workflows/build.yml` construit et publie les deux images sur GHCR à
chaque tag `v*`. Utile pour builder sur GitHub plutôt que sur le PC, ou pour
redéployer ailleurs plus tard. Sans cela, `docker compose build` suffit.
