# Mise à jour FIFIABE — Opérateurs, paiement Mobile Money et liste d’attente

> Cette archive est conçue pour être installée **sur votre projet FIFIABE déjà fonctionnel**. Elle ne contient ni mot de passe Supabase ni fichier `.env`.

## Ce que cette mise à jour ajoute

| Fonction | Résultat |
|---|---|
| Opérateurs par arrêt | Chaque opérateur gère et publie uniquement les départs de son arrêt |
| Publication | Véhicule, tarif, avance, rendez-vous, téléphone et comptes MVola/Orange/Airtel configurables |
| Paiement | Déclaration par le passager, puis vérification manuelle par l’opérateur |
| Référence | Référence unique `FIF-XXXXXXXXXX` pour suivre une réservation sans compte |
| Bon de réservation | Consultation, impression ou téléchargement depuis `/suivi` |
| Départ complet | Propositions d’autres dates et inscription sur liste d’attente |
| Administration | Liste de passagers, validation, annulation et filtres avancés |

## Important avant de commencer

Fermez les deux fenêtres noires où le backend et le frontend sont en cours d’exécution. Dans chaque fenêtre, pressez une seule fois **Ctrl + C**. Ne modifiez pas le fichier `backend\.env` : vos paramètres Supabase et votre secret sont déjà correctement configurés.

## Les 5 fichiers à remplacer

Après décompression, ouvrez le dossier `operations-payment-update`. Copiez chacun des cinq fichiers ci-dessous dans votre projet existant, en acceptant le remplacement lorsque Windows le demande.

| Fichier dans cette archive | Emplacement à remplacer dans votre projet |
|---|---|
| `backend\prisma\schema.prisma` | `fifiabe\backend\prisma\schema.prisma` |
| `backend\prisma\seed.ts` | `fifiabe\backend\prisma\seed.ts` |
| `backend\src\index.ts` | `fifiabe\backend\src\index.ts` |
| `frontend\src\App.tsx` | `fifiabe\frontend\src\App.tsx` |
| `FIFIABE_DEVELOPMENT_TRACEABILITY.md` | `fifiabe\FIFIABE_DEVELOPMENT_TRACEABILITY.md` |

Le dossier cible de votre projet est normalement :

```text
C:\Users\Windows 10 Pro\Documents\fifiabe-source\fifiabe
```

## Commandes à exécuter, une fois les fichiers remplacés

Ouvrez une nouvelle fenêtre noire, puis copiez ces commandes **une seule à la fois**. Attendez la fin complète d’une commande avant de passer à la suivante.

### 1. Ouvrir le dossier backend

```cmd
cd "%USERPROFILE%\Documents\fifiabe-source\fifiabe\backend"
```

### 2. Regénérer Prisma

```cmd
pnpm prisma:generate
```

### 3. Créer et appliquer la migration de base de données

```cmd
pnpm prisma:migrate --name add_operator_payment_waitlist
```

> Gardez Internet actif pendant cette étape. Si un message `P1001` apparaît, attendez une minute puis relancez seulement cette commande.

### 4. Préparer les arrêts, les opérateurs et les brouillons de départ

```cmd
pnpm seed
```

Cette commande utilise des `upsert` : elle ne supprime pas les réservations existantes et ne modifie pas un voyage qui contient déjà des places réservées.

### 5. Démarrer le backend

```cmd
pnpm dev
```

Laissez cette fenêtre ouverte. Le message attendu est :

```text
Server listening at http://127.0.0.1:3000
```

### 6. Démarrer le frontend dans une seconde fenêtre noire

```cmd
cd "%USERPROFILE%\Documents\fifiabe-source\fifiabe\frontend"
pnpm dev -- --port 5173
```

Ouvrez ensuite :

```text
http://127.0.0.1:5173/
```

## Premier essai recommandé

1. Ouvrez `http://127.0.0.1:5173/admin`.
2. Connectez-vous avec `operateur.sambava@fifiabe.mg` et le mot de passe de démonstration `Operateur123!`.
3. Cliquez sur **Publier / modifier** pour un brouillon Sambava.
4. Choisissez un véhicule, saisissez le tarif, l’avance éventuelle, un point de rendez-vous et au moins un compte Mobile Money, puis publiez.
5. Ouvrez `http://127.0.0.1:5173/` pour rechercher le départ en tant que passager.

Les comptes de démonstration supplémentaires sont listés dans `FIFIABE_DEVELOPMENT_TRACEABILITY.md`. Ils doivent être remplacés par de vrais comptes et mots de passe avant toute mise en production.

## Fichiers à ne jamais partager

Ne transmettez jamais `backend\.env`, `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET` ni votre mot de passe Supabase. Ces éléments ne sont pas nécessaires pour appliquer cette archive.
