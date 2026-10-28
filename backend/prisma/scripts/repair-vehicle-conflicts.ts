import { appendFile } from 'node:fs/promises';
import { PrismaClient, TripStatus, BookingStatus } from '@prisma/client';

const prisma = new PrismaClient();
const confirm = process.argv.includes('--confirm');
const author = process.env.REPAIR_AUTHOR?.trim() || 'SUPER_ADMIN_MANUAL_REPAIR';
const reason = process.env.REPAIR_REASON?.trim() || 'Réparation ciblée des doublons véhicule/créneau après audit FIFIABE';

const activeStatuses: TripStatus[] = [TripStatus.DRAFT, TripStatus.SCHEDULED, TripStatus.PUBLISHED, TripStatus.FULL];

type TripWithDetails = Awaited<ReturnType<typeof loadTrips>>[number];

async function loadTrips() {
  return prisma.trip.findMany({
    where: { status: { in: activeStatuses } },
    include: {
      vehicle: true,
      driver: { select: { id: true, fullName: true, email: true } },
      route: true,
      bookings: { where: { status: { not: BookingStatus.CANCELLED } }, select: { id: true, reference: true, status: true, seats: true } },
    },
    orderBy: [{ vehicleId: 'asc' }, { departureAt: 'asc' }, { id: 'asc' }],
  });
}

function groupTrips(trips: TripWithDetails[]) {
  const groups = new Map<string, TripWithDetails[]>();
  for (const trip of trips) {
    const key = `${trip.vehicleId}|${trip.departureAt.toISOString()}`;
    const group = groups.get(key) ?? [];
    group.push(trip);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

async function appendAudit(entry: Record<string, unknown>) {
  await appendFile('prisma/scripts/repair-audit.log', `${JSON.stringify({ ...entry, at: new Date().toISOString(), author, reason })}\n`, 'utf8');
}

async function main() {
  const groups = groupTrips(await loadTrips());
  if (!groups.length) {
    console.log('Aucun conflit de véhicule/créneau actif détecté.');
    return;
  }

  let proposed = 0;
  let skipped = 0;
  for (const group of groups) {
    const booked = group.filter((trip) => trip.bookings.length > 0);
    const unbooked = group.filter((trip) => trip.bookings.length === 0);
    console.log(`\nConflit ${group[0].vehicle.code} — ${group[0].departureAt.toISOString()}`);
    for (const trip of group) {
      const seats = trip.bookings.reduce((sum, booking) => sum + booking.seats, 0);
      console.log(`  ${trip.id} | ${trip.status} | ${trip.route.name} | chauffeur=${trip.driver?.email ?? 'aucun'} | réservations=${trip.bookings.length} | sièges=${seats}`);
    }

    if (booked.length !== 1) {
      skipped += group.length;
      console.log('  ACTION: aucune écriture automatique; le groupe exige une décision manuelle.');
      continue;
    }

    const winner = booked[0];
    for (const loser of unbooked) {
      proposed += 1;
      console.log(`  ACTION: ${confirm ? 'ANNULATION' : 'DRY-RUN'} de ${loser.id}; le voyage réservé conservé est ${winner.id}.`);
      if (!confirm) continue;
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.trip.findUnique({ where: { id: loser.id }, include: { bookings: { where: { status: { not: BookingStatus.CANCELLED } }, select: { id: true } } } });
        if (!fresh || fresh.bookings.length > 0 || !activeStatuses.includes(fresh.status)) {
          throw new Error(`Vérification concurrente échouée pour ${loser.id}; aucune écriture effectuée pour ce voyage.`);
        }
        await tx.trip.update({ where: { id: loser.id }, data: { status: TripStatus.CANCELLED, driverId: null } });
      });
      if (confirm) await appendAudit({ action: 'CANCEL_UNBOOKED_CONFLICTING_TRIP', tripId: loser.id, preservedTripId: winner.id, vehicleId: loser.vehicleId, departureAt: loser.departureAt.toISOString() });
    }
  }

  console.log(`\nRésumé: ${groups.length} groupe(s), ${proposed} action(s) proposée(s), ${skipped} voyage(s) nécessitant une décision manuelle.`);
  if (!confirm) console.log('DRY-RUN uniquement: aucune donnée modifiée. Ajoutez --confirm uniquement après revue.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
