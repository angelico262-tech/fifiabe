import { Direction, PrismaClient, TripStatus, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const stopNames = ['Antalaha', 'Andapa', 'Sambava', 'Ampanefena', 'Vohemar', 'Tana'];

type DepartureAllocation = {
  direction: Direction;
  departureStopName: string;
  vehicleIndex: number;
};

function nextDepartureDates() {
  const dates: Date[] = [];
  const now = new Date();
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 0, 0, 0);

  for (let day = 0; day < 35; day += 1) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() + day);
    if ([2, 4, 6].includes(date.getDay())) dates.push(date);
  }

  return dates.slice(0, 12);
}

async function main() {
  const adminPassword = await bcrypt.hash('Admin123!', 12);
  await prisma.user.upsert({
    where: { email: 'admin@fifiabe.mg' },
    update: { fullName: 'Administrateur FIFIABE', role: UserRole.ADMIN },
    create: {
      email: 'admin@fifiabe.mg',
      passwordHash: adminPassword,
      fullName: 'Administrateur FIFIABE',
      role: UserRole.ADMIN,
    },
  });

  const superAdminPassword = await bcrypt.hash('SuperAdmin123!', 12);
  await prisma.user.upsert({
    where: { email: 'superadmin@fifiabe.mg' },
    update: { fullName: 'Super administrateur FIFIABE', role: UserRole.SUPER_ADMIN, managedStopId: null },
    create: {
      email: 'superadmin@fifiabe.mg',
      passwordHash: superAdminPassword,
      fullName: 'Super administrateur FIFIABE',
      role: UserRole.SUPER_ADMIN,
    },
  });

  const stops = await Promise.all(
    stopNames.map((name) => prisma.stop.upsert({ where: { name }, update: {}, create: { name } })),
  );

  const defaultOperatorHash = await bcrypt.hash('Operateur123!', 12);
  const operators = new Map<string, string>();
  for (const stop of stops) {
    const user = await prisma.user.upsert({
      where: { email: `operateur.${stop.name.toLowerCase()}@fifiabe.mg` },
      update: {
        fullName: `Opérateur ${stop.name}`,
        role: UserRole.OPERATOR,
        managedStopId: stop.id,
      },
      create: {
        email: `operateur.${stop.name.toLowerCase()}@fifiabe.mg`,
        passwordHash: defaultOperatorHash,
        fullName: `Opérateur ${stop.name}`,
        role: UserRole.OPERATOR,
        managedStopId: stop.id,
      },
    });
    operators.set(stop.name, user.id);
  }

  await prisma.user.upsert({
    where: { email: 'chauffeur.test@fifiabe.mg' },
    update: {},
    create: {
      email: 'chauffeur.test@fifiabe.mg',
      passwordHash: await bcrypt.hash('Driver123!', 12),
      fullName: 'Chauffeur test',
      role: UserRole.DRIVER,
    },
  });

  const routes = await Promise.all([
    prisma.route.upsert({
      where: { direction: Direction.SAVA_TO_TANA },
      update: {},
      create: { name: 'SAVA → Tana', direction: Direction.SAVA_TO_TANA },
    }),
    prisma.route.upsert({
      where: { direction: Direction.TANA_TO_SAVA },
      update: {},
      create: { name: 'Tana → SAVA', direction: Direction.TANA_TO_SAVA },
    }),
  ]);
  const routeByDirection = new Map(routes.map((route) => [route.direction, route]));

  for (const route of routes) {
    const ordered = route.direction === Direction.SAVA_TO_TANA ? stopNames : [...stopNames].reverse();
    for (const [order, name] of ordered.entries()) {
      const stop = stops.find((item) => item.name === name)!;
      await prisma.routeStop.upsert({
        where: { routeId_stopId: { routeId: route.id, stopId: stop.id } },
        update: { order },
        create: { routeId: route.id, stopId: stop.id, order },
      });
    }
  }

  const vehicles = await Promise.all(
    Array.from({ length: 9 }, (_, index) => prisma.vehicle.upsert({
      where: { code: `FIF-${String(index + 1).padStart(3, '0')}` },
      update: { capacity: 17, active: true },
      create: { code: `FIF-${String(index + 1).padStart(3, '0')}`, capacity: 17, active: true },
    })),
  );

  // À une date donnée, un véhicule n’est préparé que pour un seul sens.
  // Les voyages sont des brouillons : l’opérateur de l’arrêt fixe le tarif,
  // l’avance, le point de rendez-vous et ses comptes Mobile Money avant publication.
  const allocations: DepartureAllocation[] = [
    { direction: Direction.SAVA_TO_TANA, departureStopName: 'Antalaha', vehicleIndex: 0 },
    { direction: Direction.SAVA_TO_TANA, departureStopName: 'Andapa', vehicleIndex: 1 },
    { direction: Direction.SAVA_TO_TANA, departureStopName: 'Sambava', vehicleIndex: 2 },
    { direction: Direction.SAVA_TO_TANA, departureStopName: 'Ampanefena', vehicleIndex: 3 },
    { direction: Direction.SAVA_TO_TANA, departureStopName: 'Vohemar', vehicleIndex: 4 },
    { direction: Direction.TANA_TO_SAVA, departureStopName: 'Tana', vehicleIndex: 5 },
    { direction: Direction.TANA_TO_SAVA, departureStopName: 'Tana', vehicleIndex: 6 },
    { direction: Direction.TANA_TO_SAVA, departureStopName: 'Tana', vehicleIndex: 7 },
    { direction: Direction.TANA_TO_SAVA, departureStopName: 'Tana', vehicleIndex: 8 },
  ];

  for (const departureAt of nextDepartureDates()) {
    for (const allocation of allocations) {
      const route = routeByDirection.get(allocation.direction)!;
      const departureStop = stops.find((stop) => stop.name === allocation.departureStopName)!;
      const vehicle = vehicles[allocation.vehicleIndex];
      const existing = await prisma.trip.findUnique({
        where: {
          departureAt_routeId_vehicleId: {
            departureAt,
            routeId: route.id,
            vehicleId: vehicle.id,
          },
        },
        include: { seatBookings: { select: { id: true } } },
      });

      const tripData = {
        departureStopId: departureStop.id,
        operatorId: operators.get(departureStop.name)!,
        status: TripStatus.DRAFT,
        priceAr: 50000,
        depositRequiredAr: 0,
        meetingPoint: null,
        meetingTime: '13:00',
        operatorPhone: null,
        paymentMessage: null,
        mvolaNumber: null,
        mvolaAccountName: null,
        orangeMoneyNumber: null,
        orangeMoneyAccountName: null,
        airtelMoneyNumber: null,
        airtelMoneyAccountName: null,
        publishedAt: null,
      };

      if (!existing) {
        await prisma.trip.create({
          data: { departureAt, routeId: route.id, vehicleId: vehicle.id, ...tripData },
        });
      } else if (existing.seatBookings.length === 0) {
        // Un voyage déjà réservé reste intact lors d’un nouveau seed.
        await prisma.trip.update({ where: { id: existing.id }, data: tripData });
      }
    }
  }

  console.log(
    `Seed FIFIABE terminé : ${vehicles.length} véhicules, ${routes.length} routes, ${operators.size} opérateurs et des brouillons de départ pour les 4 prochaines semaines.`,
  );
}

main().finally(() => prisma.$disconnect());
