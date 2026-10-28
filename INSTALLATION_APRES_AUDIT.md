# FIFIABE — Reprise après audit métier

## Décision métier validée

Un siège réservé est bloqué pour tout le voyage lorsque le véhicule et le départ sont les mêmes. Les arrêts intermédiaires décrivent la montée et la destination ; ils ne permettent pas de revendre le même siège sur un autre tronçon.

## Fichiers corrigés

- `backend/src/index.ts` : visibilité des réservations par arrêt de montée, accès aux voyages comportant des passagers de l’arrêt opérateur, contrôles de déclaration Mobile Money, prévention des références de transaction réutilisées.
- `frontend/src/App.tsx` : affichage de l’arrêt de montée et de la destination dans le manifeste opérateur.
- `admin-dashboard-update/FIFIABE_DEVELOPMENT_TRACEABILITY.md` : décision métier et historique mis à jour.

Aucune modification du schéma Prisma n’a été nécessaire pour cette série de corrections.

## Commandes Windows

Depuis la racine du projet :

```cmd
cd "%USERPROFILE%\Documents\fifiabe-source\fifiabe"
pnpm install
```

Dans une première fenêtre, compiler puis démarrer le backend :

```cmd
cd "%USERPROFILE%\Documents\fifiabe-source\fifiabe\backend"
pnpm prisma:generate
pnpm exec tsc --noEmit
pnpm dev
```

Le backend doit répondre sur :

```text
http://127.0.0.1:3000/health
```

Dans une deuxième fenêtre, démarrer le frontend :

```cmd
cd "%USERPROFILE%\Documents\fifiabe-source\fifiabe\frontend"
pnpm dev -- --host 127.0.0.1 --port 5173
```

Ouvrir ensuite :

```text
http://127.0.0.1:5173/
http://127.0.0.1:5173/admin
http://127.0.0.1:5173/suivi
```

## Migration et seed

Comme le schéma n’a pas changé, ne lancez pas de nouvelle migration. Pour contrôler l’état de la base :

```cmd
cd "%USERPROFILE%\Documents\fifiabe-source\fifiabe\backend"
pnpm prisma migrate status
```

Ne relancez le seed que si vous souhaitez réinitialiser ou compléter les données prévues par le script, et vérifiez que le seed reste idempotent :

```cmd
pnpm seed
```

## Vérifications métier

1. Rechercher un voyage depuis Tana vers une destination SAVA intermédiaire, puis vérifier que les arrêts de montée et de destination sont proposés dans le bon ordre.
2. Choisir un siège, créer une réservation et conserver la référence `FIF-XXXXXXXXXX`.
3. Ouvrir `/admin`, charger le voyage correspondant et vérifier que le passager apparaît dans le manifeste avec ses arrêts.
4. Se connecter avec l’opérateur d’un arrêt intermédiaire et vérifier qu’il voit le voyage lorsqu’un passager monte à cet arrêt.
5. Déclarer une avance Mobile Money, puis vérifier que la réservation passe à `PAYMENT_DECLARED`.
6. Vérifier le paiement depuis le manifeste ; la réservation doit passer à `CONFIRMED`.
7. Tenter une seconde déclaration sur la même réservation : elle doit être refusée.
8. Tenter de réutiliser la même référence de transaction sur une autre réservation : elle doit être refusée.
9. Annuler une réservation et vérifier que le siège redevient disponible et que le départ complet repasse en publié.
10. Imprimer le bon depuis l’écran de confirmation ou depuis `/suivi` avec le bouton d’impression du navigateur.

## Limitation de vérification dans l’environnement de développement

La compilation automatique n’a pas pu être exécutée dans l’environnement d’audit, car Corepack a rencontré un problème de signature pnpm et les dépendances locales du projet n’y étaient pas disponibles. La commande `pnpm exec tsc --noEmit` ci-dessus doit donc être exécutée sur l’ordinateur Windows du projet, où pnpm et les dépendances ont déjà été installés.
