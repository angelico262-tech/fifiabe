# Architecture cible FIFIABE — gouvernance, avis, plaintes et manifestes

_Date de préparation : 17 août 2026_

## 1. Décision de gouvernance

Le propriétaire du service doit disposer d’un rôle distinct de l’administrateur opérationnel. Le rôle proposé est `SUPER_ADMIN`.

> Le `SUPER_ADMIN` est le propriétaire ou responsable principal de la plateforme. Il peut consulter et administrer l’ensemble des arrêts, véhicules, départs, réservations, opérateurs, chauffeurs, paiements, listes d’attente, avis et plaintes.

Le rôle `ADMIN` reste un rôle de gestion interne déléguée. Il peut gérer les départs, réservations et paiements selon les permissions qui lui sont attribuées, mais ses actions importantes doivent rester visibles dans l’historique. Le rôle `OPERATOR` reste limité à son arrêt géré. Le rôle `DRIVER` est en lecture seule sur les départs qui lui sont affectés et sur les manifestes nécessaires à son trajet.

| Rôle | Visibilité | Actions principales |
|---|---|---|
| `SUPER_ADMIN` | Tout le système | Gérer les utilisateurs, droits, arrêts, véhicules, départs, réservations, paiements, avis, plaintes et journaux |
| `ADMIN` | Tout le système ou périmètre délégué | Gérer les opérations autorisées et traiter les réservations |
| `OPERATOR` | Son arrêt et les passagers qui y montent | Publier ses départs, renseigner tarif et Mobile Money, consulter le manifeste concerné, vérifier les paiements et gérer les annulations autorisées |
| `DRIVER` | Ses départs affectés | Consulter et imprimer les manifestes ; aucune modification opérationnelle |
| Passager sans compte | Sa réservation par référence | Réserver, déclarer un paiement, consulter le suivi, déposer un avis ou une plainte |

Le compte `SUPER_ADMIN` ne doit pas être créé avec un mot de passe public permanent dans le seed de production. En développement, un compte initial peut être créé par seed, mais le mot de passe doit être changé immédiatement et le système doit empêcher son utilisation après déploiement si le mot de passe initial n’a pas été renouvelé.

## 2. Règle de réservation conservée

L’Option A reste la règle officielle : pour un même véhicule et un même départ, un siège réservé est bloqué pour l’ensemble du voyage. Les arrêts de montée et de destination servent au manifeste, à l’organisation de l’embarquement et au suivi, mais ne permettent pas de revendre le même siège sur un autre tronçon.

Le chauffeur doit voir au minimum le nom du passager, le téléphone, les sièges, l’arrêt de montée et la destination, ainsi que le statut de paiement. La version imprimée doit être exploitable sans téléphone et sans connexion après impression.

## 3. Avis et plaintes

La plateforme doit distinguer un avis général d’une plainte nécessitant une réponse et un suivi.

### 3.1 Avis passager

Un passager peut déposer un avis sans compte. La référence de réservation est facultative pour un avis général, mais elle est recommandée et devient obligatoire pour une plainte concernant un trajet précis. Les champs proposés sont : note de 1 à 5, catégorie, commentaire, référence de réservation, téléphone facultatif et consentement au contact.

Catégories recommandées : ponctualité, accueil, confort, propreté, sécurité, paiement, réservation, comportement du personnel et autre.

### 3.2 Réclamation passager

Une plainte reçoit une référence unique. Le passager peut suivre son état avec cette référence, comme pour une réservation. Les états proposés sont `NEW`, `IN_REVIEW`, `WAITING_FOR_INFORMATION`, `RESOLVED`, `REJECTED` et `CLOSED`.

Une plainte doit conserver son auteur, sa date, sa catégorie, son contenu, sa réservation éventuelle, son arrêt éventuel, son responsable, les réponses internes ou visibles au passager, les pièces jointes futures éventuelles et l’historique des changements d’état.

### 3.3 Avis et plaintes internes

