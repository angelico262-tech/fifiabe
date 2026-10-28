# FIFIABE — Document maître de continuité pour développeur ou IA

**Projet :** application de réservation et de centralisation des départs de taxi-brousse pour la coopérative FIFIABE, Madagascar.

**Objectif immédiat :** rendre FIFIABE fiable en production avant d’élargir la solution à d’autres coopératives.

**Direction stratégique :** conserver une application unique et extensible, avec une future intégration USSD et, à terme, une architecture multi-coopératives avec personnalisation de marque et contrats payants.

---

## 1. Règles métier non négociables

La ligne principale relie Antananarivo et la SAVA. Les arrêts utilisés sont Antalaha, Andapa, Sambava, Ampanefena, Vohemar et Tana. Sambava est le hub métier. Les navettes d’Antalaha et d’Andapa rejoignent le bus principal à Sambava.

Les départs sont prévus le mardi, jeudi et samedi à 13 h 00 dans les deux sens. Le prix de référence actuel est de 50 000 Ar, mais le tarif et l’avance peuvent être publiés par l’opérateur selon le départ. La flotte de référence contient neuf véhicules de 17 places.

L’ordre SAVA → Tana est : Antalaha → Andapa → Sambava → Ampanefena → Vohemar → Tana. Dans l’autre sens, l’ordre est inversé.

### Règle de capacité validée — Option A

> Pour un même véhicule et un même départ, un siège réservé est bloqué pour tout le voyage, quel que soit l’arrêt de montée ou de destination.

Il ne faut donc jamais revendre le même siège sur un autre tronçon du même départ. Les arrêts servent à organiser la montée, la destination, les manifestes et le travail des opérateurs ; ils ne créent pas une capacité indépendante par segment.

Le plan visuel représente 17 places : conducteur, passager avant, rangées centrales avec couloir et banquette arrière. Toute modification du plan doit conserver exactement 17 sièges et empêcher les doubles réservations.

---

## 2. Parcours passager

Le passager ne crée pas de compte. Il recherche un départ, choisit ses arrêts, sélectionne une ou plusieurs places, saisit ses coordonnées, reçoit une référence unique et peut consulter sa réservation avec cette référence.

Le parcours doit rester progressif : Recherche → Départs → Sièges → Coordonnées → Confirmation. Après une action importante, l’écran doit conduire automatiquement vers la section suivante et afficher une confirmation claire.

Les réservations publiques ont l’origine :

```text
PASSENGER_APP
```

Le passager peut déclarer un paiement Mobile Money. L’opérateur vérifie ensuite la déclaration. Le système doit empêcher une nouvelle déclaration après confirmation, refuser une référence de transaction déjà utilisée et empêcher un montant déclaré supérieur au montant attendu.

---

## 3. Profils et droits

| Rôle | Responsabilité |
|---|---|
| `SUPER_ADMIN` | Propriétaire de la plateforme de réservation. Voit toutes les coopératives futures, toutes les réservations, tous les paiements, les plaintes, les avis, les activités et les indicateurs. |
| `ADMIN` | Administrateur ou propriétaire opérationnel de la coopérative FIFIABE. Gère les opérations autorisées et reçoit les plaintes qui lui sont destinées. |
| `OPERATOR` | Responsable d’un arrêt. Publie les départs de son arrêt, saisit les réservations guichet, consulte les passagers concernés et vérifie les paiements selon ses droits. |
| `DRIVER` | Lecture seule des départs et manifestes qui lui sont affectés. Peut contrôler les passagers sans téléphone ni Internet grâce à une liste imprimée. |
| Passager | Aucun compte. Réservation et suivi par référence unique. |

Le `SUPER_ADMIN` ne doit pas être limité par un arrêt par défaut. L’administrateur de la coopérative peut être global pour FIFIABE, tandis que l’opérateur reste limité à son périmètre métier.

---

## 4. Réservations guichet et origines

L’application centralise les réservations effectuées en ligne et celles faites au guichet. Une réservation saisie au guichet conserve l’opérateur qui l’a créée, l’arrêt concerné et son origine :

```text
COUNTER
```

