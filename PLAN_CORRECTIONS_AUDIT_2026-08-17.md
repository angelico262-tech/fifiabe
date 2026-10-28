# FIFIABE — Plan de corrections après audit

## Décision métier préalable

La réservation doit être confirmée comme une réservation de siège pour **tout le voyage publié**, ou comme une réservation de siège valable seulement sur un **tronçon entre deux arrêts**.

La recommandation de l’audit est l’option **A — siège bloqué pour tout le voyage** pour la première version opérationnelle. Elle correspond au fonctionnement le plus simple et le plus sûr d’un départ de taxi-brousse : un passager qui réserve un siège doit pouvoir le conserver jusqu’à sa destination, sans réattribution intermédiaire. Elle évite qu’un même siège soit revendu par erreur, simplifie le manifeste et correspond au calcul actuel de capacité.

Dans cette option, les arrêts intermédiaires servent à indiquer le lieu de montée et la destination, à filtrer les listes et à informer l’opérateur ; ils ne modifient pas le prix ni la capacité du départ. Le tarif affiché par l’opérateur est donc le tarif par siège pour le départ publié, indépendamment du tronçon.

## Corrections prioritaires proposées

| Priorité | Domaine | Correction | Motif |
|---|---|---|---|
| P0 | Visibilité opérateur | Permettre à l’opérateur responsable d’un arrêt de voir les réservations dont `boardingStopId` correspond à son arrêt, tout en laissant à l’opérateur du départ principal la vue globale du voyage ; l’admin voit tout. | Corrige la plainte principale sans casser les droits de publication. |
| P0 | Cohérence des droits | Centraliser une règle explicite `canViewBooking`, distincte de `canManageTrip`. La vérification, l’annulation et la liste doivent appliquer la même politique. | Évite qu’une réservation soit visible mais impossible à traiter, ou inversement. |
| P0 | Paiement | Rendre la déclaration idempotente et borner le montant à `priceAtBookingAr`; refuser une nouvelle déclaration après `CONFIRMED`; conserver la date et l’agent de vérification. | Évite les doublons, les montants incohérents et les confirmations accidentelles. |
| P0 | Réservation | Conserver la réservation immédiate du siège, mais afficher clairement `PENDING_PAYMENT` comme “siège réservé — paiement à confirmer”. | Le statut `FULL` repose actuellement sur les sièges bloqués, pas uniquement sur les paiements confirmés. |
| P1 | Manifeste | Ajouter des filtres par statut, arrêt de montée, destination et recherche passager ; afficher les réservations annulées séparément ou les masquer par défaut. | Rend la liste exploitable par arrêt et par départ. |
| P1 | Publication | Inclure les brouillons dans le contrôle de conflit de véhicule, ou mieux empêcher deux voyages du même véhicule à la même date/heure dès la création/publication. | Évite les conflits tardifs entre brouillons. |
| P1 | Véhicule | Ajouter un code d’affichage au niveau de `Trip` si le numéro saisi par l’opérateur peut changer selon le départ ; ne pas renommer rétroactivement l’identité historique du véhicule. | Protège les anciens reçus et réservations. |
| P1 | Statuts | Définir `PUBLISHED` comme seul statut public réservable ; réserver `SCHEDULED` à un usage futur ou le retirer des recherches publiques. | Évite la duplication entre “programmé” et “publié”. |
| P2 | Liste d’attente | Après annulation, permettre à l’opérateur de contacter puis de convertir manuellement une entrée en réservation ; journaliser le changement de statut. | La réponse actuelle indique le prochain contact mais ne fait pas progresser la liste. |
| P2 | Reçus | Finaliser un reçu imprimable avec état de paiement, montant déclaré, solde, arrêts, véhicule, sièges et consigne “confirmation après vérification”. | Rend le parcours utilisable sans compte ni SMS. |
| P2 | Validation | Ajouter des tests métier backend : arrêt de montée/destination, double réservation, annulation/libération, visibilité par opérateur, paiement répété, véhicule en conflit. | Empêche les régressions futures. |

## Correction à ne pas appliquer sans changement de décision

Il ne faut pas implémenter maintenant une capacité par segment, car cela nécessiterait une nouvelle logique de chevauchement des intervalles, une disponibilité calculée entre chaque paire d’arrêts, une sélection de sièges conditionnelle au segment et un manifeste par tronçon. Cette extension pourra être ajoutée plus tard, mais elle ne doit pas être mélangée à la correction de visibilité et de paiement.

## Ordre d’implémentation recommandé

1. Valider l’option A de capacité globale du voyage.
2. Corriger les droits de visibilité et les filtres opérateur.
3. Corriger le cycle de paiement et les contrôles d’idempotence.
4. Stabiliser les statuts publics et la publication des véhicules.
5. Finaliser reçu, liste d’attente et tests métier.
6. Mettre à jour la traçabilité et fournir les commandes d’installation/migration/seed.

Aucune migration de schéma ne doit être lancée avant d’avoir validé les changements nécessaires ; les corrections backend de visibilité et de paiement peuvent d’abord être faites sans migration.
