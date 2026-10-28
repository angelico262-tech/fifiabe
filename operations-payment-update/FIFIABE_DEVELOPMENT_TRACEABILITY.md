# FIFIABE — Traçabilité technique et dossier de reprise

> **But de ce document.** Ce fichier est la source de vérité pour toute IA développeuse ou tout développeur humain qui doit reprendre FIFIABE. Il décrit les règles métier, l’architecture, l’état réel du code, les choix de sécurité et les procédures de mise à jour. Il doit être actualisé à chaque évolution fonctionnelle, migration Prisma ou changement d’infrastructure.

| Élément | Valeur |
|---|---|
| Dernière mise à jour | 16 août 2026 |
| Projet | Réservation de taxi-brousse FIFIABE, Madagascar |
| Architecture | Monorepo pnpm, Fastify/Prisma/Supabase, Preact/Vite/Tailwind |
| Serveur local | `127.0.0.1:3000` |
| Interface locale | `http://127.0.0.1:5173` |
| Base de données | PostgreSQL Supabase, accès exclusif via Prisma |
| Conteneurs | Aucun Docker autorisé |

---

## 1. Règles métier validées

FIFIABE dessert la ligne **Antananarivo (Tana) ↔ SAVA**. La desserte SAVA est structurée autour de Sambava, avec les arrêts Antalaha, Andapa, Sambava, Ampanefena et Vohemar. Dans le sens SAVA vers Tana, l’ordre de référence est **Antalaha → Andapa → Sambava → Ampanefena → Vohemar → Tana**. Le sens Tana vers SAVA utilise le trajet inverse.

| Règle | Décision implémentée |
|---|---|
| Parc | 9 véhicules identifiés `FIF-001` à `FIF-009` |
| Capacité | 17 places passagers par véhicule |
| Départs récurrents | Mardi, jeudi et samedi, à 13 h 00 |
| Tarif de référence | 50 000 Ar par place, modifiable par l’opérateur à la publication |
| Gestion des arrêts | Chaque arrêt possède un opérateur dédié et un périmètre d’accès limité |
| Publication | Un opérateur complète et publie ses propres départs : véhicule, tarif, avance, rendez-vous, téléphone et Mobile Money |
| Compte passager | Aucun compte requis ; une référence unique suffit pour le suivi |
| Paiement | MVola, Orange Money et Airtel Money ; déclaration par le passager puis vérification manuelle par le personnel |
| Réservations impayées | Conservées jusqu’au jour du départ ; seul un membre du personnel peut les annuler/libérer |
| Véhicule complet | Alternatives ultérieures proposées et inscription possible sur liste d’attente |

### 1.1 Disposition validée des 17 sièges

Le plan représente un taxi-brousse réaliste : un volant à l’avant gauche non sélectionnable, un siège passager avant, quatre rangées intermédiaires avec double siège à gauche, couloir, siège à droite, puis une banquette arrière de quatre places. Les places passagers sont numérotées de **1 à 17**.

| État visuel | Sens | Action possible |
|---|---|---|
| Blanc | Place libre | Sélection possible |
| Vert | Place sélectionnée par le passager courant | Retrait possible |
| Rouge | Place déjà réservée | Aucune |
| Gris/beige | Poste de conduite | Aucune |

La contrainte Prisma `@@unique([tripId, seatNumber])` dans `SeatBooking` est la protection technique finale contre une double attribution de siège.

---

## 2. Charte graphique et surfaces de l’application

La charte approuvée est principalement **rouge et blanche**. Les couleurs secondaires restent disponibles pour la hiérarchie, les actions et les états.

| Usage | Couleur |
|---|---|
| Rouge FIFIABE | `#C62828` |
| Marron de structure | `#6B3A2A` |
| Orange d’action | `#E67E22` |
| Blanc cassé de fond | `#FAF8F5` |
| Blanc | `#FFFFFF` |
| Succès / sélection | `#2E7D32` |

Le fichier `frontend/src/App.tsx` fournit actuellement trois surfaces distinctes basées sur le chemin de l’URL.

| Adresse | Utilisateur | Fonction principale |
|---|---|---|
| `/` | Passager | Recherche, choix de siège, réservation, déclaration Mobile Money, impression du bon |
| `/suivi` | Passager | Consultation d’une réservation avec la seule référence `FIF-XXXXXXXXXX` |
| `/admin` | Administrateur et opérateur | Publication des départs, manifeste, vérification de paiement, annulation et filtres avancés |