Un opérateur, un administrateur ou un chauffeur connecté doit pouvoir signaler un problème opérationnel : véhicule, passager, paiement, retard, sécurité, comportement, erreur de manifeste ou problème technique. Ces signalements ne doivent pas être publics par défaut. Ils doivent être visibles par le `SUPER_ADMIN` et, selon le périmètre, par les administrateurs autorisés.

Aucune plainte ne doit être supprimée physiquement. Elle doit être archivée, avec son historique et l’utilisateur ayant effectué chaque action.

## 4. Manifestes imprimables et hors connexion

Chaque départ doit disposer de trois impressions complémentaires :

1. **Manifeste chauffeur** : liste des passagers, sièges, arrêt de montée, destination, téléphone, statut de paiement et total des places.
2. **Liste par arrêt** : regroupement des passagers par arrêt de montée, utile à chaque opérateur.
3. **Fiche de contrôle** : résumé du véhicule, date, heure, itinéraire, capacité, places réservées, places libres, paiements à vérifier et signature du chauffeur ou de l’opérateur.

L’impression doit utiliser une feuille dédiée avec `@media print`, masquer les boutons et afficher la date d’impression, le numéro du départ et un avertissement de confidentialité. Une version HTML imprimable doit fonctionner même si la connexion est perdue après le chargement. Une exportation CSV pourra être ajoutée pour les opérateurs qui souhaitent travailler dans Excel.

Le chauffeur doit pouvoir ouvrir le manifeste avant le départ, cliquer sur **Préparer l’impression**, puis imprimer. Le système ne doit pas exiger une connexion au moment du contrôle sur la route : l’information nécessaire est déjà sur papier.

## 5. Améliorations continues recommandées

Les prochaines évolutions doivent être réalisées par priorité, sans modifier plusieurs domaines métier en même temps.

| Priorité | Amélioration | Objectif |
|---|---|---|
| P0 | `SUPER_ADMIN` et permissions explicites | Sécuriser la gouvernance du service loué |
| P0 | Manifeste imprimable par départ et par arrêt | Permettre le contrôle hors téléphone et hors internet |
| P0 | Avis, plaintes et historique de traitement | Prendre en compte les réclamations et prouver leur suivi |
| P0 | Journal d’audit | Savoir qui a publié, confirmé, annulé ou modifié une donnée |
| P1 | Affectation d’un chauffeur à un départ | Limiter la visibilité chauffeur à ses missions réelles |
| P1 | Export CSV et impression dédiée | Faciliter l’archivage et le travail bureautique |
| P1 | Alertes de départ, paiement et plainte | Réduire les oublis opérationnels |
| P1 | Tableau de bord de capacité | Voir les places vendues, libres, les montées et les destinations |
| P2 | Historique des changements de véhicule et tarif | Améliorer la traçabilité commerciale |
| P2 | Modèles de SMS ou messages manuels | Informer le passager sans imposer la création d’un compte |
| P2 | Statistiques de ponctualité, remplissage et plaintes | Piloter la qualité du service |

## 6. Règles de sécurité à conserver

Tous les secrets restent dans `.env`. Les requêtes de données passent exclusivement par Prisma. Les mots de passe sont hachés. Les actions sensibles doivent vérifier le rôle côté backend, et non uniquement masquer un bouton dans le frontend. Les fichiers imprimables ne doivent pas exposer de données au-delà du départ demandé. Les références de réservation et de plainte doivent être difficiles à deviner et ne doivent pas être réutilisables.

## 7. Décisions à valider avant implémentation

Les points suivants doivent être confirmés avant la prochaine modification du schéma :

1. Le nom officiel du rôle propriétaire : `SUPER_ADMIN` est proposé.
2. Le chauffeur doit-il être affecté à un départ précis par le `SUPER_ADMIN` ou peut-il voir tous les départs d’une date ? La recommandation est une affectation précise.
3. Une plainte passager doit-elle être visible publiquement après résolution ? La recommandation est non ; seule une réponse envoyée au passager doit être visible.
4. L’impression papier du manifeste suffit-elle dans un premier temps, ou faut-il aussi générer immédiatement un fichier PDF ? La recommandation est de commencer par l’impression navigateur et l’export CSV, puis d’ajouter le PDF si nécessaire.
5. Les avis publics doivent-ils être publiés automatiquement ou validés par le `SUPER_ADMIN` ? La recommandation est une validation préalable pour éviter les abus.


