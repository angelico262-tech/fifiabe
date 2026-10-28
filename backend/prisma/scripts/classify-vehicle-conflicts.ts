// backend/prisma/scripts/classify-vehicle-conflicts.ts
//
// CLASSIFICATION EN LECTURE SEULE des groupes de conflits véhicule/créneau — FIFIABE
//
// Ce script :
//   - n'écrit RIEN en base (aucun create/update/delete/upsert, aucune migration, aucun seed) ;
//   - n'affiche et ne sauvegarde AUCUN secret (il ne lit que les tables métier) ;
//   - regroupe les voyages ACTIFS par (vehicleId, departureAt) — mêmes statuts actifs
//     que le script de réparation : DRAFT, SCHEDULED, PUBLISHED, FULL ;
//   - NE PROPOSE JAMAIS de voyage gagnant automatiquement : ni par chauffeur
//     principal du véhicule, ni par identifiant le plus petit, ni par ordre de
//     création. Toute résolution est une DÉCISION OPÉRATEUR (choix explicite du
//     véhicule/voyage à conserver dans l'interface ou via une action administrative) ;
//   - produit un TABLEAU DE DÉCISION destiné à l'opérateur : voyages concernés,
//     date, direction, véhicule actuel, chauffeur, statut et action manuelle attendue ;
//   - écrit un rapport local `prisma/scripts/rapport-conflits-classifies.md`
//     (aucune donnée sensible : références, identifiants techniques, emails métier).

import { appendFile, writeFile } from 'node:fs/promises';
import { PrismaClient, TripStatus } from '@prisma/client';

const prisma = new PrismaClient();

const ACTIVE_TRIP_STATUSES: TripStatus[] = [
  TripStatus.DRAFT,
  TripStatus.SCHEDULED,
  TripStatus.PUBLISHED,
  TripStatus.FULL,
];

type ReportPath = 'prisma/scripts/rapport-conflits-classifies.md';
const REPORT_PATH: ReportPath = 'prisma/scripts/rapport-conflits-classifies.md';

type ClassifiedTrip = {
  id: string;
  status: TripStatus;
  routeName: string;
  direction: string;
  driverId: string | null;
  driverName: string;
  driverEmail: string;
  bookingCount: number;
  seatCount: number;
  seatRowsFromCancelledBookings: number;
  bookingSeatSumMismatch: boolean;
  references: string[];
};

type GroupCategory =
  | 'UN_SEUL_RESERVE'
  | 'PLUSIEURS_RESERVES'
  | 'AUCUN_RESERVE'
  | 'CHAUFFEUR_INCOMPATIBLE'
  | 'DONNEES_INCOHERENTES';

/**
 * Décision d'un groupe : TOUJOURS une décision opérateur.
 * `reservedTripIdFactuel` est un FAIT constaté dans les données (le seul voyage
 * portant des réservations), jamais un choix proposé par le script.
 */
type GroupDecision = {
  category: GroupCategory;
  requiresOperatorDecision: true;
  /** Fait constaté : identifiant de l'unique voyage réservé, si et seulement si les données sont cohérentes. Sinon null. */
  reservedTripIdFactuel: string | null;
  confidence: 'HAUTE' | 'MOYENNE' | 'BLOQUE';
  blockingReasons: string[];
  /** Action manuelle attendue de l'opérateur, formulée en français. */
  expectedManualAction: string;
};

function expectedManualAction(category: GroupCategory): string {
  switch (category) {
    case 'UN_SEUL_RESERVE':
      return "L'opérateur confirme ce voyage comme celui à conserver, puis neutralise manuellement les doublons sans réservation.";
    case 'PLUSIEURS_RESERVES':
      return 'Décision humaine obligatoire : aucun traitement automatique. L\'opérateur choisit le voyage à conserver et planifie le transfert éventuel des réservations avec validation administrative.';
    case 'AUCUN_RESERVE':
      return "L'opérateur choisit explicitement quel voyage garder (ou en change le véhicule) puis neutralise les autres — aucun choix automatique n'est effectué.";
    case 'CHAUFFEUR_INCOMPATIBLE':
      return "Validation administrative obligatoire avant toute correction (réaffectation du chauffeur ou changement de véhicule).";
    case 'DONNEES_INCOHERENTES':
      return "Aucune modification automatique. Rapport à transmettre à l'administrateur pour investigation des données.";
  }
}