Le parcours public doit rester progressif : l’application affiche les résultats, le plan des places, les coordonnées et la confirmation en étapes visibles, avec chargement, messages d’erreur et boutons de réessai au lieu de laisser l’utilisateur attendre sans indication.

---

## 3. Architecture et structure du monorepo

```text
fifiabe/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma              # Source de vérité du modèle de données
│   │   ├── seed.ts                    # Référentiel métier et brouillons de départ
│   │   └── migrations/                # Historique généré par Prisma, à ne jamais modifier à la main
│   ├── src/
│   │   ├── config/env.ts              # Validation des variables d’environnement
│   │   ├── routes/health.routes.ts    # Route de santé
│   │   └── index.ts                   # Routes API, authentification et règles métier
│   ├── .env                           # Secrets locaux, jamais versionnés
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx                    # Trois surfaces de l’interface
│   │   ├── main.tsx
│   │   └── index.css
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── pnpm-workspace.yaml
├── README.md
└── FIFIABE_DEVELOPMENT_TRACEABILITY.md
```

### 3.1 Contraintes techniques non négociables

Le backend est écrit en Node.js, Fastify et TypeScript. Il écoute uniquement sur `127.0.0.1`; il ne doit jamais être exposé par un lien sur toutes les interfaces lors du développement local. Toutes les lectures et écritures PostgreSQL passent par Prisma. Les secrets, notamment la chaîne Supabase et `JWT_SECRET`, restent dans `backend/.env` et ne doivent pas être placés dans le code, une capture d’écran ou un dépôt public.

Le frontend utilise Preact, Vite et Tailwind CSS. Aucune dépendance supplémentaire n’est nécessaire pour la mise à jour opérateur/paiement : les dépendances du monorepo déjà installées suffisent.

---

## 4. Modèle de données Prisma

Le schéma complet se trouve dans `backend/prisma/schema.prisma`. La mise à jour opérationnelle étend le modèle historique de réservation par siège et exige une nouvelle migration Prisma.

| Modèle ou enum | Rôle | Points importants |
|---|---|---|
| `User` | Personnel interne | Rôles `ADMIN`, `OPERATOR`, `DRIVER`; un opérateur est associé à un unique arrêt via `managedStopId` |
| `Stop` | Arrêt de la ligne | Antalaha, Andapa, Sambava, Ampanefena, Vohemar, Tana |
| `Route` | Sens du trajet | `SAVA_TO_TANA` ou `TANA_TO_SAVA` |
| `RouteStop` | Ordre des arrêts par route | Garantit un ordre unique par route et permet de valider montée avant destination |
| `Vehicle` | Véhicule de la coopérative | Code unique, capacité 17, drapeau `active` |
| `Trip` | Départ planifié | Brouillon/publication, véhicule, arrêt responsable, tarif, avance, rendez-vous et comptes Mobile Money |
| `Booking` | Réservation d’un passager | Référence unique, arrêts montée/destination, montant, statut de paiement et données de vérification |
| `SeatBooking` | Place affectée | Contrainte unique `(tripId, seatNumber)` |
| `WaitlistEntry` | Liste d’attente | Nom, téléphone, places demandées et statut de rappel |
| `TripStatus` | Cycle du départ | `DRAFT`, `PUBLISHED`, `FULL`, `SCHEDULED` historique, `CANCELLED`, `COMPLETED` |
| `BookingStatus` | Cycle de paiement | `PENDING_PAYMENT`, `PAYMENT_DECLARED`, `CONFIRMED`, `CANCELLED` |
| `PaymentNetwork` | Réseau utilisé | `MVOLA`, `ORANGE_MONEY`, `AIRTEL_MONEY` |

### 4.1 États et invariants essentiels

| Objet | Règle à préserver |
|---|---|
| Référence | Format `FIF-` suivi de 10 caractères hexadécimaux en majuscule ; unicité vérifiée avant création |
| Siège | Une place est retenue dès la réservation, même si le paiement reste en attente, afin d’éviter toute double vente |
| Réservation | Une nouvelle réservation est créée en `PENDING_PAYMENT` |
| Déclaration | Après saisie du réseau, de la référence Mobile Money, du numéro émetteur et du montant, l’état devient `PAYMENT_DECLARED` |
| Vérification | Un opérateur autorisé ou un administrateur fait passer `PAYMENT_DECLARED` à `CONFIRMED` |
| Annulation | L’opérateur supprime les `SeatBooking`, marque la réservation `CANCELLED`, libère le siège et peut consulter la première personne en attente |
| Départ plein | Le statut passe à `FULL` une fois les 17 places attribuées ; une annulation le repasse à `PUBLISHED` si une place redevient libre |
| Arrêts | La montée doit se situer avant la destination dans l’ordre de la route |

