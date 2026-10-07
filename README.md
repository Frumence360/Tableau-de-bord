# Frumence Maintenance — Dashboard + API (PostgreSQL + Auth)

Dashboard connecté à une API Node.js / Express, avec base de données **PostgreSQL**
et authentification par token JWT.

## Structure

```
frumence-dashboard/
├── server.js             # serveur Express (routes API protégées + fichiers statiques)
├── .env.example          # à copier en .env
├── db/
│   ├── index.js            # pool de connexion PostgreSQL (pg)
│   ├── schema.sql          # définition des tables
│   ├── migrate.js          # applique schema.sql + colonnes ajoutées (npm run migrate)
│   ├── queries.js          # toutes les requêtes, en async/await
│   └── seed.js             # crée le compte admin + les données de départ
├── middleware/
│   └── auth.js             # vérifie le token JWT + token_version
├── routes/
│   └── auth.js             # login, me, change-password
├── scripts/
│   ├── check-secrets.js      # détecte les secrets dans les fichiers versionnés
│   ├── pre-commit            # hook git (bloque un commit contenant un secret)
│   └── setup-hooks.js        # installe le hook (npm run setup-hooks)
├── public/index.html       # dashboard (écran de connexion + fetch authentifié)
├── public/editor.html      # éditeur de documents autonome
├── public/editor.css       # styles de l’éditeur
├── public/editor.js        # outils, import/export et intégration avec la saisie
└── package.json
```

## Démarrage local (Node.js + PostgreSQL)

Installe PostgreSQL et démarre son service local. Dans `psql` connecté avec
l'utilisateur administrateur PostgreSQL, crée l'utilisateur et la base :

```sql
CREATE ROLE frumence WITH LOGIN PASSWORD 'frumence';
CREATE DATABASE frumence_dashboard OWNER frumence;
```

```bash
cd frumence-dashboard
cp .env.example .env        # vérifie DATABASE_URL selon tes identifiants PostgreSQL
npm install
npm run setup-hooks         # installe le garde-fou anti-secrets (hook pre-commit)
npm run migrate             # crée les tables
npm run seed                # crée le compte admin + les données de départ
npm start
```

Ouvre **http://localhost:3000** et connecte-toi avec `ADMIN_USERNAME` / `ADMIN_PASSWORD`
définis dans `.env`.

La base est **PostgreSQL**. Node sert directement l’interface et l’API sur le même port.

## Premier déploiement sur Vercel

Vercel détecte l’application Express dans `server.js`. Les fichiers de `public/`
sont servis par son CDN; l’API reste sur la même origine. Les jetons d’export
et les sessions d’import temporaires sont stockés dans PostgreSQL, pas dans le
système de fichiers éphémère des fonctions.

1. Importe le dépôt GitHub dans Vercel avec la racine du projet et le build
   command par défaut (`npm install`, sans commande de build personnalisée).
2. Dans **Settings → Environment Variables**, ajoute pour Preview et Production :
   - `DATABASE_URL` : URL PostgreSQL de production (pour Supabase, préfère le
     pooler si les connexions directes ne sont pas disponibles depuis Vercel).
   - `PGSSL=true` si la connexion exige TLS.
   - `JWT_SECRET` : chaîne aléatoire longue, différente des secrets locaux.
   - `JWT_EXPIRES_IN=8h`.
   - `ADMIN_USERNAME` et `ADMIN_PASSWORD` : identifiants initiaux; le mot de
     passe doit faire au moins 12 caractères.
3. Applique le schéma sur la base cible avec `npm run migrate`, depuis un
   environnement disposant de `DATABASE_URL`.
4. Crée l’administrateur initial sans injecter les données de démonstration du
   seed : `npm run provision-admin`, avec les mêmes variables `DATABASE_URL`,
   `ADMIN_USERNAME` et `ADMIN_PASSWORD` définies de façon sécurisée dans
   l’environnement local d’administration.
5. Déploie d’abord un Preview, teste connexion, saisie, export et import avec
   de petits fichiers; puis promeus en Production.

Ne lance pas `npm run seed` sur une base de production vide sauf si tu souhaites
également insérer les exemples clients, commandes et statistiques. Vercel ajoute
automatiquement les origines de déploiement courante et production à la liste
CORS; garde `ALLOWED_ORIGINS` pour les origines locales ou externes explicites.
Les fonctions Vercel imposent une limite de taille aux corps HTTP : teste les
imports et pièces jointes volumineux sur un Preview avant de retenir Vercel pour
ce flux.

## Éditeur de documents

Depuis **Saisie > Ouvrir l’éditeur**, l’option « Ouvrir le nouvel éditeur »
ouvre le rédacteur complet dans un nouvel onglet. Il conserve ses fonctions de
mise en forme, tableaux, images, recherche/remplacement, zoom, impression et
exports HTML, texte, DOCX et PDF. « Insérer dans la fiche » renvoie le contenu
texte vers les observations de la saisie. Le bouton d’import de fichier conserve
son flux séparé de pièce jointe originale.

