# Audit logique métier FIFIABE — constats préliminaires

## Règles de référence

- Deux directions : Tana → SAVA et SAVA → Tana.
- Ordre SAVA → Tana : Antalaha → Andapa → Sambava → Ampanefena → Vohemar → Tana.
- Tana → SAVA est l’ordre inverse.
- Le hub opérationnel est Sambava ; les navettes Antalaha/Andapa rejoignent le bus principal à Sambava.
- Départs métier : mardi, jeudi, samedi à 13h00 ; 9 véhicules ; 17 places ; tarif de référence 50 000 Ar, mais l’opérateur publie le tarif et l’avance.
- Le passager n’a pas de compte : réservation par nom/téléphone, référence FIF-XXXXXXXXXX pour le suivi.
- Le paiement est déclaré par le passager puis vérifié manuellement par l’opérateur.
- Les départs sont publiés par un opérateur responsable de l’arrêt ; l’administrateur a une vue globale.

## Constats techniques

1. Le schéma modélise deux routes et des RouteStop ordonnés, mais un voyage ne possède qu’un seul `departureStopId`. C’est cohérent pour publier un départ local, mais l’autorisation opérateur repose sur l’arrêt de départ du voyage et non sur l’arrêt de montée de chaque réservation.

2. `POST /api/bookings` valide seulement que montée < destination dans l’ordre de la route et crée les sièges au niveau du voyage. Il ne réserve pas une capacité par segment. Donc un siège réservé Antalaha → Sambava bloque le siège pour tout le voyage, y compris Sambava → Tana. Cette règle doit être validée métier ; si le véhicule est considéré comme un départ unique avec passagers présents sur tout le trajet, c’est acceptable. Si les sièges sont réattribuables aux arrêts intermédiaires, le modèle actuel est insuffisant.

3. Le frontend envoie bien `boardingStopId` et `destinationStopId`, propose les arrêts intermédiaires, et force la destination après la montée. En revanche, le prix affiché et la disponibilité sont toujours ceux du voyage complet ; aucune tarification par tronçon n’existe.

4. L’interface opérateur appelle `GET /api/admin/bookings`. Cette route existe et filtre les opérateurs par `trip.departureStopId = managedStopId`, pas par `booking.boardingStopId`. Une réservation faite depuis un arrêt intermédiaire n’est visible que dans le manifeste du voyage dont l’arrêt de publication correspond à l’opérateur, ou par l’admin. Cela peut expliquer la plainte de visibilité si l’utilisateur attend qu’un opérateur voie les passagers embarquant à son propre arrêt, même quand le départ publié est Sambava.

5. Le manifeste renvoie tous les bookings du voyage, y compris `PENDING_PAYMENT`, `PAYMENT_DECLARED`, `CONFIRMED` et `CANCELLED`; le compteur exclut seulement les annulations. C’est adapté à une liste de gestion, mais l’interface ne distingue pas clairement les places temporairement bloquées des places confirmées payées.

6. La déclaration de paiement accepte un montant supérieur au prix total sans plafond et peut être répétée après une déclaration ; elle ne refuse pas explicitement une réservation déjà confirmée. La vérification opérateur passe directement `PAYMENT_DECLARED` → `CONFIRMED` sans enregistrer le montant effectivement vérifié ni contrôler une référence déjà utilisée. Il faut décider si un paiement partiel/surplus est autorisé et ajouter des contrôles d’idempotence.

7. L’annulation supprime les SeatBooking puis libère la place, ce qui est fonctionnel. Toutefois, la logique liste d’attente ne réserve pas automatiquement une place et ne change pas le statut de l’entrée ; elle ne fait que retourner le prochain contact à l’interface.

8. Le frontend propose des alternatives seulement pour le même `routeId` et les dates futures. Il ne filtre pas explicitement les alternatives selon le tronçon demandé. Comme la disponibilité est actuellement globale au voyage, cela reste cohérent uniquement avec la règle “un siège est bloqué pour tout le voyage”.

9. La sélection du véhicule met à jour le `Vehicle.code` global. Cela signifie qu’un opérateur qui change le numéro d’un véhicule modifie l’identifiant affiché pour les anciens voyages et réservations. Si le numéro doit être propre à un départ, il faut un champ de code affiché au niveau de `Trip`; si le numéro est réellement l’identité physique du véhicule, le comportement actuel est acceptable mais l’historique est moins stable.

10. La contrainte unique `Trip(departureAt, routeId, vehicleId)` et le contrôle de conflit ne considèrent que les voyages `PUBLISHED` et `FULL`. Deux brouillons peuvent donc partager un véhicule au même horaire, puis le second peut être publié avant que le premier soit publié. Il faut décider si les brouillons doivent aussi bloquer l’affectation.

11. Le statut `FULL` est fixé au nombre de SeatBooking, y compris les réservations dont le paiement n’est pas encore confirmé. Cela correspond à une conservation immédiate du siège après réservation, mais doit être affiché comme “siège réservé / paiement à confirmer”, pas comme capacité définitivement vendue.

12. L’état `SCHEDULED` est accepté par les recherches publiques, mais la publication opérateur force toujours `PUBLISHED` ou `FULL`. Il existe donc une duplication sémantique entre `SCHEDULED` et `PUBLISHED` qui doit être clarifiée.

## Point bloquant à valider avant modification

La décision structurante est la capacité par segment :

- Option A : un voyage publié à 13h est un véhicule unique et chaque siège réservé est indisponible pour tout le voyage. Le modèle actuel est presque cohérent ; il faut surtout corriger visibilité opérateur, paiement, filtres et historique du véhicule.
- Option B : un même véhicule peut vendre le même siège sur plusieurs segments successifs. Il faut alors ajouter une logique de chevauchement de segments, calculer la disponibilité par tronçon et empêcher uniquement les réservations dont l’intervalle se chevauche. Le manifeste doit être filtrable par arrêt de montée/destination.

Sans cette décision, corriger uniquement l’interface créerait de nouvelles incohérences métier.
