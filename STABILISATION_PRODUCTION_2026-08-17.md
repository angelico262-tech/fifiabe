# FIFIABE — Stabilisation production du 17 août 2026

## Périmètre

Cette reprise a été effectuée dans `/home/ubuntu/projects/fifiabe-20b97dc1` après extraction de l’archive de continuité. Les documents `FIFIABE_CONTINUITE_IA.md` et `FIFIABE_DEVELOPMENT_TRACEABILITY.md` ont été lus avant toute modification du code.

Les invariants suivants sont préservés : **Option A**, les origines `PASSENGER_APP`, `COUNTER` et `LEGACY_UNKNOWN`, le suivi neutre des montants et commissions, ainsi que la préparation future USSD et multi-coopératives. Aucune clé réelle ni aucun fichier `.env` n’a été ajouté.

## Constats d’audit

Le schéma Prisma, le seed et la migration de suivi neutre sont présents. Le seed reste idempotent et prépare neuf véhicules actifs de 17 places, deux routes ordonnées, les comptes de rôles et douze départs brouillons couvrant les quatre prochaines semaines selon les jours de départ configurés.

Le backend séparait déjà les opérations par arrêt pour les opérateurs, interdisait les actions d’écriture du chauffeur et exposait une vue de manifeste. En revanche, l’endpoint global `/api/admin/bookings` n’avait pas de garde explicite contre un appel d’un chauffeur authentifié. La correction ajoute ce refus côté serveur ; l’interface seule ne doit jamais être considérée comme une frontière de sécurité.

Le manifeste ne renvoyait pas l’origine de la réservation, alors que le suivi neutre et la distinction guichet/application sont des invariants du projet. L’origine est maintenant incluse dans chaque ligne du manifeste et affichée comme `Application`, `Guichet` ou `Ancienne donnée`.

L’impression du manifeste reposait auparavant sur l’impression générale du navigateur sans action dédiée. Un bouton **Imprimer le manifeste** est maintenant présent, et les règles d’impression masquent les contrôles et les autres sections afin de produire une feuille centrée sur le manifeste. Les règles responsive existantes conservent l’affichage mobile en une colonne et le tableau staff reste défilable horizontalement.

## Modifications appliquées

| Fichier | Modification | Justification |
|---|---|---|
| `backend/src/index.ts` | Refus explicite de `/api/admin/bookings` pour `DRIVER` | Empêcher l’accès chauffeur à la vue globale des réservations |
| `backend/src/index.ts` | Ajout de `origin` dans la réponse du manifeste | Préserver la traçabilité `PASSENGER_APP` / `COUNTER` / `LEGACY_UNKNOWN` |
| `frontend/src/App.tsx` | Type et affichage de l’origine dans le manifeste | Lecture opérationnelle cohérente avec le suivi neutre |
| `frontend/src/App.tsx` | Bouton d’impression dédié et règles `@media print` du manifeste | Support imprimable pour l’embarquement |
| `STABILISATION_PRODUCTION_2026-08-17.md` | Présent document | Traçabilité de la reprise et recette d’exploitation |

Aucune migration Prisma n’est nécessaire pour cette série : les changements utilisent uniquement des champs déjà présents dans le modèle `Booking`.

## Validation technique réalisée

Les commandes suivantes ont abouti :

```bash
cd /home/ubuntu/projects/fifiabe-20b97dc1/backend
pnpm exec prisma generate
pnpm build

cd ../frontend
pnpm build
```

La validation de schéma Prisma nécessite `DATABASE_URL` et `DIRECT_URL`. Elle a été exécutée avec des URLs locales factices uniquement pour vérifier la syntaxe du schéma ; aucune connexion à une base réelle n’a été tentée dans cet environnement sans `.env`.

```bash
cd /home/ubuntu/projects/fifiabe-20b97dc1/backend
DATABASE_URL='postgresql://audit:pass@127.0.0.1:5432/fifiabe' \
DIRECT_URL='postgresql://audit:pass@127.0.0.1:5432/fifiabe' \
pnpm exec prisma validate
```