## 8. Extension validée par le propriétaire du besoin — centralisation et commission

Le `SUPER_ADMIN` représente la plateforme centralisatrice et doit avoir une vue complète de l’utilisation de l’application. Son tableau de bord devra présenter au minimum le nombre de réservations initiées par les passagers, le nombre de réservations saisies au guichet, les départs publiés, les places vendues, les paiements déclarés et confirmés, les annulations, les listes d’attente, les plaintes ouvertes et la commission générée.

Chaque réservation créée dans l’application doit conserver son origine. Les origines minimales sont `PASSENGER_APP` pour une réservation initiée directement par un passager et `COUNTER` pour une réservation saisie par un opérateur au guichet. Une réservation guichet doit également conserver l’utilisateur opérateur qui l’a créée et l’arrêt de saisie. Cette distinction ne change pas la règle de capacité : dans les deux cas, les sièges sont bloqués de la même façon pour le même véhicule et le même départ.

Les réservations guichet doivent pouvoir utiliser le même cycle de paiement que les autres réservations, mais avec des statuts opérationnels plus précis. Il est recommandé de distinguer l’origine de réservation du statut de paiement : une réservation guichet peut être `PENDING_PAYMENT`, `PAYMENT_DECLARED`, `CONFIRMED` ou `CANCELLED`, tout en restant identifiée comme `COUNTER`. Le guichet pourra aussi enregistrer un paiement reçu directement, avec une note et l’utilisateur ayant constaté le paiement, sans contourner l’historique de vérification.

Chaque réservation doit générer une commission calculée selon une règle de configuration active au moment de la réservation. Le montant de la commission doit être figé dans la réservation afin que les changements futurs de tarif ou de taux ne modifient pas l’historique. Le système doit conserver le tarif brut, le montant de commission, le montant net destiné à la coopérative, la règle appliquée et le statut de reversement ou de règlement. Le `SUPER_ADMIN` doit pouvoir consulter les commissions par période, départ, véhicule, opérateur, origine de réservation et statut de paiement.

La commission ne doit être comptabilisée comme définitivement acquise qu’après la confirmation de la réservation ou selon la règle financière validée par le propriétaire. Avant cette étape, elle peut être affichée comme prévisionnelle. Une réservation annulée doit être exclue des commissions acquises, ou faire apparaître une régularisation explicite si elle avait déjà été réglée. Aucun montant ne doit être modifié silencieusement.

## 9. Routage des plaintes

Les plaintes doivent avoir un destinataire explicite. Une plainte concernant l’expérience d’un passager, un retard, un véhicule ou un embarquement peut être affectée à un opérateur ou à un administrateur selon son sujet. Une plainte concernant un opérateur, un paiement, une commission, la sécurité, une décision de gestion ou le fonctionnement de la plateforme doit pouvoir être affectée directement au propriétaire de la coopérative ou au `SUPER_ADMIN`.

Le `SUPER_ADMIN` conserve la visibilité de toutes les plaintes, même lorsqu’elles sont affectées à un autre responsable. Le propriétaire de la coopérative doit pouvoir consulter les plaintes qui lui sont affectées et répondre sans obtenir nécessairement tous les droits techniques du `SUPER_ADMIN`. Chaque réaffectation doit être historisée.

## 10. Indicateurs d’utilisation de l’application

Le tableau de bord du `SUPER_ADMIN` devra séparer les indicateurs opérationnels et financiers : réservations par origine, taux d’utilisation des départs, places réservées et confirmées, chiffre d’affaires brut, commissions prévisionnelles, commissions acquises, annulations, réservations guichet par opérateur, paiements par réseau Mobile Money, plaintes par catégorie et délai moyen de résolution.