L’éditeur est servi par `public/editor.html` avec sa feuille CSS et son script
externes pour respecter la politique CSP. Le transfert entre les deux onglets
est limité à la même origine.

Pour une base PostgreSQL hébergée (Render, Railway, Supabase, RDS...) :

1. Crée une base Postgres chez l'hébergeur de ton choix
2. Récupère son `DATABASE_URL` et colle-le dans `.env`
3. Mets `PGSSL=true` si l'hébergeur l'exige (cas fréquent en managé)
4. `npm run migrate && npm run seed && npm start`

## Authentification

- `POST /api/auth/login` — `{ username, password }` → `{ token }`
- Toutes les autres routes `/api/*` exigent l'en-tête `Authorization: Bearer <token>`
- Le frontend stocke le token dans `localStorage` et se déconnecte automatiquement
  si le token expire (401) ou via le bouton "Déconnexion"
- Limite anti brute-force sur `/api/auth/login` (10 tentatives / 15 min)
- Limite générale sur `/api/*` (120 requêtes / minute)
- CORS strict : les origines autorisées sont limitées via `ALLOWED_ORIGINS` dans `.env` ; aucune origine non listée n'est acceptée.
- **Révocation des sessions :** chaque token embarque un numéro de version
  (`tv`) issu de la colonne `users.token_version`. Changer le mot de passe
  incrémente cette version, ce qui **invalide immédiatement tous les tokens
  émis auparavant** — y compris ceux d'autres appareils/navigateurs.
  La session qui vient de changer le mot de passe reçoit un **nouveau token**
  et reste connectée.

Les tokens émis **avant** cette version (sans claim `tv`) sont rejetés :
il faut se reconnecter une fois après `npm run migrate`.

## Garde-fou anti-secrets
Le projet embarque un contrôle qui empêche de committer par erreur de vraies
credentials (URL de base hébergée, mots de passe, clés API).

```bash
npm run setup-hooks   # installe le hook git pre-commit (à faire une fois)
npm run check-secrets # lance le contrôle manuellement
```

Une fois le hook installé, un `git commit` est **bloqué** si un fichier versionné
contient un secret. Règle principale : `.env.example` ne doit contenir que des
**placeholders** (localhost, `change-moi-...`) — jamais tes vraies valeurs, qui
vivent uniquement dans `.env` (non versionné).

Pour installer le hook automatiquement à chaque `npm install`, on peut ajouter
plus tard un script `postinstall`. En attendant : `npm run setup-hooks`.

## Changer le mot de passe
**Depuis le dashboard :** clique sur le bloc utilisateur en haut à droite (ou
Paramètres), saisis le mot de passe actuel puis le nouveau (8 caractères minimum).

Le changement **déconnecte toutes les autres sessions**. La session courante
est renouvelée (nouveau JWT).

**En ligne de commande :** modifie `ADMIN_PASSWORD` dans `.env` puis relance `npm run seed`.
Le seed détecte que le mot de passe a changé, met à jour le hash et incrémente
`token_version` (sans écraser tes autres données). Tous les JWT existants
deviennent invalides.

## Rôles et permissions

| Rôle | Lecture | Saisie | Validation | Archivage | Export |
|------|---------|-------|------------|-----------|--------|
| Admin | Oui | Oui | Oui | Oui | Oui |
| Manager | Oui | Oui | Oui | Oui | Oui |
| Capturer | Oui | Oui | Non | Non | Non |
| Viewer | Oui | Non | Non | Non | Non |

Les permissions sont contrôlées par l’API; l’interface masque aussi les
commandes indisponibles. Les managers peuvent consulter la supervision, mais
seuls les admins peuvent gérer les comptes et les rôles.

Les règles qualité sont consultables via `GET /api/validation/rules` et
configurables par un admin via `PUT /api/validation/rules`. Par défaut, la
catégorie est requise, les quantités/valeurs négatives sont rejetées, les notes
sont limitées à 300 caractères, et une référence répétée est détectée par
source. La paire source/référence est comparée sans tenir compte de la casse ou
des espaces extérieurs; le doublon est enregistré avec une anomalie et le
statut `rejete` afin de préserver sa traçabilité.

## Routes disponibles

