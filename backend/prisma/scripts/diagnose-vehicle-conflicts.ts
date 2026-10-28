// backend/prisma/scripts/diagnose-vehicle-conflicts.ts
//
// DIAGNOSTIC EN LECTURE SEULE — FIFIABE
//
// Objectif : lister tous les groupes (vehicleId, departureAt) qui possèdent
// plusieurs voyages (Trip) non annulés. Un même véhicule ne devrait jamais
// être planifié sur deux voyages actifs au même créneau, quelle que soit
// la direction/route.
//
// Ce script :
//   - N'écrit RIEN en base (aucun create/update/delete/upsert).
//   - Ne lance PAS le seed.
//   - Ne crée AUCUNE migration.
//   - Utilise uniquement le client Prisma existant (aucune requête SQL brute
//     applicative hors ce qui est déjà généré par Prisma lui-même).
//
// Exécution (depuis backend/) :
//   npx tsx prisma/scripts/diagnose-vehicle-conflicts.ts
//   ou : npx ts-node prisma/scripts/diagnose-vehicle-conflicts.ts
//
// Le script utilise DATABASE_URL / DIRECT_URL déjà configurés dans
// backend/.env — aucune valeur secrète n'est affichée ni requise en dur ici.

import { PrismaClient, TripStatus } from '@prisma/client';

const prisma = new PrismaClient();

type ConflictRow = {
  tripId: string;
  status: TripStatus;
  route: string;
  vehicleCode: string;
  driverName: string;
  driverEmail: string;
  activeBookings: number;
  seatCount: number;
  capacity: number;
};

async function main() {
  // 1) Regroupe les voyages non annulés par (vehicleId, departureAt).
  const grouped = await prisma.trip.groupBy({
    by: ['vehicleId', 'departureAt'],
    where: { status: { not: TripStatus.CANCELLED } },
    _count: { _all: true },
  });

  const conflictGroups = grouped.filter((group) => group._count._all > 1);

  if (conflictGroups.length === 0) {
    console.log('Aucun conflit détecté : aucun véhicule n’a plusieurs voyages non annulés au même créneau.');
    return;
  }

  console.log(`${conflictGroups.length} groupe(s) en conflit détecté(s) (même véhicule, même date/heure de départ, plusieurs voyages actifs).\n`);

  for (const group of conflictGroups) {
    const trips = await prisma.trip.findMany({
      where: {
        vehicleId: group.vehicleId,
        departureAt: group.departureAt,
        status: { not: TripStatus.CANCELLED },
      },
      include: {
        vehicle: { select: { code: true, capacity: true } },
        route: { select: { name: true, direction: true } },
        driver: { select: { fullName: true, email: true } },
        departureStop: { select: { name: true } },
        bookings: {
          where: { status: { not: 'CANCELLED' } },
          select: { id: true, seats: true, reference: true, passengerName: true },
        },
        seatBookings: { select: { id: true } },
      },
      orderBy: { id: 'asc' },
    });

    console.log('════════════════════════════════════════════════════════════');
    console.log(`Véhicule : ${trips[0]?.vehicle.code ?? group.vehicleId}`);
    console.log(`Créneau  : ${group.departureAt.toISOString()}`);
    console.log(`Nombre de voyages actifs sur ce créneau : ${trips.length}`);
    console.log('────────────────────────────────────────────────────────────');

    const rows: ConflictRow[] = trips.map((trip) => {
      const activeBookings = trip.bookings.length;
      const seatCount = trip.seatBookings.length;
      return {
        tripId: trip.id,
        status: trip.status,
        route: `${trip.route.name} (${trip.route.direction})`,
        vehicleCode: trip.vehicle.code,
        driverName: trip.driver?.fullName ?? '— aucun chauffeur assigné —',
        driverEmail: trip.driver?.email ?? '—',
        activeBookings,
        seatCount,
        capacity: trip.vehicle.capacity,
      };
    });

    console.table(
      rows.map((row) => ({
        tripId: row.tripId,
        statut: row.status,
        route: row.route,
        vehicule: row.vehicleCode,
        chauffeur: `${row.driverName} <${row.driverEmail}>`,
        'réservations actives': row.activeBookings,
        'sièges occupés': `${row.seatCount}/${row.capacity}`,
      })),
    );

    // Détail des réservations pour le voyage qui en possède, utile pour
    // rattacher précisément une référence (ex. FIF-3D70DA41B0) à son tripId.
    for (const trip of trips) {
      if (trip.bookings.length > 0) {
        console.log(`  Réservations sur le voyage ${trip.id} :`);
        for (const booking of trip.bookings) {
          console.log(`    - ${booking.reference ?? '(sans référence)'} · ${booking.passengerName} · ${booking.seats} siège(s)`);
        }
      }
    }
    console.log('');
  }

  console.log('Fin du diagnostic. Aucune donnée n’a été modifiée.');
}

main()
  .catch((error) => {
    console.error('Erreur pendant le diagnostic (lecture seule, rien n’a été modifié) :', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