Les indicateurs doivent être calculés à partir des données réelles de la base et non à partir de compteurs saisis manuellement. Les filtres doivent inclure au minimum une période, un arrêt, une direction, un véhicule, un opérateur, une origine de réservation et un statut de paiement.

## 11. Décisions financières encore nécessaires

Avant de créer les migrations, il faut confirmer la règle de commission : taux en pourcentage ou montant fixe par réservation, personne qui supporte la commission, moment exact où elle devient acquise, traitement des annulations et possibilité de modifier la configuration pour les nouveaux départs uniquement. Ces informations ne doivent pas être déduites automatiquement.


## 12. Suivi neutre avant fixation de la commission

La commission ne sera pas fixée dans la première version. Le système doit néanmoins enregistrer toutes les données nécessaires pour permettre une négociation future fiable. Aucune réservation ne doit être interprétée comme une commission définitivement due tant qu’une règle financière n’a pas été activée.

Chaque réservation conservera au minimum : l’origine (`PASSENGER_APP` ou `COUNTER`), l’utilisateur créateur lorsqu’elle vient du guichet, l’arrêt de saisie, la date et l’heure de création, le prix total au moment de la réservation, le montant d’avance demandé, le montant effectivement payé, le statut de paiement, le statut de réservation, le nombre de sièges, le voyage, le véhicule, le sens, la montée, la destination et la date du départ.

Le suivi financier affichera séparément les valeurs réelles et les simulations. Les montants réels comprennent le prix de réservation et les paiements reçus. Les simulations permettent au `SUPER_ADMIN` de saisir temporairement un taux ou un montant fixe dans l’écran de rapport afin d’estimer une commission potentielle, sans écrire cette simulation dans l’historique comptable et sans modifier les réservations.

### Filtres avancés proposés

Le tableau de bord du `SUPER_ADMIN` devra permettre de combiner plusieurs filtres dans une seule recherche : période de création, période de départ, origine de réservation, arrêt de saisie, opérateur créateur, départ, direction, véhicule, arrêt de montée, destination, statut de réservation, statut de paiement, réseau Mobile Money, présence ou absence de paiement, nombre de sièges, référence, nom ou téléphone du passager.

Les filtres doivent être combinables sans qu’un filtre remplace le précédent. Le rapport doit proposer une réinitialisation générale, la mémorisation locale des filtres et un export CSV des résultats actuellement filtrés.

### Indicateurs de négociation

Les indicateurs principaux sont le nombre total de réservations, le nombre de réservations `PASSENGER_APP`, le nombre de réservations `COUNTER`, le nombre de sièges vendus, le prix brut théorique, le montant réellement encaissé, les réservations confirmées, les annulations, le taux de remplissage par départ, le volume par opérateur et le volume par arrêt.

Un bloc de simulation pourra afficher, sans engagement :

| Simulation | Calcul |
|---|---|
| Taux simulé | Prix brut ou montant encaissé multiplié par un pourcentage saisi temporairement |
| Montant fixe simulé | Nombre de réservations ou nombre de sièges multiplié par un montant saisi temporairement |
| Différence entre origines | Comparaison des volumes `PASSENGER_APP` et `COUNTER` |
| Impact des annulations | Simulation calculée uniquement sur les réservations confirmées ou selon le filtre actif |

Chaque rapport exporté devra indiquer clairement qu’il s’agit d’une **simulation non contractuelle** lorsque le taux ou le montant n’est pas une règle active. Cela permettra de préparer une négociation sans créer de faux historique financier.

### Règle de conservation

Les réservations déjà existantes doivent rester compatibles. Lors de l’ajout de l’origine, les anciennes réservations seront marquées `PASSENGER_APP` uniquement si leur création par un passager est certaine ; sinon elles devront être marquées `LEGACY_UNKNOWN` afin de ne pas fabriquer une information historique. Les nouvelles réservations guichet seront toujours identifiées par `COUNTER` et l’utilisateur créateur sera conservé.