| Méthode | Route                          | Auth | Description |
|---------|--------------------------------|------|-------------|
| POST    | `/api/auth/login`              | Non  | Connexion, retourne un token JWT |
| GET     | `/api/auth/me`                 | Oui  | Vérifie/retourne l'utilisateur du token |
| POST    | `/api/auth/change-password`    | Oui  | `{currentPassword, newPassword}` → nouveau `token` |
| GET     | `/api/dashboard`               | Oui  | Chargement agrégé du dashboard |
| GET     | `/api/indicators`              | Oui  | Indicateurs métier de collecte, validation, anomalies et archivage |
| GET     | `/api/stats`                   | Oui  | Statistiques de synthèse seedées |
| GET     | `/api/visits?range=30d`        | Oui  | Série de visites ou collecte (`7d`, `30d`, `90d`) |
| GET     | `/api/traffic-sources`         | Oui  | Répartition des sources de trafic |
| GET     | `/api/countries`               | Oui  | Répartition des visiteurs par pays |
| GET     | `/api/projects`                | Oui  | Liste des projets |
| POST    | `/api/projects`                | Saisie | Ajouter un projet `{title, status, date}` |
| PUT     | `/api/projects/:id`            | Saisie | Modifier un projet |
| DELETE  | `/api/projects/:id`            | Saisie | Supprimer un projet |
| GET     | `/api/clients`                 | Oui  | Liste des clients |
| GET     | `/api/orders`                  | Oui  | Liste des commandes |
| GET     | `/api/messages`                | Oui  | Liste des messages |
| POST    | `/api/messages/read-all`       | Saisie | Marquer tous les messages comme lus |
| GET     | `/api/records`                 | Oui  | Fiches capturées avec pagination et filtres |
| POST    | `/api/records`                 | Saisie | Créer une fiche et appliquer les règles qualité |
| POST    | `/api/records/:id/attachments` | Saisie | Joindre un fichier original à une fiche (maximum 10 Mo) |
| GET     | `/api/records/:id/attachments` | Oui  | Lister les pièces jointes d'une fiche |
| GET     | `/api/records/:id/attachments/:attachmentId/download` | Oui | Télécharger une pièce jointe |
| PUT     | `/api/records/:id`             | Saisie | Corriger une fiche et journaliser les changements |
| PUT     | `/api/records/:id/status`      | Validation | Changer le statut d'une fiche |
| POST    | `/api/records/:id/correction`  | Saisie | Ajouter une correction manuelle |
| POST    | `/api/records/:id/archive`     | Archivage | Archiver une fiche |
| GET     | `/api/validation/issues`       | Oui  | Anomalies paginées et filtrées |
| GET     | `/api/validation/rules`        | Oui  | Lire les règles qualité |
| PUT     | `/api/validation/rules`        | Admin | Configurer les règles qualité |
| GET     | `/api/reports/data`            | Oui  | Rapport agrégé des fiches |
| POST    | `/api/exports/token`           | Export | Émettre un token d'export CSV à usage unique |
| GET     | `/api/exports/data.csv`        | Token | Télécharger le CSV avec le token d'export |
| POST    | `/api/imports/preview`         | Saisie | Prévisualiser un import CSV/Excel |
| POST    | `/api/imports/validate`        | Saisie | Valider le mapping et les lignes d'import |
| POST    | `/api/imports/commit`          | Saisie | Insérer les lignes valides de l'import |
| GET     | `/api/users`                   | Admin/manager | Liste des comptes |
| POST    | `/api/users`                   | Admin | Créer un compte |
| PUT     | `/api/users/:id/role`          | Admin | Modifier le rôle |
| PUT     | `/api/users/:id/password`      | Admin | Réinitialiser le mot de passe et révoquer les sessions |
| PUT     | `/api/users/:id/status`        | Admin | Activer/désactiver le compte et révoquer les sessions |
| GET     | `/api/security/audit`          | Admin/manager | Consulter le journal d'audit |

Un compte désactivé ne peut plus se connecter et ses tokens sont refusés. Le
dernier administrateur actif ne peut pas être rétrogradé; un administrateur ne
peut pas non plus désactiver son propre compte.

## Pourquoi PostgreSQL

- Tient la charge en production, contrairement à SQLite (single-writer)
- Compatible avec tous les hébergeurs managés (Render, Railway, Supabase, Neon, RDS...)
- Migration facile vers un ORM plus tard (Prisma, Drizzle) si le projet grossit —
  toute la logique SQL est isolée dans `db/queries.js`, rien d'autre à toucher

## Notes de déploiement

- Les tokens d'export et les sessions d'import sont stockés en mémoire. C'est
  suffisant pour une instance Node mono-processus, mais il faudra un store
  partagé (Redis, par exemple) avant un déploiement en cluster ou multi-conteneur.
- Les fichiers locaux d'éditeur, les exports de QA et les rapports de couverture
  sont ignorés par Git. Les secrets réels doivent rester dans `.env`.

## Prochaines améliorations possibles

- Passer à un ORM (Prisma/Drizzle) si le schéma devient plus complexe
- CRUD clients / commandes
- Lier `orders` aux `clients` par clé étrangère
- Refresh token au lieu d'un token unique de 8h
- Tests d'intégration PostgreSQL avec une base de test dédiée
- Migrations versionnées (ex. `node-pg-migrate`) si le schéma évolue souvent
