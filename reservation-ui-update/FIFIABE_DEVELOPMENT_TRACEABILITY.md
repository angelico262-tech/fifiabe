# FIFIABE — Traçabilité technique et dossier de reprise

> **Objectif de ce fichier** : permettre à une nouvelle IA développeuse ou à un développeur humain de comprendre immédiatement le projet FIFIABE, son architecture, ses décisions, son état réel et la manière de poursuivre le développement sans perdre le contexte.

**Dernière mise à jour :** 14 août 2026  
**Responsable fonctionnel :** Chef de projet FIFIABE  
**Rôle de l’IA développeuse :** Ingénieur principal full-stack et architecte sécurité  
**Langue de travail :** Français simple pour les explications, anglais accepté dans le code lorsque les conventions l’exigent.

---

## 1. Contexte métier

FIFIABE est une application de réservation de taxi-brousse pour une coopérative de Madagascar. La ligne relie **Antananarivo** à la région **SAVA** et fonctionne dans les deux sens.

Le hub opérationnel est **Sambava**. Les navettes d’**Antalaha** et d’**Andapa** rejoignent le bus principal à Sambava.

| Élément | Règle métier validée |
|---|---|
| Véhicules | 9 véhicules |
| Capacité | 17 places par véhicule |
| Départs | Mardi, jeudi et samedi |
| Heure | 13 h 00 |
| Tarif | 50 000 Ar |
| Direction SAVA → Tana | Antalaha → Andapa → Sambava → Ampanefena → Vohemar → Tana |
| Direction Tana → SAVA | Trajet inverse, avec Sambava comme hub |

---

## 2. Charte visuelle

La préférence visuelle officielle communiquée par le chef de projet est **rouge et blanc**. Les couleurs suivantes sont actuellement utilisées dans l’application :

| Usage | Couleur |
|---|---|
| Rouge principal | `#C62828` |
| Marron de structure, conservé comme couleur secondaire | `#6B3A2A` |
| Orange d’action, conservé pour les boutons | `#E67E22` |
| Blanc cassé de fond | `#FAF8F5` |
| Blanc | `#FFFFFF` |
| Texte foncé | `#1F2937` |
| Succès / disponibilité | `#2E7D32` |

La future sélection de sièges doit respecter la convention suivante : siège libre blanc, siège sélectionné vert, siège occupé rouge.

---

## 3. Architecture technique imposée

Le projet est un monorepo pnpm sans Docker.

```text
fifiabe/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── seed.ts
│   │   └── migrations/
│   ├── src/
│   │   ├── config/env.ts
│   │   ├── routes/health.routes.ts
│   │   └── index.ts
│   ├── .env
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/App.tsx
│   ├── src/main.tsx
│   ├── src/index.css
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   ├── vite.config.ts
│   └── postcss.config.cjs
├── pnpm-workspace.yaml
├── README.md
└── FIFIABE_DEVELOPMENT_TRACEABILITY.md
```

### Backend

Le backend utilise Node.js, Fastify, TypeScript, Prisma et PostgreSQL hébergé par Supabase. Le serveur doit écouter sur `127.0.0.1`, jamais sur toutes les interfaces réseau.

Les accès à la base de données et les secrets doivent toujours rester dans `backend/.env`. Les requêtes vers PostgreSQL passent exclusivement par Prisma. Aucun SQL construit par concaténation ne doit être ajouté.

### Frontend

Le frontend utilise Preact, Vite et Tailwind CSS. Le frontend communique avec le backend local sur `http://127.0.0.1:3000`.

Le port frontend peut être `5173` ou `5174` selon les ports déjà utilisés. La valeur `CORS_ORIGIN` du backend doit correspondre exactement à l’URL utilisée dans le navigateur.

---

## 4. Base de données et seed

Le schéma Prisma actuel contient les concepts suivants : utilisateurs, routes, arrêts, véhicules, voyages et réservations. La migration initiale a été appliquée avec succès sur Supabase.

Le seed a été exécuté avec succès et a créé :