Les anciennes réservations dont l’origine est inconnue utilisent :

```text
LEGACY_UNKNOWN
```

Les règles de siège, de prix, de paiement, de référence et de manifeste sont identiques pour une réservation `PASSENGER_APP` et une réservation `COUNTER`. Seule l’origine et l’identité de l’agent créateur diffèrent.

L’extension future pourra ajouter `USSD` et éventuellement `CALL_CENTER`, sans changer le modèle métier existant.

---

## 5. Super administrateur et suivi neutre

La commission du super administrateur n’est volontairement pas fixée. Il ne faut pas introduire un pourcentage ou un montant fixe obligatoire sans décision contractuelle.

En attendant, le système doit conserver les données nécessaires à la négociation : nombre de réservations, origine, date de création, date de départ, nombre de sièges, tarif, montant payé, statut de paiement, opérateur, arrêt, véhicule, annulation et plaintes associées.

Le super administrateur doit pouvoir afficher des simulations non contractuelles avec un pourcentage ou un montant fixe temporaire. Une simulation ne doit pas modifier les réservations, les paiements ni les soldes officiels.

Les indicateurs prioritaires sont : réservations par jour et par mois, remplissage par départ, remplissage par véhicule, recettes brutes, paiements confirmés, annulations, origine des réservations, activité par opérateur, plaintes et ponctualité.

---

## 6. Avis, plaintes et qualité de service

Une page publique `/avis` permet à un passager, opérateur, administrateur ou chauffeur de déposer un avis ou une plainte sans compte obligatoire. Une référence de réservation peut être associée lorsque cela est possible.

Les plaintes doivent contenir une catégorie, une priorité, une audience ou destination, un auteur éventuel, un responsable, une réponse et un historique de traitement. Les statuts recommandés sont :

```text
NOUVELLE
EN_ANALYSE
EN_ATTENTE
RESOLUE
REJETEE
CLOTUREE
```

Certaines plaintes sont destinées directement à l’administrateur propriétaire de la coopérative. Le `SUPER_ADMIN` conserve néanmoins une visibilité complète et peut réaffecter ou superviser la plainte. Les plaintes résolues ne doivent pas devenir publiques automatiquement.

---

## 7. Manifestes, impression et fonctionnement sans Internet

Pour chaque départ, l’application doit pouvoir produire une liste imprimable par départ, arrêt de montée et chauffeur. Le manifeste doit afficher : nom du passager, téléphone, siège, arrêt de montée, destination, origine de réservation, statut de paiement et remarques utiles.

Le chauffeur doit pouvoir vérifier cette liste imprimée sans téléphone et sans connexion Internet. Le système doit éviter d’imprimer des informations inutiles ou sensibles qui ne sont pas nécessaires au contrôle d’embarquement.

La future version pourra ajouter un export CSV et une génération PDF, mais l’impression navigateur constitue la première solution fiable.

---

## 8. Améliorations réalistes à forte valeur

Les priorités après stabilisation sont :

1. États de chargement, boutons désactivés pendant l’envoi, confirmations et bouton Réessayer.
2. Chargement progressif des onglets afin de ne pas charger toutes les données du tableau de bord simultanément.
3. Pagination des réservations, avis et plaintes.
4. Manifestes imprimables et contrôle de départ.
5. Historique des actions opérateur et administrateur.
6. Statistiques de remplissage, recettes, annulations et ponctualité.
7. Liste d’attente et proposition d’autres dates lorsqu’un départ est complet.
8. Gestion des incidents de véhicule et remplacement contrôlé.
9. Notifications SMS ou message de confirmation lorsque le canal est disponible.
10. Tests automatisés des règles de non-double-réservation et des droits.

Il faut éviter de construire immédiatement une application mobile native, un GPS avancé ou un système de facturation automatisé avant que FIFIABE ne soit utilisé et mesuré en conditions réelles.

---

## 9. Préparation de l’USSD

L’USSD doit être un canal supplémentaire vers les mêmes services backend, et non une deuxième logique de réservation. Les fonctions prévues sont : recherche, disponibilité, réservation simple, consultation par référence et demande d’aide.

