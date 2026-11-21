# 📚 Bibliothèque d'archivage

Application d'archivage avec étagères virtuelles, inspirée de l'app « My Library ».

## Ce qui est déjà fait (`index.html`)

HTML, CSS et JavaScript pur, dans un seul fichier, sans dépendance.

- **3 onglets** : Étagères (couvertures rangées par étagère), Liste, Tags
- **Ajout, modification, suppression** d'un élément : titre, auteur/référence, type, étagère, tags, notes
- **Recherche** par titre, auteur, étagère, tag ou notes
- **Scan de couverture** : photo → lecture du titre, de l'auteur et du type par Claude → champs préremplis. La photo devient la couverture
- **Fichier joint** : bouton 📎 qui ouvre le gestionnaire de fichiers (50 Mo max), avec Ouvrir, Télécharger, Retirer
- **Export JSON** de la liste
- Thème sombre/clair automatique, adapté au mobile

### Limites de la version actuelle

- Les données sont dans le navigateur (`localStorage`), les fichiers dans IndexedDB : elles ne passent pas d'un appareil à l'autre et se perdent si le cache est vidé
- Les fichiers ne sont pas inclus dans l'export JSON
- Le scan utilise la fonction `sample` des artifacts Claude : elle ne marche pas hors de claude.ai

## Intégration au dashboard Frumence

Le modèle PostgreSQL est intégré dans `db/schema.sql` du projet et s'applique
avec `npm run migrate`. Il utilise la table `users` et l'authentification JWT
existantes : pas de Supabase Auth ni de règles RLS. Les archives forment un
espace partagé, avec les identifiants `created_by`, `updated_by` et `uploaded_by`
pour tracer les actions des utilisateurs.

| Version actuelle | Dans ton projet |
|---|---|
| `localStorage` | Table `library_items` (PostgreSQL) |
| Tags | Colonne PostgreSQL `tags` (`text[]`) |
| Couverture et fichier joint | Contenu et métadonnées conservés dans PostgreSQL (`BYTEA`), maximum 4 Mo par fichier |
| Gestion des fiches | Vue dédiée « Bibliothèque » dans la navigation du dashboard : étagères, liste, tags, recherche, filtres, pagination, CRUD et export JSON |
| Scan via `sample` | Route API qui appelle l'API Anthropic |

`bibliotheque-archivage/schema.sql` est conservé comme repère historique et
n'est pas appliqué par `npm run migrate`.

### Scan de couverture côté serveur

- Le front envoie la photo (réduite à ~1000 px) à une route API
- La route appelle l'API Anthropic avec une clé gardée côté serveur dans une variable d'environnement, jamais dans le navigateur
- Modèle conseillé : `claude-haiku-5-5` (vérifier qu'il accepte les images dans la doc), sinon `claude-sonnet-5-5`
- Réponse attendue : `{"titre": "", "auteur": "", "type": ""}`
- Coût estimé (tarifs d'octobre 2026, à revérifier) : environ 0,0002 $ par scan avec Haiku 5.5, environ 0,003 $ avec Sonnet 5.5

## Suite conseillée (dans l'ordre)

1. **Appliquer le modèle PostgreSQL** avec `npm run migrate`
2. **Mettre le scan côté serveur** dans une route API qui appelle l'API Anthropic
3. **Prévoir l'import des données locales** et les sauvegardes des fiches et fichiers

## À définir

Le stockage des fichiers utilise actuellement `BYTEA` dans PostgreSQL. Pour des
volumes importants, évaluer plus tard un stockage objet privé.