- 9 véhicules ;
- 2 routes correspondant aux deux directions ;
- les arrêts SAVA ;
- les utilisateurs de test prévus par le seed ;
- les voyages des quatre prochaines semaines.

Résultat confirmé dans le terminal :

```text
Seed FIFIABE terminé : 9 véhicules, 2 routes.
```

La base est actuellement synchronisée avec le schéma Prisma grâce à la migration :

```text
20260813204342_init
```

**Attention :** ne relancer `prisma migrate dev` que lorsqu’une modification réelle du schéma a été ajoutée. Le seed doit être idempotent autant que possible afin d’éviter les doublons.

---

## 5. Variables d’environnement

Le fichier réel `backend/.env` existe uniquement sur l’ordinateur local et ne doit jamais être envoyé dans une archive ou un dépôt public.

Variables attendues :

```env
DATABASE_URL="URL_POSTGRESQL_SUPABASE"
DIRECT_URL="URL_POSTGRESQL_SUPABASE"
JWT_SECRET="SECRET_LONG_ET_UNIQUE"
HOST="127.0.0.1"
PORT="3000"
CORS_ORIGIN="http://127.0.0.1:5173"
```

Dans l’installation Windows actuelle, la connexion directe Supabase sur `db.*.supabase.co:5432` n’était pas joignable. La connexion **Session pooler** suivante a été utilisée avec succès :

```text
aws-1-eu-west-1.pooler.supabase.com:5432
```

Ne jamais écrire le mot de passe réel dans ce document. Ne jamais transmettre l’URL PostgreSQL complète dans une conversation ou une capture d’écran.

---

## 6. Commandes d’installation et de fonctionnement

Depuis le dossier racine du projet :

```cmd
pnpm install
```

Depuis `backend` :

```cmd
pnpm prisma:generate
pnpm prisma:migrate --name init
pnpm seed
pnpm dev
```

Depuis une deuxième fenêtre, dans `frontend` :

```cmd
pnpm dev -- --port 5173
```

Adresses de vérification :

```text
Backend :  http://127.0.0.1:3000/health
Frontend : http://127.0.0.1:5173/
```

Le endpoint backend doit retourner :

```json
{"status":"ok"}
```

---

## 7. Fonctionnalités déjà validées

| Fonctionnalité | État | Vérification |
|---|---|---|
| Projet Supabase créé | Terminé | Tableau de bord Supabase accessible |
| Connexion PostgreSQL | Terminé | Migration réussie avec Session pooler |
| Prisma Client | Terminé | Génération v6.19.3 réussie |
| Migration initiale | Terminé | Base synchronisée |
| Seed métier | Terminé | 9 véhicules et 2 routes créés |
| Backend Fastify | Terminé | `/health` retourne `{"status":"ok"}` |
| Frontend Preact/Vite | Terminé | Page FIFIABE visible |
| Charte graphique | Terminé | Rouge, blanc, marron et orange visibles |
| Recherche de voyages | Terminé | `GET /api/trips` retourne les départs |
| Places disponibles | Terminé pour affichage | Calcul basé sur la capacité et les réservations existantes |
| Réservation avec choix de siège | Validée de bout en bout | Recherche, choix d’un siège, création Supabase et affichage du siège occupé vérifiés manuellement |

---

## 8. API actuellement disponible

### `GET /health`

Vérifie que le backend est démarré.

### `GET /api/trips`

Recherche les voyages par date et direction.

Exemple de forme d’appel :

```text
http://127.0.0.1:3000/api/trips?date=2026-08-18&direction=TANA_TO_SAVA
```

Directions reconnues :

```text
TANA_TO_SAVA
SAVA_TO_TANA
```

La réponse contient notamment l’identifiant du voyage, l’heure de départ, le prix, le véhicule, la capacité, le nombre de places réservées et le nombre de places disponibles.

---

## 9. Réservation avec plan de 17 sièges — état validé

Le modèle final est **Volant non sélectionnable + sièges passagers 1 à 17**. Il respecte la capacité métier officielle de 17 places, même si l’image de référence initiale montrait une numérotation de 2 à 19.