Le parcours USSD doit rester court. Il ne peut pas afficher le plan visuel des 17 sièges ; il peut proposer un siège libre ou transmettre la sélection à un opérateur.

Avant d’activer l’USSD, le backend doit disposer de services séparés et stables pour rechercher, réserver, suivre et annuler. Les demandes USSD doivent être idempotentes afin qu’une répétition réseau ne crée pas deux réservations. Chaque action doit conserver son canal : `WEB`, `COUNTER` ou `USSD`.

---

## 10. Extension multi-coopératives future

FIFIABE reste la coopérative pilote. Il ne faut pas ajouter toute la complexité multi-coopératives avant d’avoir stabilisé son fonctionnement.

La direction future est une application unique avec une entité `Cooperative` et une isolation stricte des données. Les utilisateurs, arrêts, véhicules, trajets, réservations, paiements, avis, plaintes et journaux devront être rattachés à une coopérative.

La personnalisation devra porter sur le nom, le logo, les couleurs, les coordonnées, les horaires, les tarifs, les comptes Mobile Money et les messages. Le `SUPER_ADMIN` plateforme verra toutes les coopératives ; l’administrateur d’une coopérative ne verra que sa propre organisation.

L’isolation par coopérative doit être conçue et testée avant tout contrat payant. Changer seulement le logo et les couleurs serait insuffisant et risquerait d’exposer les données d’un client à un autre.

---

## 11. Principes de sécurité et de production

Tous les secrets restent dans `.env`, notamment `DATABASE_URL` et `JWT_SECRET`. Le backend écoute localement sur `127.0.0.1` en développement. Les requêtes base de données passent uniquement par Prisma.

Avant la production, il faut changer les mots de passe de développement, protéger les comptes, activer HTTPS, configurer les sauvegardes Supabase, limiter les droits, vérifier les journaux, tester la restauration et ne jamais publier les fichiers d’identifiants.

Il ne faut pas augmenter brutalement le pool Prisma sans mesure. La configuration actuelle a été réduite pour éviter les timeouts Supabase ; toute augmentation doit être testée progressivement.

---

## 12. Ordre de travail recommandé

### Phase A — Stabiliser FIFIABE

Terminer les tests de réservation, sièges, paiements, guichet, rôles, plaintes, impression et mobile. Corriger les lenteurs visibles par chargement à la demande et pagination.

### Phase B — Mesurer l’utilisation

Collecter les réservations, remplissages, recettes, annulations, plaintes, origines et délais. Utiliser ces historiques pour les décisions commerciales et la négociation de commission.

### Phase C — Préparer les canaux

Séparer les services backend, standardiser les réponses API et ajouter le canal `USSD` comme extension future sans l’activer immédiatement.

### Phase D — Piloter l’USSD

Tester recherche, réservation simple, suivi et aide avec un petit groupe d’utilisateurs. Vérifier l’idempotence, les références et la capacité avant l’ouverture générale.

### Phase E — Ouvrir à d’autres coopératives

Ajouter l’isolation stricte, la configuration de marque, la gestion des contrats, les indicateurs par client et les tests de séparation des données.

---

## 13. Règles pour toute future IA ou tout nouveau développeur

Avant toute modification, lire ce document, `FIFIABE_DEVELOPMENT_TRACEABILITY.md`, le schéma Prisma et les routes backend. Ne pas remplacer plusieurs fichiers sans comparer les versions existantes.

Ne pas créer une migration uniquement pour corriger un problème d’interface. Ne pas modifier la règle Option A. Ne pas introduire de commission définitive sans validation. Ne pas supprimer les historiques. Ne pas donner à un opérateur une visibilité globale par erreur. Toujours compiler backend et frontend après une modification et tester au moins un parcours passager, opérateur, administrateur, super administrateur et chauffeur.

Toute nouvelle décision métier doit être ajoutée à la documentation avant ou en même temps que son implémentation.

**Dernière mise à jour :** 17 août 2026
**Statut :** FIFIABE pilote ; architecture préparée pour USSD et multi-coopératives ; commission non fixée.
