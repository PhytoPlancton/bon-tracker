# Déploiement — PC gaming, Docker Desktop

Quatre containers : la base, l'interface, le collecteur, le tunnel HTTPS.
Tout tourne chez toi ; rien n'est ouvert sur ta box.

```
iPhone ──HTTPS──> Cloudflare ──tunnel sortant──> cloudflared ──> web ──> mongo
                                                                  ▲
                                                               worker (Chromium)
```

> **Toutes les commandes ci-dessous sont à taper dans PowerShell**, pas dans
> l'invite de commandes classique (`cmd`). Menu Démarrer → *Windows PowerShell*.
> Sous macOS/Linux, les mêmes commandes fonctionnent en remplaçant `Copy-Item`
> par `cp`.

---

## 1. Récupérer le code sur le PC

Le projet a été développé ailleurs : il faut d'abord l'amener ici.

```powershell
cd $HOME\Documents
git clone <url-du-dépôt> bon-tracker
cd bon-tracker
```

Sans git installé : télécharger le ZIP depuis GitHub (bouton **Code → Download
ZIP**), l'extraire dans `Documents\bon-tracker`, puis `cd $HOME\Documents\bon-tracker`.

Toutes les commandes suivantes se lancent **depuis ce dossier** (celui qui
contient `docker-compose.yml`).

## 2. Préparer le fichier de configuration

```powershell
Copy-Item .env.example .env
notepad .env
```

## 3. Générer les secrets

Sans rien installer sur la machine :

```powershell
docker run --rm node:22-alpine node -e "const c=require('node:crypto');console.log('MONGO_PASSWORD='+c.randomBytes(24).toString('base64url'));console.log('ENCRYPTION_KEY='+c.randomBytes(32).toString('base64'));console.log('SESSION_SECRET='+c.randomBytes(48).toString('base64url'));console.log('WORKER_TOKEN='+c.randomBytes(32).toString('base64url'))"
```

Recopier les quatre lignes dans `.env`.

## 4. Construire les images

```powershell
docker compose build
```

Le worker télécharge Chromium : compter quelques minutes la première fois.

## 5. Créer le compte d'accès

```powershell
docker compose run --rm --no-deps web node scripts/hash-password.mjs
```

Le mot de passe est saisi en local et n'est jamais affiché. La commande renvoie
`ADMIN_EMAIL` et `ADMIN_PASSWORD_HASH` : les recopier dans `.env`. **Seul le hash
bcrypt est stocké.**

## 6. Renseigner le compte leboncoin

Dans `.env` : `LBC_EMAIL` et `LBC_PASSWORD`. Ces valeurs ne servent qu'au
collecteur, restent sur ta machine, et ne sont jamais écrites dans une image.

## 7. Créer le tunnel Cloudflare

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com) → **Networks → Tunnels**
2. **Create a tunnel** → type **Cloudflared** → nom : `bon-tracker`
3. Copier le **token** affiché → `TUNNEL_TOKEN` dans `.env`
4. Onglet **Public Hostname** → **Add a public hostname** :
   - Subdomain : `bontracker`
   - Domain : `nmt.ovh`
   - Service : **HTTP** → `web:3000`
5. Cloudflare crée le DNS tout seul : rien à ajouter à la main.

## 8. Démarrer

```powershell
docker compose up -d
```

Vérifier que tout est debout :

```powershell
docker compose ps
docker compose logs -f worker
```

Le collecteur lance un relevé immédiatement, puis toutes les 6 h — et refait un
relevé à chaque démarrage du PC, ce qui rattrape les périodes d'extinction.

## 9. Installer sur iPhone

Safari → `https://bontracker.nmt.ovh` → se connecter → **Partager** →
**Sur l'écran d'accueil**. L'app s'ouvre en plein écran, sans barre Safari.

> Cette étape n'a jamais fonctionné en `http://` : iOS n'installe une app web que
> depuis une origine sécurisée. C'est la raison d'être du tunnel.

---

## Exploitation

| Besoin | Commande |
|---|---|
| Voir les relevés | `docker compose logs -f worker` |
| Forcer un relevé | `docker compose restart worker` |
| Mettre à jour après modification du code | `docker compose up -d --build` |
| Sauvegarder la base | `docker compose exec -T mongo mongodump --archive --db bon_tracker --username bontracker --password "<MONGO_PASSWORD>" --authenticationDatabase admin > sauvegarde.archive` |
| Restaurer | `Get-Content sauvegarde.archive -Raw \| docker compose exec -T mongo mongorestore --archive --username bontracker --password "<MONGO_PASSWORD>" --authenticationDatabase admin` |
| Tout arrêter | `docker compose down` (les données survivent dans le volume) |

Dans Docker Desktop, cocher **Start Docker Desktop when you sign in** pour que la
pile remonte d'elle-même après un redémarrage du PC.

---

## Dépannage

**« Session leboncoin à rétablir » dans l'app**
leboncoin a opposé une vérification au collecteur. Écran **Réglages** → coller
l'en-tête `Cookie` d'un navigateur déjà connecté (marche à suivre dépliable sur
l'écran). Le relevé suivant repart avec cette session.

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