---

## 5. Flux fonctionnels de référence

### 5.1 Publication d’un départ par l’opérateur

Le seed prépare des voyages `DRAFT` pour les quatre semaines à venir. L’opérateur connecté à `/admin` ne voit que les voyages dont son arrêt est le point de départ. Il ouvre **Publier / modifier**, affecte le véhicule, fixe le tarif par place, l’avance minimale, le point et l’heure de rendez-vous, le téléphone de contact et les coordonnées MVola, Orange Money ou Airtel Money. La route `PUT /api/staff/trips/:tripId/publication` vérifie qu’il gère bien cet arrêt, que le véhicule est actif et qu’il n’est pas déjà affecté à un autre départ public à la même date et heure.

Un départ n’est visible des passagers qu’après publication. Cette règle évite d’afficher un véhicule, un tarif ou un numéro Mobile Money non validé par l’opérateur responsable.

### 5.2 Réservation et paiement sans compte

Le passager recherche une date et un sens depuis `/`, sélectionne un départ public, choisit une ou plusieurs places, indique son nom, son téléphone, son arrêt de montée et sa destination. `POST /api/bookings` est exécuté dans une transaction Prisma Serializable avec `maxWait: 15000` et `timeout: 30000`, paramètres ajoutés après l’incident Supabase `P2028` observé en développement.

L’application délivre une référence unique, puis affiche les consignes Mobile Money décidées par l’opérateur. Le passager conserve sa référence et peut déclarer le paiement dans l’interface en saisissant le réseau, le montant, son numéro émetteur et la référence de transaction. Cette déclaration ne vaut pas confirmation automatique : le contrôle humain par l’opérateur reste obligatoire.

### 5.3 Suivi et bon imprimable

La page `/suivi` accepte exclusivement une référence de réservation valide. Elle n’exige aucun compte passager et affiche le statut, les sièges, le départ, les arrêts, le tarif, l’avance enregistrée et le solde. Le bouton **Télécharger / imprimer mon bon** utilise l’impression du navigateur. Le bon est considéré comme un reçu de situation : il précise que la confirmation finale dépend de la vérification interne du paiement.

### 5.4 Départ complet, liste d’attente et libération

Lorsqu’un départ est plein, le frontend appelle `GET /api/trips/:tripId/alternatives` pour proposer des départs ultérieurs de la même route avec des places disponibles. Le passager peut également rejoindre la liste d’attente par `POST /api/trips/:tripId/waitlist`. Si un opérateur annule une réservation impayée ou erronée, son endpoint d’annulation libère les sièges puis retourne la prochaine entrée en attente afin qu’il puisse la contacter manuellement. Aucun SMS n’est envoyé automatiquement dans la version actuelle.

---

## 6. Authentification et sécurité

Le personnel se connecte à `/admin` avec l’endpoint `POST /api/staff/login`. Une session JWT HS256 est signée avec `JWT_SECRET`, expire au bout de 8 heures et est conservée localement dans le navigateur pour la session du personnel. Après cinq échecs pour une même adresse IP, la connexion est bloquée pendant 15 minutes en mémoire du serveur.

| Catégorie | Autorisation |
|---|---|
| `ADMIN` | Vue globale, tous les départs et toutes les réservations, filtres avancés |
| `OPERATOR` | Publication, manifeste, validation de paiement et annulation seulement pour l’arrêt géré |
| `DRIVER` | Aucun accès au tableau de bord dans la version actuelle |
| Passager | Aucun JWT ; sa référence permet uniquement la lecture de sa réservation et la déclaration de paiement |

La fonction `canManageTrip` dans `backend/src/index.ts` est la règle centrale d’isolement par arrêt. Elle ne doit pas être contournée lors de développements futurs. Toute future intégration SMS, WhatsApp ou Mobile Money automatique devra ajouter une gestion de secrets, une traçabilité des appels, une vérification de signature de webhook et une limitation de débit adaptée.