La représentation visuelle doit reproduire une disposition réaliste de taxi-brousse : un poste de conduite à l’avant gauche, un siège passager avant à droite, quatre rangées de milieu avec banquette double à gauche, couloir central et siège à droite, puis une banquette arrière de quatre sièges. Cette disposition représente exactement 17 places passagers : siège 1 à l’avant, sièges 2 à 13 dans les quatre rangées intermédiaires et sièges 14 à 17 sur la banquette arrière.

| État | Aspect | Sélectionnable |
|---|---|---|
| Libre | Blanc, bordure beige | Oui |
| Sélectionné | Vert | Oui, annulation possible |
| Occupé | Rouge | Non |
| Volant | Zone grise ou beige | Non |

Le frontend appelle `GET /api/trips/:tripId/seats` lors de l’ouverture du plan puis `POST /api/bookings` lors de la confirmation. La transaction Prisma crée la réservation et les enregistrements `SeatBooking`. La contrainte `@@unique([tripId, seatNumber])` interdit techniquement l’occupation du même siège par deux réservations sur le même voyage.

### Incident résolu : délai de transaction Supabase / Prisma

Lors du premier test complet, le navigateur a affiché « Impossible d’enregistrer la réservation ». Les journaux Fastify ont confirmé que le navigateur envoyait correctement `OPTIONS /api/bookings` puis `POST /api/bookings`. Le backend retournait toutefois Prisma `P2028` : `Unable to start a transaction in the given time`.

La cause était le délai par défaut trop court pour amorcer une transaction interactive via le Session pooler Supabase. La correction consiste à construire le client Prisma avec les options suivantes dans `backend/src/index.ts` :

```ts
const prisma = new PrismaClient({
  transactionOptions: {
    maxWait: 15000,
    timeout: 30000,
    isolationLevel: 'Serializable',
  },
});
```

Après enregistrement du fichier, `tsx watch` redémarre le backend automatiquement. Aucune migration Prisma supplémentaire n’est nécessaire pour cette correction.

### Validation manuelle effectuée le 14 août 2026

Une réservation de test a été créée avec succès après application de la correction. Après rechargement du même voyage, le siège 3 est devenu indisponible, confirmant l’écriture effective dans Supabase et la prévention de la double réservation.

---

## 10. Historique des décisions et modifications

### Étape 1 — Initialisation

Le scaffolding automatique WebDev a expiré à deux reprises. Le monorepo a donc été créé manuellement dans le respect des contraintes imposées : backend Fastify/Prisma et frontend Preact/Vite/Tailwind, sans Docker.

### Étape 2 — Configuration Supabase

La connexion directe Supabase sur `db.*.supabase.co:5432` a retourné Prisma `P1001`. La connexion Session pooler sur `aws-1-eu-west-1.pooler.supabase.com:5432` a ensuite fonctionné.

### Étape 3 — Correction Prisma

Le premier fichier Prisma avait des blocs écrits sur une seule ligne, ce qui provoquait des erreurs de validation. Le schéma a été reformatté avec des blocs multiline. `prisma generate` puis `prisma migrate` ont réussi.

### Étape 4 — Fonctionnalité de recherche

Le backend a reçu l’endpoint Prisma `GET /api/trips`. Le frontend interroge cet endpoint et affiche les départs avec prix, horaire, véhicule et places disponibles.

### Étape 5 — Résolution du CORS local

Vite a utilisé successivement les ports `5173` et `5174`. Le backend a été configuré avec `CORS_ORIGIN` correspondant au port frontend actif. La liaison frontend-backend est maintenant confirmée par l’affichage **Backend OK**.

### Étape 6 — Modèle de réservation par siège

Le modèle retenu est `Volant` non sélectionnable plus 17 sièges passagers numérotés de 1 à 17. Le schéma Prisma reçoit le modèle `SeatBooking`, relié à `Trip` et `Booking`. La contrainte `@@unique([tripId, seatNumber])` empêchera qu’un même siège soit réservé deux fois pour le même voyage.

La migration doit être exécutée localement après remplacement du fichier `backend/prisma/schema.prisma` :

```cmd
pnpm prisma:generate
pnpm prisma:migrate --name add_seat_bookings
```

