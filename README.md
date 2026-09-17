# Frumence Maintenance — Dashboard + API (PostgreSQL + Auth)

Dashboard connecté à une API Node.js / Express, avec base de données **PostgreSQL**
et authentification par token JWT.

## Structure

```
frumence-dashboard/
├── server.js             # serveur Express (routes API protégées + fichiers statiques)
├── docker-compose.yml    # Postgres local pour le dev
├── .env.example          # à copier en .env
├── db/
│   ├── index.js            # pool de connexion PostgreSQL (pg)
│   ├── schema.sql          # définition des tables
│   ├── migrate.js          # applique schema.sql (npm run migrate)
│   ├── queries.js          # toutes les requêtes, en async/await
│   └── seed.js             # crée le compte admin + les données de départ
├── middleware/
│   └── auth.js             # vérifie le token JWT sur les routes protégées
├── routes/
│   └── auth.js             # POST /api/auth/login, GET /api/auth/me
├── public/index.html       # dashboard (écran de connexion + fetch authentifié)
└── package.json
```

## Démarrage (avec Postgres en local via Docker)

```bash
cd frumence-dashboard
cp .env.example .env        # DATABASE_URL par défaut correspond au docker-compose
docker compose up -d        # lance Postgres sur localhost:5432
npm install
npm run migrate             # crée les tables
npm run seed                # crée le compte admin + les données de départ
npm start
```

Ouvre **http://localhost:3000** et connecte-toi avec `ADMIN_USERNAME` / `ADMIN_PASSWORD`
définis dans `.env`.

## Démarrage avec une base Postgres hébergée (Render, Railway, Supabase, RDS...)

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

## Routes disponibles

| Méthode | Route                    | Auth | Description                                  |
|---------|---------------------------|------|-----------------------------------------------|
| POST    | `/api/auth/login`         | Non  | Connexion, retourne un token JWT               |
| GET     | `/api/auth/me`            | Oui  | Vérifie/retourne l'utilisateur du token        |
| GET     | `/api/stats`              | Oui  | Sites web, clients, commandes, revenus         |
| GET     | `/api/visits?range=30d`   | Oui  | Série de visites (`7d`, `30d`, `90d`)          |
| GET     | `/api/traffic-sources`    | Oui  | Répartition des sources de trafic              |
| GET     | `/api/countries`          | Oui  | Répartition des visiteurs par pays             |
| GET     | `/api/projects`           | Oui  | Liste des projets récents                      |
| POST    | `/api/projects`           | Oui  | Ajouter un projet `{title, status, date}`      |
| GET     | `/api/dashboard`          | Oui  | Tout en un seul appel (utilisé au chargement)  |

## Pourquoi PostgreSQL

- Tient la charge en production, contrairement à SQLite (single-writer)
- Compatible avec tous les hébergeurs managés (Render, Railway, Supabase, Neon, RDS...)
- Migration facile vers un ORM plus tard (Prisma, Drizzle) si le projet grossit —
  toute la logique SQL est isolée dans `db/queries.js`, rien d'autre à toucher

## Prochaines améliorations possibles

- Passer à un ORM (Prisma/Drizzle) si le schéma devient plus complexe
- Ajouter la gestion multi-utilisateurs (plus d'un compte admin)
- Routes `PUT`/`DELETE` pour éditer ou supprimer un projet
- Refresh token au lieu d'un token unique de 8h
- Tests automatisés sur `db/queries.js` (avec une base de test dédiée)
- Migrations versionnées (ex. `node-pg-migrate`) si le schéma évolue souvent