> **Avant production.** Les mots de passe de démonstration et le `JWT_SECRET` doivent être remplacés. Le mécanisme actuel de blocage des tentatives est en mémoire : il convient de le déplacer dans Redis ou PostgreSQL lorsque plusieurs instances du backend seront exploitées.

---

## 7. Routes API disponibles

### 7.1 Routes publiques

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/health` | Vérification de disponibilité du backend |
| `GET` | `/api/trips?date=YYYY-MM-DD&direction=...` | Liste les départs publics et leurs places disponibles |
| `GET` | `/api/trips/:tripId/seats` | Retourne l’état des 17 places |
| `GET` | `/api/trips/:tripId/payment-info` | Retourne tarifs, avance, rendez-vous et comptes Mobile Money du départ |
| `GET` | `/api/trips/:tripId/stops` | Retourne les arrêts dans l’ordre de la route |
| `POST` | `/api/bookings` | Crée une réservation et ses places associées |
| `GET` | `/api/reservations/:reference` | Suit une réservation sans compte |
| `POST` | `/api/reservations/:reference/payment-declarations` | Déclare un paiement Mobile Money |
| `GET` | `/api/trips/:tripId/alternatives` | Propose jusqu’à six départs ultérieurs disponibles |
| `POST` | `/api/trips/:tripId/waitlist` | Inscrit un passager sur liste d’attente si le départ est complet |

### 7.2 Routes personnel protégées par Bearer JWT

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/staff/login` | Ouvre une session administrateur ou opérateur |
| `GET` | `/api/staff/vehicles` | Liste les véhicules actifs disponibles à l’affectation |
| `GET` | `/api/staff/trips` | Liste les départs du périmètre de l’utilisateur connecté |
| `PUT` | `/api/staff/trips/:tripId/publication` | Publie ou modifie un départ |
| `GET` | `/api/staff/trips/:tripId/manifest` | Liste les passagers et la liste d’attente d’un départ |
| `POST` | `/api/staff/bookings/:bookingId/verify-payment` | Confirme une déclaration Mobile Money vérifiée |
| `POST` | `/api/staff/bookings/:bookingId/cancel` | Annule une réservation et libère les places |
| `GET` | `/api/admin/bookings` | Vue filtrable : date, sens, véhicule, statut, arrêt, nom, téléphone ou référence |

Toute erreur transitoire Supabase reconnue (`P1001`, `P2024`, `P2028`) retourne un `503` avec le champ `retryable: true`. Le frontend doit conserver et afficher un bouton de réessai lorsque cette valeur est reçue.

---

## 8. Seed, comptes de démonstration et données de départ

Le script `backend/prisma/seed.ts` est idempotent : il utilise des `upsert`, ne supprime pas les réservations et ne modifie pas les voyages qui comportent déjà des sièges réservés. Il crée ou aligne les arrêts, les deux routes, les neuf véhicules, les comptes internes et les brouillons pour les quatre semaines suivantes.

| Compte de développement | Mot de passe de développement | Portée |
|---|---|---|
| `admin@fifiabe.mg` | `Admin123!` | Administration complète |
| `operateur.antalaha@fifiabe.mg` | `Operateur123!` | Antalaha |
| `operateur.andapa@fifiabe.mg` | `Operateur123!` | Andapa |
| `operateur.sambava@fifiabe.mg` | `Operateur123!` | Sambava |
| `operateur.ampanefena@fifiabe.mg` | `Operateur123!` | Ampanefena |
| `operateur.vohemar@fifiabe.mg` | `Operateur123!` | Vohemar |
| `operateur.tana@fifiabe.mg` | `Operateur123!` | Tana |

> **Sécurité.** Ces identifiants ne sont destinés qu’aux essais locaux. Avant toute mise en production, créer des comptes nominatifs avec des mots de passe robustes et supprimer ou changer les comptes de démonstration.

Les neuf véhicules sont répartis dans les brouillons de manière à ne pas attribuer le même véhicule à deux directions à la même date et heure. Les cinq opérateurs SAVA reçoivent chacun un brouillon dans le sens SAVA → Tana, tandis que les quatre autres véhicules sont préparés pour les départs Tana → SAVA gérés par l’opérateur Tana.

---

## 9. Environnement local et commandes Windows

Le fichier `backend/.env` ne fait pas partie de l’archive. Il doit conserver les secrets existants; **aucune nouvelle variable d’environnement n’est requise** par cette mise à jour.