### Étape 7 — API et interface de réservation par siège

Le backend expose désormais `GET /api/trips/:tripId/seats` pour retourner les 17 sièges et leur état, ainsi que `POST /api/bookings` pour enregistrer une réservation avec nom, téléphone et liste de sièges. La création est effectuée dans une transaction Prisma et la contrainte unique sur `(tripId, seatNumber)` protège contre les doubles réservations.

Le frontend affiche le plan de sièges, la zone Volant non sélectionnable, les états libre/sélectionné/occupé et le formulaire de réservation.

La migration `20260814094706_add_seat_bookings` a été appliquée avec succès sur Supabase. La vérification locale à effectuer consiste à redémarrer le backend et le frontend, rechercher un voyage, cliquer sur `Choisir mes sièges`, sélectionner des sièges puis confirmer une réservation de test.

### Étape 8 — Documentation continue

Ce fichier devient la source de vérité pour toute nouvelle IA développeuse. Il doit être mis à jour après chaque migration, nouvelle route API, modification de schéma, changement d’interface ou décision métier.

### Étape 9 — Stabilisation de la transaction de réservation

Le test manuel du `POST /api/bookings` a initialement échoué avec Prisma `P2028` (`Unable to start a transaction in the given time`) alors que CORS et l’endpoint étaient correctement configurés. La configuration globale `transactionOptions` du client Prisma a été ajoutée avec `maxWait: 15000`, `timeout: 30000` et `isolationLevel: 'Serializable'`.

**Résultat validé :** une réservation a été confirmée, puis le siège 3 est apparu occupé après rechargement du plan. La réservation transactionnelle et l’exclusivité d’un siège par voyage sont donc opérationnelles.

### Étape 10 — Parcours progressif et plan réaliste de taxi-brousse

La navigation ne doit plus reposer sur le défilement manuel. Après une recherche réussie, la page doit faire défiler automatiquement vers les départs trouvés. Après le choix d’un véhicule, elle doit faire défiler vers le plan. Une fois au moins un siège choisi, un bouton `Continuer` fait apparaître et cible le formulaire des coordonnées. Enfin, la confirmation doit faire défiler vers un écran explicite de succès. Chaque étape doit indiquer clairement ce qui a été validé et afficher un état de chargement pendant les appels réseau.

Les modifications frontend associées se concentrent dans `frontend/src/App.tsx` : introduction des états `search`, `results`, `seats`, `details` et `confirmed`, références de défilement, boutons d’action libellés explicitement et désactivation des boutons pendant les chargements. La logique API, la numérotation de sièges de 1 à 17 et les contraintes backend sont conservées sans changement.

### Étape 11 — Reprise après indisponibilité temporaire de Supabase

Une erreur `P1001` a été observée en développement : le backend restait actif, mais Prisma ne pouvait temporairement plus joindre le Session pooler Supabase. Le contrôle réseau TCP a confirmé que la connectivité revenait après quelques instants, puis le redémarrage du backend a rétabli les recherches et la réservation.

Le backend doit convertir les erreurs transitoires Prisma `P1001`, `P2024` et `P2028` en réponse HTTP `503` contenant `retryable: true` et un message non technique. Les routes `GET /api/trips`, `GET /api/trips/:tripId/seats` et `POST /api/bookings` doivent appliquer ce traitement, tout en gardant les erreurs métier et les conflits de sièges distincts.

Le frontend doit afficher un bouton de relance adapté à chaque étape : `Réessayer la recherche`, `Recharger le plan des sièges` ou `Actualiser les sièges avant de confirmer à nouveau`. Pour une réservation échouée de manière transitoire, il ne faut pas soumettre automatiquement la même réservation ; la disponibilité des sièges doit d’abord être actualisée afin de préserver l’exclusivité de réservation.

---

## 11. Règles pour toute future IA développeuse

Avant toute modification, lire ce fichier et `README.md`, puis vérifier l’état réel des fichiers concernés. Ne jamais supposer qu’une fonctionnalité est terminée sans test manuel ou résultat de commande.