async function main() {
  const trips = await prisma.trip.findMany({
    where: { status: { in: ACTIVE_TRIP_STATUSES } },
    include: {
      vehicle: { select: { id: true, code: true, capacity: true, primaryDriver: { select: { id: true } } } },
      route: { select: { name: true, direction: true } },
      driver: { select: { id: true, fullName: true, email: true } },
      bookings: {
        select: { id: true, status: true, seats: true, reference: true, seatBookings: { select: { seatNumber: true } } },
      },
    },
    orderBy: [{ vehicleId: 'asc' }, { departureAt: 'asc' }, { id: 'asc' }],
  });

  // Regroupement par (véhicule, créneau exact).
  const groups = new Map<string, typeof trips>();
  for (const trip of trips) {
    const key = `${trip.vehicleId}|${trip.departureAt.toISOString()}`;
    const group = groups.get(key) ?? [];
    group.push(trip);
    groups.set(key, group);
  }
  const conflictGroups = [...groups.values()].filter((group) => group.length > 1);

  console.log(`Voyages actifs analysés : ${trips.length}`);
  console.log(`Groupes en conflit (même véhicule + même créneau, plusieurs voyages actifs) : ${conflictGroups.length}\n`);

  const lines: string[] = [
    '# Rapport de classification des conflits véhicule/créneau (lecture seule)',
    '',
    `Généré le ${new Date().toISOString()} — script classify-vehicle-conflicts.ts`,
    `Voyages actifs analysés : ${trips.length} · Groupes en conflit : ${conflictGroups.length}`,
    '',
    '> Règle métier : ce script ne propose AUCUN voyage gagnant. Toute résolution',
    '> est une décision explicite de l\'opérateur, consignée dans le tableau de décision.',
    '',
  ];

  const categoryCounts = new Map<GroupCategory, number>();
  // Tableau de décision global destiné à l'opérateur.
  const decisionTableRows: string[] = [];

  for (const [index, group] of conflictGroups.entries()) {
    const vehicle = group[0].vehicle;
    const primaryDriverId = vehicle.primaryDriver?.id ?? null;
    const departureAt = group[0].departureAt;

    const classified: ClassifiedTrip[] = group.map((trip) => {
      // Cohérence interne d'un voyage : somme des sièges déclarés par réservation
      // vs nombre réel de lignes SeatBooking ; et sièges rattachés à des
      // réservations ANNULÉES qui gonfleraient encore les compteurs.
      let declaredSeats = 0;
      let realSeats = 0;
      let seatsOnCancelled = 0;
      const references: string[] = [];
      for (const booking of trip.bookings) {
        if (booking.status === 'CANCELLED') {
          seatsOnCancelled += booking.seatBookings.length;
          continue;
        }
        declaredSeats += booking.seats;
        realSeats += booking.seatBookings.length;
        if (booking.reference) references.push(booking.reference);
      }
      return {
        id: trip.id,
        status: trip.status,
        routeName: trip.route.name,
        direction: trip.route.direction,
        driverId: trip.driverId,
        driverName: trip.driver?.fullName ?? '—',
        driverEmail: trip.driver?.email ?? '—',
        bookingCount: trip.bookings.filter((booking) => booking.status !== 'CANCELLED').length,
        seatCount: realSeats,
        seatRowsFromCancelledBookings: seatsOnCancelled,
        bookingSeatSumMismatch: declaredSeats !== realSeats,
        references,
      };
    });

    const bookedTrips = classified.filter((trip) => trip.bookingCount > 0);

    const blockingReasons: string[] = [];
    let category: GroupCategory;

    if (bookedTrips.length > 1) {
      category = 'PLUSIEURS_RESERVES';
      blockingReasons.push(`${bookedTrips.length} voyages portent des réservations : aucune annulation ni déplacement automatique.`);
    } else if (bookedTrips.length === 1) {
      const hasIncoherence = classified.some(
        (trip) => trip.bookingSeatSumMismatch || trip.seatRowsFromCancelledBookings > 0,
      );
      const driverMismatch =
        primaryDriverId != null &&
        bookedTrips[0].driverId != null &&
        bookedTrips[0].driverId !== primaryDriverId;
      if (hasIncoherence) {
        category = 'DONNEES_INCOHERENTES';
        blockingReasons.push('Incohérence sièges déclarés / lignes SeatBooking, ou sièges restants sur réservations annulées.');
      } else if (driverMismatch) {
        category = 'CHAUFFEUR_INCOMPATIBLE';
        blockingReasons.push('Le chauffeur du voyage réservé diffère du chauffeur principal du véhicule.');
      } else {
        category = 'UN_SEUL_RESERVE';
      }
    } else {
      category = 'AUCUN_RESERVE';
    }

    // Fait constaté (jamais un choix) : l'unique voyage réservé, uniquement si
    // les données sont cohérentes et qu'il n'y a pas d'ambiguïté.
    const reservedTripIdFactuel =
      bookedTrips.length === 1 && (category === 'UN_SEUL_RESERVE' || category === 'CHAUFFEUR_INCOMPATIBLE')
        ? bookedTrips[0].id
        : null;

    const decision: GroupDecision = {
      category,
      requiresOperatorDecision: true,
      reservedTripIdFactuel,
      confidence:
        category === 'PLUSIEURS_RESERVES' || category === 'DONNEES_INCOHERENTES'
          ? 'BLOQUE'
          : category === 'UN_SEUL_RESERVE'
            ? 'HAUTE'
            : 'MOYENNE',
      blockingReasons,
      expectedManualAction: expectedManualAction(category),
    };

    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

    const header =
      `## Groupe ${index + 1}/${conflictGroups.length} — ${vehicle.code} — ${departureAt.toISOString()}`;
    console.log('════════════════════════════════════════════════');
    console.log(header);
    for (const trip of classified) {
      console.log(
        `  ${trip.id} | ${trip.status} | ${trip.routeName} (${trip.direction}) | chauffeur=${trip.driverEmail} | réservations=${trip.bookingCount} | sièges=${trip.seatCount}/${vehicle.capacity}` +
          (trip.seatRowsFromCancelledBookings > 0 ? ` | ⚠ ${trip.seatRowsFromCancelledBookings} siège(s) sur réservation(s) annulée(s)` : '') +
          (trip.bookingSeatSumMismatch ? ' | ⚠ incohérence sièges déclarés/lignes réelles' : ''),
      );
    }
    console.log(
      `  CLASSEMENT: ${decision.category} · confiance=${decision.confidence}` +
        (reservedTripIdFactuel ? ` · voyage réservé constaté=${reservedTripIdFactuel}` : '') +
        ' · DÉCISION OPÉRATEUR REQUISE',
    );
    for (const reason of decision.blockingReasons) console.log(`  RAISON: ${reason}`);
    console.log(`  ACTION ATTENDUE: ${decision.expectedManualAction}`);
    console.log('');

    lines.push(header, '');
    lines.push(`| tripId | statut | route | direction | chauffeur | réservations actives | sièges occupés |`);
    lines.push(`|---|---|---|---|---|---|---|`);
    for (const trip of classified) {
      lines.push(
        `\`${trip.id}\` | ${trip.status} | ${trip.routeName} | ${trip.direction} | ${trip.driverName} &lt;${trip.driverEmail}&gt; | ${trip.bookingCount}${trip.references.length ? ` (${trip.references.join(', ')})` : ''} | ${trip.seatCount}/${vehicle.capacity}${trip.seatRowsFromCancelledBookings ? ` (+${trip.seatRowsFromCancelledBookings} sur annulées)` : ''}${trip.bookingSeatSumMismatch ? ' ⚠️ incohérence' : ''} |`,
      );
    }
    lines.push('');
    lines.push(
      `- **Chauffeur principal du véhicule :** ${primaryDriverId ?? 'aucun'} _(information indicative — ne détermine jamais le choix)_`,
      `- **Classement :** \`${decision.category}\` — confiance **${decision.confidence}**`,
      ...(reservedTripIdFactuel
        ? [`- **Voyage réservé constaté (fait, pas un choix) :** \`${reservedTripIdFactuel}\``]
        : []),
      `- **Correction automatique :** INTERDITE — décision opérateur obligatoire`,
      ...decision.blockingReasons.map((reason) => `- **Raison de blocage :** ${reason}`),
      `- **Action manuelle attendue :** ${decision.expectedManualAction}`,
      '',
    );

    // Lignes du tableau de décision opérateur (une ligne par voyage).
    for (const trip of classified) {
      decisionTableRows.push(
        `| ${index + 1} | \`${trip.id}\` | ${departureAt.toISOString()} | ${trip.direction} | ${vehicle.code} | ${trip.driverName} | ${trip.status} | \`${decision.category}\` | ${decision.expectedManualAction} |`,
      );
    }
  }

  lines.unshift(...[
    `## Résumé`,
    '',
    ...[...categoryCounts.entries()].map(([category, count]) => `- \`${category}\` : **${count}** groupe(s)`),
    '',
    '---',
    '',
  ]);

  lines.push(
    '# Tableau de décision destiné à l\'opérateur',
    '',
    'Chaque ligne décrit un voyage impliqué dans un conflit. L\'opérateur choisit',
    'explicitement le voyage à conserver ou le véhicule correct ; aucun choix',
    'automatique (identifiant le plus petit, chauffeur principal, ordre de création)',
    'ne doit être appliqué.',
    '',
    '| Groupe | tripId | Date/créneau | Direction | Véhicule | Chauffeur | Statut | Classement | Action manuelle attendue |',
    '|---|---|---|---|---|---|---|---|---|',
    ...decisionTableRows,
    '',
  );

  await writeFile(REPORT_PATH, lines.join('\n'), 'utf8');
  await appendFile(REPORT_PATH, `_Fin du rapport — aucune donnée modifiée._\n`, 'utf8');

  console.log('────────────────────────────────────────────────');
  console.log('Résumé par catégorie :');
  for (const [category, count] of categoryCounts) console.log(`  ${category}: ${count}`);
  console.log(`\nRapport complet écrit dans ${REPORT_PATH} (fichier local, sans secret).`);
  console.log('Lecture seule : aucune donnée n’a été modifiée en base.');
}

main()
  .catch((error) => {
    console.error('Erreur pendant la classification (lecture seule, rien n’a été modifié) :', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