```env
DATABASE_URL="URL_POSTGRESQL_SUPABASE"
DIRECT_URL="URL_POSTGRESQL_SUPABASE"
JWT_SECRET="SECRET_LONG_UNIQUE_D_AU_MOINS_32_CARACTERES"
HOST="127.0.0.1"
PORT="3000"
CORS_ORIGIN="http://127.0.0.1:5173"
```

La connexion Supabase actuellement utilisée en développement est le **Session pooler** `aws-1-eu-west-1.pooler.supabase.com:5432`. Ne jamais recopier dans ce fichier une URL contenant le vrai mot de passe en clair dans un document partagé.

### 9.1 Installation initiale, une seule fois

Depuis le dossier racine `C:\Users\Windows 10 Pro\Documents\fifiabe-source\fifiabe` :

```cmd
pnpm install
```

### 9.2 Mise à jour opérateur/paiement sur une base existante

Après remplacement des quatre fichiers livrés, se placer dans le dossier backend et exécuter **dans cet ordre** :

```cmd
cd "%USERPROFILE%\Documents\fifiabe-source\fifiabe\backend"
pnpm prisma:generate
pnpm prisma:migrate --name add_operator_payment_waitlist
pnpm seed
```

La migration ajoute les tables, colonnes, index et enums nécessaires. Pendant la commande `prisma:migrate`, l’ordinateur doit rester connecté à Internet. Une erreur temporaire `P1001` signifie généralement que Supabase est momentanément inaccessible : attendre une minute puis relancer uniquement la même commande.

### 9.3 Démarrage quotidien

Ouvrir une première fenêtre de terminal pour le backend :

```cmd
cd "%USERPROFILE%\Documents\fifiabe-source\fifiabe\backend"
pnpm dev
```

Laisser cette fenêtre ouverte. Le message attendu est :

```text
Server listening at http://127.0.0.1:3000
```

Ouvrir ensuite une deuxième fenêtre de terminal pour le frontend :

```cmd
cd "%USERPROFILE%\Documents\fifiabe-source\fifiabe\frontend"
pnpm dev -- --port 5173
```

Ouvrir enfin `http://127.0.0.1:5173/` dans le navigateur. La vérification technique du backend reste disponible sur `http://127.0.0.1:3000/health` et doit répondre :

```json
{"status":"ok"}
```

---

## 10. Validation effectuée et plan de recette locale

La compilation stricte de cette mise à jour a été exécutée avec succès le 16 août 2026 : `pnpm prisma:generate`, `pnpm build` dans `backend`, puis `pnpm build` dans `frontend`. La migration et la recette navigateur restent à exécuter sur l’ordinateur Windows relié au projet Supabase réel.

| Test | Action | Résultat attendu |
|---|---|---|
| Connexion opérateur | Aller sur `/admin`, se connecter avec l’opérateur de l’arrêt | L’opérateur ne voit que ses départs brouillons |
| Publication | Ouvrir un brouillon, renseigner véhicule, tarif, avance et un compte Mobile Money | Le départ devient `PUBLISHED` et apparaît à la recherche publique |
| Réservation | Chercher le départ, sélectionner une place et confirmer | Référence `FIF-XXXXXXXXXX`, siège indisponible après rechargement |
| Déclaration | Entrer la référence sur `/suivi`, déclarer MVola/Orange/Airtel | Statut `PAYMENT_DECLARED` |
| Vérification | Ouvrir le manifeste opérateur puis confirmer le paiement | Statut `CONFIRMED` et bon mis à jour |
| Annulation | Annuler une réservation impayée depuis le manifeste | Siège libéré, départ réouvert si nécessaire |
| Complet | Réserver les 17 sièges d’un départ d’essai | Alternatives et liste d’attente proposées |
| Impression | Ouvrir `/suivi`, rechercher la référence, cliquer imprimer | Bon lisible avec statut et montants |
| Filtres admin | Se connecter comme admin, onglet Réservations | Filtres date, sens, véhicule, statut et recherche fonctionnent |

---

## 11. Historique technique et incidents résolus