Ne jamais supprimer les données Supabase sans confirmation explicite. Ne jamais modifier `DATABASE_URL`, `DIRECT_URL` ou `JWT_SECRET` dans ce fichier. Ne jamais commiter `backend/.env`.

Pour toute modification de schéma : modifier `backend/prisma/schema.prisma`, régénérer Prisma, créer une migration nommée, puis mettre à jour le seed si nécessaire. Pour toute modification API : documenter la route, ses paramètres, sa réponse et ses erreurs dans ce fichier. Pour toute modification UI : conserver la charte rouge et blanche et vérifier l’interface dans le navigateur.

Chaque nouvelle entrée d’historique doit préciser la date, le problème ou besoin, les fichiers modifiés, la commande de vérification et le résultat observé.

---

## 12. Journal des prochaines actions

- [x] Confirmer le plan `Volant + sièges passagers 1 à 17`.
- [x] Ajouter le modèle de réservation et le modèle de siège réservé dans Prisma.
- [x] Appliquer la migration `add_seat_bookings` sur Supabase.
- [ ] Adapter le seed sans créer de fausses réservations.
- [x] Ajouter l’endpoint de disponibilité des sièges par voyage.
- [x] Créer le plan de sièges interactif dans le frontend.
- [x] Ajouter le formulaire nom, téléphone et sélection de sièges.
- [x] Ajouter la création transactionnelle d’une réservation.
- [x] Configurer les délais de transaction Prisma pour le Session pooler Supabase.
- [x] Vérifier manuellement la prévention de double réservation : siège 3 occupé après confirmation.
- [x] Ajouter une progression visible : recherche, véhicule, sièges, coordonnées et confirmation.
- [x] Adapter le plan visuel à la configuration conduite avant, couloir central et banquette arrière de 17 places.
- [x] Ajouter des messages compréhensibles et des actions de reprise après indisponibilité temporaire de Supabase.
- [ ] Ajouter une confirmation imprimable ou téléchargeable.
- [ ] Ajouter des tests backend automatisés pour la réservation, les conflits de sièges et les délais de transaction.
- [ ] Créer le tableau de gestion des réservations pour la coopérative.
- [x] Mettre à jour ce fichier après la correction de réservation.

---

## 13. Message de reprise pour une IA développeuse

> Tu reprends le projet FIFIABE. Commence par lire `FIFIABE_DEVELOPMENT_TRACEABILITY.md`, `README.md`, `backend/prisma/schema.prisma`, `backend/prisma/seed.ts`, `backend/src/index.ts` et `frontend/src/App.tsx`. Le projet utilise pnpm, Fastify, TypeScript, Prisma, Supabase PostgreSQL, Preact, Vite et Tailwind, sans Docker. Le backend écoute sur `127.0.0.1:3000`. La recherche de voyages, le parcours progressif de réservation, la disposition réaliste de `Volant + 17 sièges`, la disponibilité des sièges et la réservation transactionnelle sont validés. La page doit faire défiler automatiquement vers chaque étape et afficher un état de chargement ou de succès explicite. Le frontend doit proposer des actions de reprise après un échec transitoire, sans soumettre automatiquement une réservation. Le client Prisma doit conserver ses `transactionOptions` (`maxWait: 15000`, `timeout: 30000`, isolation `Serializable`) afin d’être fiable avec le Session pooler Supabase. Les erreurs Prisma transitoires `P1001`, `P2024` et `P2028` doivent être converties en réponse HTTP 503 réessayable. La prochaine tâche prioritaire est de créer le tableau de gestion des réservations pour la coopérative, puis d’ajouter les tests automatisés et une confirmation imprimable.

---

## 14. Références techniques

- [Prisma — Documentation officielle](https://www.prisma.io/docs)
- [Fastify — Documentation officielle](https://fastify.dev/docs/latest/)
- [Supabase — Documentation officielle](https://supabase.com/docs)
- [Preact — Documentation officielle](https://preactjs.com/guide/v10/getting-started)
- [Vite — Documentation officielle](https://vite.dev/guide/)
- [Tailwind CSS — Documentation officielle](https://tailwindcss.com/docs)