Le dépôt ne déclare pas encore de framework de tests automatisés : `backend/package.json` ne contient pas de script `test`, et `frontend/package.json` ne contient pas de suite UI/e2e. La recette ci-dessous constitue donc la validation fonctionnelle manuelle de cette reprise.

## Recette manuelle des rôles

Créer d’abord un environnement local à partir de `backend/.env.example`, renseigner les URLs Supabase et un `JWT_SECRET` long, puis lancer la migration et le seed.

| Rôle | Vérification attendue |
|---|---|
| `SUPER_ADMIN` | Connexion ; accès à l’aperçu global, aux origines et aux avis/plaintes ; absence de calcul de commission définitive |
| `ADMIN` | Connexion ; accès aux réservations et aux avis/plaintes ; pas d’accès à l’aperçu strictement super-admin |
| `OPERATOR` d’un arrêt | Départs de son arrêt ; publication/modification de ses départs ; vérification paiement et annulation uniquement pour les réservations accessibles à son arrêt ; création guichet limitée à son arrêt |
| `DRIVER` | Lecture des départs et des manifestes ; aucune publication, vérification paiement, annulation, guichet, feedback ou vue globale `/api/admin/bookings` |
| Passager | Recherche, sélection de sièges, réservation avec origine `PASSENGER_APP`, suivi par référence, déclaration de paiement et impression du bon |

Scénarios de régression à exécuter avec deux comptes opérateurs d’arrêts différents :

1. Publier un départ depuis l’arrêt A, puis vérifier que l’opérateur de l’arrêt B reçoit un refus lorsqu’il tente de le gérer.
2. Créer une réservation depuis l’application, puis une réservation au guichet ; vérifier les origines dans les réservations, le manifeste et l’aperçu super-admin.
3. Déclarer un paiement, vérifier qu’il passe à `PAYMENT_DECLARED`, puis le confirmer depuis l’opérateur autorisé.
4. Réutiliser la même référence de paiement ou déclarer deux fois le paiement ; vérifier le refus côté serveur.
5. Annuler une réservation et vérifier la libération du siège, la mise à jour de la capacité et l’information de liste d’attente.
6. Se connecter comme chauffeur, ouvrir les départs et un manifeste, puis appeler directement `/api/admin/bookings` avec son jeton : la réponse attendue est HTTP 403.
7. Depuis le manifeste, cliquer sur **Imprimer le manifeste** et vérifier que les onglets, filtres, actions et formulaires ne figurent pas sur la feuille imprimée.

## Commandes d’installation et d’exploitation

Depuis la racine du monorepo :

```bash
cd /home/ubuntu/projects/fifiabe-20b97dc1
pnpm install --frozen-lockfile
```

Créer ensuite `backend/.env` localement, sans le publier :

```dotenv
DATABASE_URL="postgresql://...pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://...supabase.com:5432/postgres"
JWT_SECRET="remplacer-par-un-secret-long-et-aleatoire"
HOST="127.0.0.1"
PORT="3000"
```

Initialiser Prisma et les données de démonstration :

```bash
cd backend
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm seed
```

Lancer le développement dans deux terminaux :

```bash
# Terminal backend
cd /home/ubuntu/projects/fifiabe-20b97dc1/backend
pnpm dev

# Terminal frontend
cd /home/ubuntu/projects/fifiabe-20b97dc1/frontend
pnpm dev
```

Les liaisons restent locales : backend sur `127.0.0.1:3000` et frontend Vite sur `127.0.0.1`.

## Points restant à traiter dans une prochaine série

La suite recommandée est d’ajouter une vraie suite de tests backend des politiques de rôle et des transitions de paiement, puis des tests navigateur pour les parcours mobile, manifeste et impression. Il faudra également décider explicitement si un chauffeur doit voir tous les manifestes opérationnels ou seulement ceux qui lui sont affectés ; l’état actuel conserve la lecture des départs/manifestes, mais interdit désormais la vue globale des réservations.
