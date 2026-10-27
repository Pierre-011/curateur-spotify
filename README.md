# Curator Desk — GitHub Edition

Dashboard français pour gérer les placements musicaux et leurs dates de fin, sans API Spotify ni serveur traditionnel.

## Architecture

- **GitHub Pages** : héberge l'interface statique.
- **Dépôt privé de données** : stocke `data/curator.json`.
- **GitHub API Contents** : le navigateur lit/écrit le JSON après connexion avec un Fine-grained Personal Access Token.
- **GitHub Actions** : contrôle les échéances quotidiennement et ouvre/actualise une issue GitHub si des placements sont à échéance dans les 7 jours.
- **Aucune API Spotify** : les titres, liens et dates sont renseignés par le curateur.

## Important : séparer le site et les données

Le navigateur ne doit jamais contenir un jeton GitHub permanent dans le code source. Cette version demande un token dans l'onglet Paramètres et le conserve uniquement en mémoire JavaScript. Il est effacé quand la page est rechargée/fermée ou quand on clique sur Déconnecter. Il n'est ni mis dans `localStorage`, ni écrit dans les fichiers du site.

Le token doit être un **Fine-grained personal access token**, limité au seul dépôt privé de données, avec `Contents: Read and write` et `Metadata: Read-only`. N'accorde pas d'accès à tous tes dépôts. Chaque appareil/navigateur doit saisir son propre token ou le même token limité. Si tu préfères ne pas saisir de token dans le navigateur, il faut une autre architecture avec authentification/backend.

## Installation recommandée

### 1. Créer le dépôt public du site

1. Crée un dépôt GitHub public nommé par exemple `curator-desk`.
2. Ajoute tous les fichiers de ce projet à la racine.
3. Dans **Settings → Pages**, choisis **Deploy from a branch**, branche `main`, dossier `/ (root)`.
4. Attends le déploiement. Le site sera généralement disponible à `https://TON-COMPTE.github.io/curator-desk/`.

### 2. Créer le dépôt privé de données

1. Crée un autre dépôt **privé**, par exemple `curator-data`.
2. Ajoute uniquement le fichier `data/curator.json` depuis ce projet, en conservant son chemin `data/curator.json`.
3. Ajoute le workflow `.github/workflows/daily-check.yml` dans ce dépôt privé également. Le workflow doit être dans le dépôt contenant les données, car c'est lui qu'il inspecte.
4. Dans les paramètres du dépôt, vérifie que **Issues** et **Actions** sont activés. Dans **Actions → General**, autorise les workflows à créer et approuver des pull requests si besoin; pour ce workflow, l'autorisation d'écriture des issues est contrôlée par `permissions: issues: write`.
5. Dans **Settings → Actions → General → Workflow permissions**, vérifie les permissions nécessaires. Le YAML demande explicitement `contents: read` et `issues: write`.

### 3. Créer le jeton GitHub

Sur GitHub : **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.

- Resource owner : ton compte.
- Repository access : **Only select repositories** → choisis uniquement `curator-data`.
- Repository permissions :
  - **Contents: Read and write**
  - **Metadata: Read-only** (généralement sélectionné automatiquement).
- Définis une expiration raisonnable.
- Génère le jeton et copie-le immédiatement. GitHub ne l'affiche généralement qu'une seule fois.

N'ajoute jamais le jeton à un fichier, un commit, une capture d'écran ou un message public. Ne le saisis pas sur un appareil partagé/non fiable.

### 4. Connecter le dashboard

Dans **Connexion & données** du site :
- Compte / organisation : ton nom de compte GitHub.
- Dépôt : `curator-data`.
- Branche : `main` (ou le nom réel de ta branche).
- Jeton : le Fine-grained PAT créé ci-dessus.
- Clique **Connecter et charger**.

Les modifications de playlists et de placements sont commitées dans `data/curator.json`. Sur un autre appareil, ouvre le site et connecte-toi avec les mêmes paramètres et un token valide.

### 5. Tester l'automatisation

Dans le dépôt privé de données :
- Ouvre **Actions → Vérification quotidienne des placements**.
- Clique **Run workflow** pour déclencher une vérification manuelle.
- Les exécutions planifiées GitHub peuvent être retardées; elles ne garantissent pas une alerte à une heure exacte.
- Le workflow met à jour une issue ouverte portant le titre « 🎵 Échéances des placements — suivi automatique », ou en crée une si des échéances existent.

## Fonctionnalités

- Playlists : création, modification et suppression (si aucune piste n'y est rattachée).
- Placements : titre, artiste, playlist, lien Spotify, dates de début/fin, notes.
- Calcul automatique des statuts : à venir, en cours, fin sous 7 jours, en retard, retiré.
- Recherche et filtres.
- Marquer un titre comme retiré / réactiver / supprimer.
- Export et import JSON.
- Responsive mobile/ordinateur.

## Limites et sécurité

- Ce n'est pas une synchronisation Spotify : l'application ne peut pas savoir si un morceau a réellement été retiré de Spotify. Il faut marquer le retrait manuellement.
- L'interface du site est publique si tu l'héberges dans un dépôt public. Les données restent dans le dépôt privé; l'API GitHub nécessite le token pour y accéder.
- Un token saisi dans le navigateur reste accessible au code JavaScript de cette page pendant que l'onglet est ouvert. Utilise seulement le site que tu as vérifié, évite les extensions inconnues et déconnecte-toi sur les appareils partagés.
- La version actuelle n'envoie pas d'e-mail. Elle signale les échéances via les issues GitHub.
- GitHub Actions planifié n'est pas une alarme garantie à la minute.
- Pas d'import automatique de playlist Spotify : les données sont saisies manuellement.
