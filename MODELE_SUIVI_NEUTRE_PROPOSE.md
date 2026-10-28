# Modèle technique proposé — suivi neutre FIFIABE

## Objectif

Cette évolution ne fixe pas encore la commission. Elle conserve les données réelles et prépare des simulations filtrables pour permettre au `SUPER_ADMIN` de négocier ultérieurement avec des historiques fiables.

## 1. Origine des réservations

Ajouter un enum Prisma :

```prisma
enum BookingOrigin {
  PASSENGER_APP
  COUNTER
  LEGACY_UNKNOWN
}
```

Ajouter dans `Booking` :

```prisma
origin          BookingOrigin @default(PASSENGER_APP)
createdById     String?
createdAtStopId String?
createdBy       User?         @relation("BookingCreator", fields: [createdById], references: [id], onDelete: SetNull)
createdAtStop   Stop?         @relation("BookingCreationStop", fields: [createdAtStopId], references: [id], onDelete: SetNull)
```

`PASSENGER_APP` sera utilisé par le parcours public. `COUNTER` sera utilisé par le formulaire guichet connecté d’un opérateur ou d’un administrateur. `LEGACY_UNKNOWN` protégera l’historique existant lorsqu’il est impossible de prouver l’origine d’une ancienne réservation.

## 2. Historique financier neutre

Ne pas créer de commission officielle tant que la règle n’est pas décidée. Ajouter seulement des champs d’observation et de simulation séparés des données contractuelles :

```prisma
model CommissionSimulation {
  id                 String   @id @default(cuid())
  createdById        String
  createdAt          DateTime @default(now())
  from               DateTime?
  to                 DateTime?
  basis              String   // PRICE_GROSS ou AMOUNT_PAID
  method             String   // PERCENTAGE ou FIXED_AMOUNT
  assumedPercentage  Decimal? @db.Decimal(8, 4)
  assumedFixedAr     Int?
  reservationCount   Int
  seatCount          Int
  grossAmountAr      Int
  paidAmountAr       Int
  simulatedAmountAr  Int
  note               String?
  createdBy          User     @relation("SimulationCreator", fields: [createdById], references: [id])
}
```

Cette table conserve les simulations demandées par le `SUPER_ADMIN`, mais aucune simulation ne modifie une réservation ni ne devient une dette automatique. Les valeurs réelles restent dans les réservations et les paiements.

## 3. Filtres avancés

La route de rapport super administrateur doit accepter des filtres combinables : `createdFrom`, `createdTo`, `departureFrom`, `departureTo`, `origin`, `createdById`, `createdAtStopId`, `direction`, `vehicleId`, `vehicleCode`, `boardingStopId`, `destinationStopId`, `bookingStatus`, `paymentNetwork`, `paymentDeclared`, `reference`, `passengerName`, `passengerPhone` et `minSeats`/`maxSeats`.

Toutes les conditions doivent être réunies avec un `AND` Prisma. Les recherches texte utilisent une comparaison insensible à la casse. Les réponses doivent inclure les totaux, les regroupements par origine, les regroupements par arrêt et les réservations détaillées nécessaires à l’export CSV.

## 4. Réservation guichet

Le formulaire guichet doit réutiliser les contrôles du parcours public : voyage publié, sièges disponibles, arrêts cohérents, destination située après la montée, prix et avance provenant du départ publié. Il ne doit pas créer une deuxième logique de capacité.

Le guichet doit saisir au minimum le nom et le téléphone du passager, les sièges, l’arrêt de montée, la destination et le statut de paiement. Le système enregistrera automatiquement l’opérateur connecté comme créateur et son arrêt comme arrêt de saisie.

Le reçu doit indiquer clairement : `Réservation saisie au guichet par [opérateur]`. Une réservation guichet reste consultable par référence comme une réservation publique.

## 5. Super administrateur

Ajouter `SUPER_ADMIN` à `UserRole` et modifier toutes les vérifications backend pour que ce rôle ait une visibilité globale. Le frontend ne doit jamais être le seul endroit où une permission est appliquée.

Le tableau super administrateur doit proposer quatre vues : activité, réservations, simulations de commission et plaintes/avis. Les vues réservations et activité doivent pouvoir exporter les résultats filtrés en CSV et imprimer un état de synthèse.

## 6. Migration des anciennes données

Aucune ancienne réservation ne doit être supprimée. Une migration peut appliquer `PASSENGER_APP` aux réservations existantes uniquement si l’origine est certaine dans les données actuelles. Dans le cas contraire, appliquer `LEGACY_UNKNOWN`. Il faut vérifier le contenu réel avant de choisir la valeur par défaut de migration.

## 7. Validation obligatoire avant implémentation

Avant d’écrire la migration, valider :

| Sujet | Proposition |
|---|---|
| Origines | `PASSENGER_APP`, `COUNTER`, `LEGACY_UNKNOWN` |
| Simulation | Historisée, non contractuelle, sans effet sur les réservations |
| Base de simulation | Choix temporaire entre prix brut et montant payé |
| Guichet | Même capacité et mêmes règles d’arrêts que le parcours public |
| Super administrateur | Visibilité globale et gestion des rapports |
| Anciennes réservations | Ne jamais inventer une origine ; utiliser `LEGACY_UNKNOWN` si nécessaire |