| Étape | Décision ou incident | État |
|---|---|---|
| Initialisation | Monorepo créé sans Docker, avec Fastify, Prisma, Supabase, Preact et Vite | Terminé |
| Accès Supabase | La connexion directe `db.*.supabase.co:5432` a donné `P1001`; le Session pooler a fonctionné | Résolu |
| Prisma | Le premier schéma compact avait des erreurs de syntaxe; il a été reformatté | Résolu |
| Migration initiale | `20260813204342_init` appliquée | Validé |
| Réservation par siège | Migration `20260814094706_add_seat_bookings`, plan 17 places et contrainte unique | Validé manuellement |
| CORS local | `CORS_ORIGIN` doit correspondre exactement au port Vite utilisé | Documenté |
| Transaction Supabase | Erreur `P2028` corrigée avec `maxWait: 15000`, `timeout: 30000` et isolation `Serializable` | Validé manuellement |
| Parcours UI | Chargements, retours d’erreur, boutons de réessai et défilement vers l’étape suivante ajoutés | Implémenté |
| Opérations/paiement | Arrêts, opérateurs, publication, Mobile Money, suivi par référence, ticket, liste d’attente et filtres admin | Prêt à migrer et compiler validé |

---

## 12. Règles de maintenance pour la prochaine évolution

Avant de modifier le projet, lire ce document et sauvegarder la base Supabase. Toute modification de `schema.prisma` impose la séquence `pnpm prisma:generate`, puis `pnpm prisma:migrate --name nom_descriptif`, suivie d’un test des fonctions concernées. Ne jamais modifier manuellement un fichier déjà créé dans `backend/prisma/migrations/`.

Les fonctionnalités souhaitables mais non encore démarrées sont l’envoi SMS/WhatsApp, une procédure de changement de mot de passe pour le personnel, une gestion de comptes nominatifs en production, la mise en ligne avec HTTPS, la journalisation d’audit des opérations financières et la documentation complète de déploiement. Une intégration Mobile Money automatique devra être conçue comme un nouveau projet sécurisé : connexion officielle au prestataire, webhooks signés, idempotence, journal d’audit et procédure de rapprochement humain en cas d’écart.

Toute future IA doit préserver les principes suivants : **pas de double siège, pas de confirmation de paiement sans validation interne, pas d’accès d’un opérateur aux données des autres arrêts, pas de secret dans Git et pas de SQL manuel hors Prisma.**


## 8. Correction ergonomique et code véhicule — 16 août 2026

Après validation manuelle du tableau opérateur, les boutons d’action importants déclenchent désormais un défilement automatique après rendu vers la section concernée. Les actions « Publier / modifier » et « Liste passagers » ne laissent plus l’utilisateur chercher le formulaire ou le manifeste plus bas dans la page. Les messages de résultat sont également amenés dans la zone visible.

Le formulaire de publication comporte maintenant un champ **Numéro / code affiché du véhicule**. Le backend reçoit `vehicleCode` dans `PUT /api/staff/trips/:tripId/publication`, vérifie l’unicité du code, puis met à jour `Vehicle.code` avant la publication. Cette action reste protégée par l’authentification staff et le contrôle de périmètre de l’arrêt.

La palette principale de l’interface opérateur a été renforcée vers le rouge FIFIABE (`#C62828`) et le blanc cassé/blanc, avec l’orange conservé pour les actions et les états d’accent. Les fichiers modifiés sont `frontend/src/App.tsx` et `backend/src/index.ts`. Aucun changement de schéma ni nouvelle migration n’est nécessaire pour cette correction.

Validation locale : compilation TypeScript backend réussie et build Vite frontend réussi depuis le dossier `frontend`. Le premier appel Vite depuis la racine du monorepo a échoué uniquement parce que le répertoire de travail n’était pas `frontend`; le build relancé au bon endroit est passé.


## 9. Correction d’affectation des véhicules — 16 août 2026

Lors du premier test opérateur, plusieurs véhicules semblaient bloqués par le message « déjà affecté à un autre départ ». L’analyse a montré que la règle de conflit considérait aussi les anciens départs `SCHEDULED` issus de la version précédente. Ces départs historiques ne représentent pas une publication opérateur active.

La route `PUT /api/staff/trips/:tripId/publication` bloque désormais uniquement un véhicule déjà affecté à un autre départ simultané de statut `PUBLISHED` ou `FULL`. Les statuts `SCHEDULED` historiques restent consultables mais ne bloquent plus la publication d’un brouillon opérateur. Le contrôle d’unicité des codes véhicule demeure actif.

Validation : compilation TypeScript backend réussie. Aucun changement de schéma ni migration supplémentaire n’est requis.
