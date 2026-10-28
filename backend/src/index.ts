import crypto from 'node:crypto';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { BookingOrigin, BookingStatus, Direction, FeedbackAuthorType, FeedbackAudience, FeedbackStatus, FeedbackType, PaymentNetwork, Prisma, PrismaClient, TripStatus, UserRole } from '@prisma/client';
import { env } from './config/env.js';
import { healthRoutes } from './routes/health.routes.js';
import { organizationConfig } from './config/organization.js';
import {
  checkVehicleConflict,
  resolveDefaultDriverId,
  assertDriverMatchesVehicle,
  requireExplicitVehicleSelection,
  makeBookingReference,
  isValidBookingReference,
} from './services/tripSchedulingService.js';
import { canManageBooking, canManageTrip, canViewBooking, canViewTrip } from './services/authorizationService.js';
import type { AuthUser } from './services/authorizationService.js';
import { assertOperatorCanCreateCounterBooking } from './services/bookingOriginService.js';

const app = Fastify({ logger: true });
const prisma = new PrismaClient({ transactionOptions: { maxWait: 15000, timeout: 30000, isolationLevel: 'Serializable' } });
await app.register(cors, { origin: env.CORS_ORIGIN });
await app.register(sensible);
await app.register(healthRoutes);

const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P2024', 'P2028']);
const SESSION_SECONDS = 8 * 60 * 60;
const loginAttempts = new Map<string, { failures: number; blockedUntil: number }>();
const STAFF_ROLES: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OPERATOR, UserRole.DRIVER];
const PUBLIC_TRIP_STATUSES: TripStatus[] = [TripStatus.PUBLISHED, TripStatus.FULL, TripStatus.SCHEDULED];
const BOOKABLE_TRIP_STATUSES: TripStatus[] = [TripStatus.PUBLISHED, TripStatus.SCHEDULED];

type SessionPayload = { sub: string; role: UserRole; stopId?: string; exp: number };
type AdminBookingRow = {
  id: string;
  reference: string | null;
  passengerName: string;
  passengerPhone: string;
  createdAt: Date;
  amountPaidAr: number;
  depositRequiredAr: number;
  priceAtBookingAr: number;
  status: BookingStatus;
  origin: string;
  paymentNetwork: string | null;
  trip: { departureAt: Date; status: TripStatus; vehicle: { code: string }; route: { name: string }; departureStop: { name: string } | null };
  seatBookings: { seatNumber: number }[];
  boardingStop: { name: string } | null;
  destinationStop: { name: string } | null;
};

function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
function isTransientDatabaseError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && TRANSIENT_PRISMA_CODES.has(error.code);
}
function databaseUnavailable(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  request.log.warn({ err: error }, 'Connexion Supabase temporairement indisponible');
  return reply.code(503).send({ message: 'Connexion temporairement indisponible avec la base. Réessayez dans quelques secondes.', retryable: true });
}
function signToken(payload: SessionPayload) {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsigned = `${head}.${body}`;
  return `${unsigned}.${crypto.createHmac('sha256', env.JWT_SECRET).update(unsigned).digest('base64url')}`;
}
function verifyToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, signature] = parts;
  const expected = crypto.createHmac('sha256', env.JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    return payload.sub && payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch { return null; }
}
async function requireStaff(request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  const raw = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
  const token = raw ? verifyToken(raw) : null;
  if (!token) { await reply.unauthorized('Connexion requise'); return null; }
  const user = await prisma.user.findUnique({ where: { id: token.sub }, select: { id: true, role: true, managedStopId: true, fullName: true } });
  if (!user || !STAFF_ROLES.includes(user.role)) { await reply.forbidden(`Accès réservé au personnel ${organizationConfig.brandName}`); return null; }
  return user;
}
function makeReference() { return makeBookingReference(); }
function tripWhereForDate(date: Date, direction: Direction) {
  const next = new Date(date); next.setUTCDate(next.getUTCDate() + 1);
  return { departureAt: { gte: date, lt: next }, route: { direction }, status: { in: [TripStatus.PUBLISHED, TripStatus.FULL, TripStatus.SCHEDULED] } };
}

app.get('/api/trips', async (request, reply) => {
  const query = request.query as { date?: string; direction?: string };
  const date = query.date ? parseDate(query.date) : null;
  if (!date || !query.direction) return reply.badRequest('date et direction sont obligatoires');
  const direction = query.direction === Direction.SAVA_TO_TANA ? Direction.SAVA_TO_TANA : Direction.TANA_TO_SAVA;
  try {
    const trips = await prisma.trip.findMany({
      where: tripWhereForDate(date, direction),
      include: { vehicle: true, route: true, departureStop: true, seatBookings: { select: { seatNumber: true } } },
      orderBy: { departureAt: 'asc' },
    });
    return trips.map((trip) => ({
      id: trip.id, departureAt: trip.departureAt, priceAr: trip.priceAr, depositRequiredAr: trip.depositRequiredAr,
      vehicleCode: trip.vehicle.code, capacity: trip.vehicle.capacity, bookedSeats: trip.seatBookings.length,
      availableSeats: trip.vehicle.capacity - trip.seatBookings.length, route: trip.route.name, status: trip.status,
      departureStop: trip.departureStop?.name ?? null, departureStopId: trip.departureStopId, meetingPoint: trip.meetingPoint, meetingTime: trip.meetingTime,
    }));
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); request.log.error(error); return reply.internalServerError('Impossible de charger les départs'); }
});

app.get('/api/trips/:tripId/seats', async (request, reply) => {
  const { tripId } = request.params as { tripId: string };
  try {
    const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: { vehicle: true, seatBookings: { select: { seatNumber: true } } } });
    if (!trip || !PUBLIC_TRIP_STATUSES.includes(trip.status)) return reply.notFound('Voyage indisponible');
    const occupied = new Set(trip.seatBookings.map((seat) => seat.seatNumber));
    return { tripId, vehicleCode: trip.vehicle.code, capacity: trip.vehicle.capacity, seats: Array.from({ length: trip.vehicle.capacity }, (_, index) => ({ number: index + 1, occupied: occupied.has(index + 1) })) };
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); request.log.error(error); return reply.internalServerError('Impossible de charger le plan des sièges'); }
});

app.get('/api/trips/:tripId/payment-info', async (request, reply) => {
  const { tripId } = request.params as { tripId: string };
  try {
    const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: { vehicle: true, departureStop: true } });
    if (!trip) return reply.notFound('Voyage introuvable');
    return {
      tripId, priceAr: trip.priceAr, depositRequiredAr: trip.depositRequiredAr, vehicleCode: trip.vehicle.code,
      departureStop: trip.departureStop?.name ?? null, meetingPoint: trip.meetingPoint, meetingTime: trip.meetingTime,
      operatorPhone: trip.operatorPhone, message: trip.paymentMessage,
      accounts: [
        { network: 'MVola', number: trip.mvolaNumber, accountName: trip.mvolaAccountName },
        { network: 'Orange Money', number: trip.orangeMoneyNumber, accountName: trip.orangeMoneyAccountName },
        { network: 'Airtel Money', number: trip.airtelMoneyNumber, accountName: trip.airtelMoneyAccountName },
      ].filter((account) => account.number),
    };
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de charger les instructions de paiement'); }
});

app.get('/api/trips/:tripId/stops', async (request, reply) => {
  const { tripId } = request.params as { tripId: string };
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: { route: { include: { stops: { include: { stop: true }, orderBy: { order: 'asc' } } } } },
    });
    if (!trip) return reply.notFound('Départ introuvable');
    return trip.route.stops.map((routeStop) => ({ id: routeStop.stop.id, name: routeStop.stop.name, order: routeStop.order }));
  } catch (error) {
    if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error);
    return reply.internalServerError('Impossible de charger les arrêts du trajet');
  }
});

app.post('/api/bookings', async (request, reply) => {
  const body = request.body as { tripId?: string; passengerName?: string; passengerPhone?: string; seatNumbers?: number[]; boardingStopId?: string; destinationStopId?: string };
  const name = body.passengerName?.trim(); const phone = body.passengerPhone?.trim(); const seats = Array.isArray(body.seatNumbers) ? body.seatNumbers : [];
  if (!body.tripId || !name || !phone || seats.length === 0) return reply.badRequest('voyage, nom, téléphone et au moins un siège sont obligatoires');
  if (new Set(seats).size !== seats.length || seats.some((seat) => !Number.isInteger(seat) || seat < 1 || seat > 17)) return reply.badRequest('sélection de sièges invalide');
  try {
    const result = await prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUnique({
        where: { id: body.tripId },
        include: { vehicle: true, route: { include: { stops: { orderBy: { order: 'asc' } } } } },
      });
      if (!trip || !BOOKABLE_TRIP_STATUSES.includes(trip.status)) throw new Error('TRIP_UNAVAILABLE');
      if (seats.some((seat) => seat > trip.vehicle.capacity)) throw new Error('SEAT_RANGE');
      const orderedStops = trip.route.stops;
      const boardingStopId = body.boardingStopId ?? orderedStops[0]?.stopId;
      const destinationStopId = body.destinationStopId ?? orderedStops[orderedStops.length - 1]?.stopId;
      const boardingIndex = orderedStops.findIndex((routeStop) => routeStop.stopId === boardingStopId);
      const destinationIndex = orderedStops.findIndex((routeStop) => routeStop.stopId === destinationStopId);
      if (!boardingStopId || !destinationStopId || boardingIndex < 0 || destinationIndex < 0 || boardingIndex >= destinationIndex) throw new Error('INVALID_STOPS');
      const occupied = await tx.seatBooking.count({ where: { tripId: trip.id, seatNumber: { in: seats } } });
      if (occupied) throw new Error('SEAT_TAKEN');
      let reference = makeReference();
      while (await tx.booking.findUnique({ where: { reference } })) reference = makeReference();
      const booking = await tx.booking.create({ data: {
        reference, tripId: trip.id, passengerName: name, passengerPhone: phone, seats: seats.length,
        boardingStopId, destinationStopId,
        priceAtBookingAr: trip.priceAr * seats.length, depositRequiredAr: trip.depositRequiredAr * seats.length, status: BookingStatus.PENDING_PAYMENT, origin: BookingOrigin.PASSENGER_APP,
      } });
      await tx.seatBooking.createMany({ data: seats.map((seatNumber) => ({ tripId: trip.id, bookingId: booking.id, seatNumber })) });
      const total = await tx.seatBooking.count({ where: { tripId: trip.id } });
      if (total >= trip.vehicle.capacity) await tx.trip.update({ where: { id: trip.id }, data: { status: TripStatus.FULL } });
      return { booking, full: total >= trip.vehicle.capacity };
    });
    return reply.code(201).send({ id: result.booking.id, reference: result.booking.reference, tripId: result.booking.tripId, status: result.booking.status, message: 'Place réservée. Conservez votre référence pour suivre le paiement.', seatNumbers: seats, full: result.full });
  } catch (error) {
    if (error instanceof Error && error.message === 'TRIP_UNAVAILABLE') return reply.conflict('Ce départ n’est plus disponible. Choisissez une autre date.');
    if (error instanceof Error && error.message === 'SEAT_RANGE') return reply.badRequest('Siège hors capacité du véhicule');
    if (error instanceof Error && error.message === 'INVALID_STOPS') return reply.badRequest('Choisissez un arrêt de montée avant votre destination sur ce trajet');
    if (error instanceof Error && error.message === 'SEAT_TAKEN') return reply.conflict('Un des sièges vient d’être réservé');
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.conflict('Un des sièges vient d’être réservé');
    if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error);
    request.log.error(error); return reply.internalServerError('Impossible d’enregistrer la réservation');
  }
});

app.post('/api/staff/bookings/counter', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  if (staff.role === UserRole.DRIVER) return reply.forbidden('Le chauffeur ne peut pas saisir une réservation au guichet');
  const body = request.body as { tripId?: string; passengerName?: string; passengerPhone?: string; seatNumbers?: number[]; boardingStopId?: string; destinationStopId?: string; paymentStatus?: BookingStatus };
  const name = body.passengerName?.trim(); const phone = body.passengerPhone?.trim(); const seats = Array.isArray(body.seatNumbers) ? body.seatNumbers : [];
  if (!body.tripId || !name || !phone || seats.length === 0) return reply.badRequest('voyage, nom, téléphone et au moins un siège sont obligatoires');
  if (new Set(seats).size !== seats.length || seats.some((seat) => !Number.isInteger(seat) || seat < 1 || seat > 17)) return reply.badRequest('sélection de sièges invalide');
  try {
    const result = await prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: body.tripId }, include: { vehicle: true, route: { include: { stops: { orderBy: { order: 'asc' } } } } } });
      if (!trip || !BOOKABLE_TRIP_STATUSES.includes(trip.status)) throw new Error('TRIP_UNAVAILABLE');
      if (!canManageTrip(staff, trip)) throw new Error('FORBIDDEN');
      if (seats.some((seat) => seat > trip.vehicle.capacity)) throw new Error('SEAT_RANGE');
      const orderedStops = trip.route.stops;
      const boardingStopId = body.boardingStopId ?? (staff.managedStopId || orderedStops[0]?.stopId);
      const destinationStopId = body.destinationStopId ?? orderedStops[orderedStops.length - 1]?.stopId;
      const boardingIndex = orderedStops.findIndex((routeStop) => routeStop.stopId === boardingStopId);
      const destinationIndex = orderedStops.findIndex((routeStop) => routeStop.stopId === destinationStopId);
      if (!boardingStopId || !destinationStopId || boardingIndex < 0 || destinationIndex < 0 || boardingIndex >= destinationIndex) throw new Error('INVALID_STOPS');
      const occupied = await tx.seatBooking.count({ where: { tripId: trip.id, seatNumber: { in: seats } } });
      if (occupied) throw new Error('SEAT_TAKEN');
      let reference = makeReference();
      while (await tx.booking.findUnique({ where: { reference } })) reference = makeReference();
      const booking = await tx.booking.create({ data: {
        reference, tripId: trip.id, passengerName: name, passengerPhone: phone, seats: seats.length, boardingStopId, destinationStopId,
        priceAtBookingAr: trip.priceAr * seats.length, depositRequiredAr: trip.depositRequiredAr * seats.length, status: body.paymentStatus === BookingStatus.CONFIRMED ? BookingStatus.CONFIRMED : BookingStatus.PENDING_PAYMENT,
        amountPaidAr: body.paymentStatus === BookingStatus.CONFIRMED ? trip.priceAr * seats.length : 0, origin: BookingOrigin.COUNTER, createdById: staff.id, createdAtStopId: staff.managedStopId,
        ...(body.paymentStatus === BookingStatus.CONFIRMED ? { paymentVerifiedAt: new Date(), verifiedById: staff.id } : {}),
      } });
      await tx.seatBooking.createMany({ data: seats.map((seatNumber) => ({ tripId: trip.id, bookingId: booking.id, seatNumber })) });
      const total = await tx.seatBooking.count({ where: { tripId: trip.id } });
      if (total >= trip.vehicle.capacity) await tx.trip.update({ where: { id: trip.id }, data: { status: TripStatus.FULL } });
      return { booking, full: total >= trip.vehicle.capacity };
    });
    return reply.code(201).send({ id: result.booking.id, reference: result.booking.reference, tripId: result.booking.tripId, origin: BookingOrigin.COUNTER, status: result.booking.status, message: 'Réservation guichet enregistrée.', seatNumbers: seats, full: result.full });
  } catch (error) {
    if (error instanceof Error && error.message === 'TRIP_UNAVAILABLE') return reply.conflict('Ce départ n’est plus disponible.');
    if (error instanceof Error && error.message === 'FORBIDDEN') return reply.forbidden('Vous ne pouvez saisir une réservation que sur un départ géré par votre arrêt');
    if (error instanceof Error && error.message === 'SEAT_RANGE') return reply.badRequest('Siège hors capacité du véhicule');
    if (error instanceof Error && error.message === 'INVALID_STOPS') return reply.badRequest('Les arrêts de montée et de destination sont incohérents');
    if (error instanceof Error && error.message === 'SEAT_TAKEN') return reply.conflict('Un des sièges vient d’être réservé');
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.conflict('Un des sièges vient d’être réservé');
    if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error);
    request.log.error(error); return reply.internalServerError('Impossible d’enregistrer la réservation guichet');
  }
});

app.get('/api/reservations/:reference', async (request, reply) => {
  const { reference } = request.params as { reference: string };
  if (!isValidBookingReference(reference)) return reply.badRequest('Référence de réservation invalide');
  try {
    const booking = await prisma.booking.findUnique({ where: { reference: reference.toUpperCase() }, include: { boardingStop: true, destinationStop: true, seatBookings: { orderBy: { seatNumber: 'asc' } }, trip: { include: { vehicle: true, route: true, departureStop: true } } } });
    if (!booking) return reply.notFound('Réservation introuvable');
    return {
      reference: booking.reference, passengerName: booking.passengerName, status: booking.status, seats: booking.seatBookings.map((seat) => seat.seatNumber),
      priceAr: booking.priceAtBookingAr, depositRequiredAr: booking.depositRequiredAr, amountPaidAr: booking.amountPaidAr, balanceAr: Math.max(0, booking.priceAtBookingAr - booking.amountPaidAr),
      paymentNetwork: booking.paymentNetwork, paymentReference: booking.paymentReference, departureAt: booking.trip.departureAt,
      vehicleCode: booking.trip.vehicle.code, route: booking.trip.route.name, departureStop: booking.trip.departureStop?.name, boardingStop: booking.boardingStop?.name ?? booking.trip.departureStop?.name, destinationStop: booking.destinationStop?.name ?? null, meetingPoint: booking.trip.meetingPoint, meetingTime: booking.trip.meetingTime,
    };
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de consulter la réservation'); }
});

app.post('/api/reservations/:reference/payment-declarations', async (request, reply) => {
  const { reference } = request.params as { reference: string };
  const body = request.body as { network?: PaymentNetwork; paymentReference?: string; payerPhone?: string; amount?: number };
  const amount = body.amount;
  const paymentReference = body.paymentReference?.trim();
  if (!body.network || !Object.values(PaymentNetwork).includes(body.network) || !paymentReference || !body.payerPhone?.trim() || typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return reply.badRequest('Réseau, référence de transaction, numéro émetteur et montant sont obligatoires');
  try {
    const booking = await prisma.booking.findUnique({ where: { reference: reference.toUpperCase() }, include: { trip: { select: { departureAt: true } } } });
    if (!booking || booking.status === BookingStatus.CANCELLED) return reply.notFound('Réservation introuvable ou annulée');
    if (new Date(booking.trip.departureAt).getTime() <= Date.now()) return reply.conflict('Ce voyage est passé : aucun paiement ne peut plus être déclaré');
    const remaining = booking.priceAtBookingAr - booking.amountPaidAr;
    if (remaining <= 0) return reply.conflict('Cette réservation est déjà entièrement payée');
    if (amount > remaining) return reply.badRequest(`Le montant déclaré (${amount} Ar) dépasse le reste à payer (${remaining} Ar)`);
    if (booking.amountPaidAr === 0 && booking.depositRequiredAr > 0 && amount < booking.depositRequiredAr) return reply.badRequest(`L’avance déclarée doit être au moins de ${booking.depositRequiredAr} Ar`);
    const duplicate = await prisma.booking.findFirst({ where: { id: { not: booking.id }, paymentReference } });
    if (duplicate) return reply.conflict('Cette référence de transaction est déjà associée à une réservation');
    const updated = await prisma.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.PAYMENT_DECLARED, paymentNetwork: body.network, paymentReference, payerPhone: body.payerPhone.trim(), amountPaidAr: booking.amountPaidAr + amount, paymentDeclaredAt: new Date() } });
    return { message: 'Paiement déclaré. Il sera confirmé après vérification par l’opérateur.', status: updated.status, amountPaidAr: updated.amountPaidAr };
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de déclarer le paiement'); }
});

app.get('/api/trips/:tripId/alternatives', async (request, reply) => {
  const { tripId } = request.params as { tripId: string };
  try {
    const source = await prisma.trip.findUnique({ where: { id: tripId }, include: { route: true } });
    if (!source) return reply.notFound('Départ introuvable');
    const alternatives = await prisma.trip.findMany({
      where: { routeId: source.routeId, departureAt: { gt: source.departureAt }, status: { in: [TripStatus.PUBLISHED, TripStatus.SCHEDULED] } },
      include: { vehicle: true, seatBookings: { select: { seatNumber: true } } }, orderBy: { departureAt: 'asc' }, take: 6,
    });
    return alternatives.filter((trip) => trip.seatBookings.length < trip.vehicle.capacity).map((trip) => ({ id: trip.id, departureAt: trip.departureAt, vehicleCode: trip.vehicle.code, availableSeats: trip.vehicle.capacity - trip.seatBookings.length }));
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de proposer des alternatives'); }
});

app.post('/api/trips/:tripId/waitlist', async (request, reply) => {
  const { tripId } = request.params as { tripId: string };
  const body = request.body as { passengerName?: string; passengerPhone?: string; seats?: number };
  if (!body.passengerName?.trim() || !body.passengerPhone?.trim()) return reply.badRequest('Nom et téléphone requis');
  try {
    const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: { vehicle: true, seatBookings: true } });
    if (!trip) return reply.notFound('Départ introuvable');
    if (trip.seatBookings.length < trip.vehicle.capacity) return reply.badRequest('Ce départ possède encore des places disponibles');
    const entry = await prisma.waitlistEntry.create({ data: { tripId, passengerName: body.passengerName.trim(), passengerPhone: body.passengerPhone.trim(), seats: Math.max(1, Math.min(17, Number(body.seats) || 1)) } });
    return reply.code(201).send({ id: entry.id, message: 'Vous êtes inscrit sur la liste d’attente.' });
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de rejoindre la liste d’attente'); }
});

app.post('/api/staff/login', async (request, reply) => {
  const clientId = request.ip; const state = loginAttempts.get(clientId);
  if (state?.blockedUntil && state.blockedUntil > Date.now()) return reply.tooManyRequests('Trop de tentatives. Réessayez dans 15 minutes.');
  const body = request.body as { email?: string; password?: string }; const email = body.email?.trim().toLowerCase();
  if (!email || !body.password) return reply.badRequest('Adresse e-mail et mot de passe requis');
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    const valid = user && await bcrypt.compare(body.password, user.passwordHash);
    if (!valid || !user || !STAFF_ROLES.includes(user.role)) {
      const failures = (state?.failures ?? 0) + 1; loginAttempts.set(clientId, { failures: failures >= 5 ? 0 : failures, blockedUntil: failures >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
      return reply.unauthorized('Identifiants personnels invalides');
    }
    loginAttempts.delete(clientId);
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const token = signToken({ sub: user.id, role: user.role, stopId: user.managedStopId ?? undefined, exp: expiresAt });
    return { token, expiresAt, fullName: user.fullName, role: user.role, managedStopId: user.managedStopId };
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de démarrer la session'); }
});

app.get('/api/staff/vehicles', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  try {
    const query = request.query as { includeInactive?: string };
    const includeInactive = query.includeInactive === 'true';
    const vehicles = await prisma.vehicle.findMany({ where: includeInactive ? {} : { active: true }, include: { primaryDriver: { select: { id: true, fullName: true } } }, orderBy: { code: 'asc' } });
    return vehicles.map((vehicle) => ({ id: vehicle.id, code: vehicle.code, registrationNumber: vehicle.registrationNumber, capacity: vehicle.capacity, active: vehicle.active, primaryDriverId: vehicle.primaryDriver?.id ?? null, primaryDriver: vehicle.primaryDriver }));
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de charger les véhicules'); }
});

app.post('/api/staff/vehicles', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  // Seuls SUPER_ADMIN et ADMIN peuvent créer des véhicules
  if (staff.role !== UserRole.SUPER_ADMIN && staff.role !== UserRole.ADMIN) {
    return reply.forbidden('Seuls l\'administrateur et le super administrateur peuvent créer un véhicule.');
  }
  const body = request.body as { code: string; registrationNumber?: string; capacity?: number; primaryDriverId?: string };
  if (!body.code) return reply.badRequest('Le code du véhicule est requis');
  // Vérifier que le code n'existe pas déjà
  const existing = await prisma.vehicle.findUnique({ where: { code: body.code } });
  if (existing) return reply.conflict('Ce code de véhicule est déjà utilisé');
  // Si un primaryDriverId est fourni, vérifier qu'il s'agit bien d'un DRIVER
  let driver = null;
  if (body.primaryDriverId) {
    driver = await prisma.user.findUnique({ where: { id: body.primaryDriverId }, select: { id: true, role: true, fullName: true } });
    if (!driver || driver.role !== UserRole.DRIVER) {
      return reply.badRequest('Le chauffeur principal doit être de rôle DRIVER');
    }
  }
  const vehicle = await prisma.vehicle.create({
    data: {
      code: body.code,
      registrationNumber: body.registrationNumber,
      capacity: body.capacity ?? 17,
      active: true,
      primaryDriver: driver ? { connect: { id: driver.id } } : undefined,
    },
  });
  return { id: vehicle.id, code: vehicle.code, registrationNumber: vehicle.registrationNumber, capacity: vehicle.capacity, active: vehicle.active, primaryDriver: driver ? { id: driver.id, fullName: driver.fullName } : null };
});

app.patch('/api/staff/vehicles/:id', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  if (staff.role !== UserRole.SUPER_ADMIN && staff.role !== UserRole.ADMIN) {
    return reply.forbidden('Seuls l\'administrateur et le super administrateur peuvent modifier un véhicule.');
  }
  const { id } = request.params as { id: string };
  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  if (!vehicle) return reply.notFound('Véhicule introuvable');
  const body = request.body as { code?: string; registrationNumber?: string; capacity?: number; primaryDriverId?: string; active?: boolean };
  if (body.code !== undefined && body.code !== vehicle.code) {
    const duplicate = await prisma.vehicle.findUnique({ where: { code: body.code } });
    if (duplicate) return reply.conflict('Ce code de véhicule est déjà utilisé');
  }
  if (body.registrationNumber !== undefined && body.registrationNumber !== vehicle.registrationNumber) {
    const duplicate = await prisma.vehicle.findUnique({ where: { registrationNumber: body.registrationNumber } });
    if (duplicate) return reply.conflict('Ce numéro d\'immatriculation est déjà utilisé');
  }
  let primaryDriverUpdate: Record<string, unknown> = {};
  if (body.primaryDriverId === null || body.primaryDriverId === '') {
    primaryDriverUpdate = { primaryDriver: { disconnect: true } };
  } else if (body.primaryDriverId !== undefined) {
    const driver = await prisma.user.findUnique({ where: { id: body.primaryDriverId }, select: { id: true, role: true } });
    if (!driver || driver.role !== UserRole.DRIVER) {
      return reply.badRequest('Le chauffeur principal doit être de rôle DRIVER');
    }
    primaryDriverUpdate = { primaryDriver: { connect: { id: body.primaryDriverId } } };
  }
  const updated = await prisma.vehicle.update({
    where: { id },
    data: {
      ...(body.code !== undefined ? { code: body.code } : {}),
      ...(body.registrationNumber !== undefined ? { registrationNumber: body.registrationNumber } : {}),
      ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...primaryDriverUpdate,
    },
    include: { primaryDriver: { select: { id: true, fullName: true } } },
  });
  return { id: updated.id, code: updated.code, registrationNumber: updated.registrationNumber, capacity: updated.capacity, active: updated.active, primaryDriverId: updated.primaryDriver?.id ?? null, primaryDriver: updated.primaryDriver };
});

app.get('/api/staff/drivers', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  if (staff.role !== UserRole.SUPER_ADMIN && staff.role !== UserRole.ADMIN) {
    return reply.forbidden('Seuls l\'administrateur et le super administrateur peuvent lister les chauffeurs.');
  }
  try {
    const drivers = await prisma.user.findMany({ where: { role: UserRole.DRIVER }, select: { id: true, fullName: true, email: true }, orderBy: { fullName: 'asc' } });
    return drivers;
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de charger les chauffeurs'); }
});

app.post('/api/staff/drivers', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  if (staff.role !== UserRole.SUPER_ADMIN && staff.role !== UserRole.ADMIN) {
    return reply.forbidden('Seuls l\'administrateur et le super administrateur peuvent créer un chauffeur.');
  }
  const body = request.body as { fullName?: string; email?: string; password?: string };
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!fullName || !email || !password) return reply.badRequest('Nom complet, e-mail et mot de passe sont obligatoires');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.badRequest('Adresse e-mail invalide');
  if (password.length < 8) return reply.badRequest('Le mot de passe doit contenir au moins 8 caractères');
  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) return reply.conflict('Cette adresse e-mail est déjà utilisée par un autre utilisateur');
    const passwordHash = await bcrypt.hash(password, 12);
    const driver = await prisma.user.create({
      data: { fullName, email, passwordHash, role: UserRole.DRIVER },
      select: { id: true, fullName: true, email: true, role: true },
    });
    return reply.code(201).send(driver);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.conflict('Cette adresse e-mail est déjà utilisée par un autre utilisateur');
    if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error);
    request.log.error(error); return reply.internalServerError('Impossible de créer le chauffeur');
  }
});

app.get('/api/staff/trips', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  const query = request.query as { date?: string; status?: string };
  const date = query.date ? parseDate(query.date) : null; if (query.date && !date) return reply.badRequest('date invalide');
  const next = date ? new Date(date) : null; next?.setUTCDate(next.getUTCDate() + 1);
  // Le frontend historique pouvait envoyer un BookingStatus (ex. PAYMENT_DECLARED)
  // à cette route qui attend uniquement un TripStatus. On ignore ces valeurs
  // incompatibles au lieu de laisser Prisma provoquer une erreur 500.
  const tripStatus = query.status && Object.values(TripStatus).includes(query.status as TripStatus)
    ? query.status as TripStatus
    : undefined;
  try {
    const trips = await prisma.trip.findMany({
      where: {
        ...(staff.role === UserRole.DRIVER ? { driverId: staff.id } : {}),
        ...(staff.role === UserRole.OPERATOR ? {
          OR: [
            { departureStopId: staff.managedStopId! },
            { bookings: { some: { boardingStopId: staff.managedStopId! } } },
          ],
        } : {}),
        ...(date && next ? { departureAt: { gte: date, lt: next } } : {}),
        ...(tripStatus ? { status: tripStatus } : {}),
      },
      include: { vehicle: true, route: true, departureStop: true, driver: { select: { id: true, fullName: true, email: true } }, bookings: { where: { status: { not: BookingStatus.CANCELLED } }, select: { seats: true } }, waitlistEntries: { where: { status: 'WAITING' } } }, orderBy: { departureAt: 'asc' },
    });
    return trips.map((trip) => { const bookedSeats = trip.bookings.reduce((total, booking) => total + booking.seats, 0); return { id: trip.id, vehicleId: trip.vehicleId, driverId: trip.driverId, driverName: trip.driver?.fullName ?? null, departureAt: trip.departureAt, status: trip.status, priceAr: trip.priceAr, depositRequiredAr: trip.depositRequiredAr, vehicleCode: trip.vehicle.code, capacity: trip.vehicle.capacity, bookedSeats, availableSeats: Math.max(0, trip.vehicle.capacity - bookedSeats), route: trip.route.name, departureStop: trip.departureStop?.name, waitlistCount: trip.waitlistEntries.length, meetingPoint: trip.meetingPoint, meetingTime: trip.meetingTime }; });
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de charger les départs'); }
});

app.put('/api/staff/trips/:tripId/publication', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  const { tripId } = request.params as { tripId: string };
  const body = request.body as { departureAt?: string; vehicleId?: string; driverId?: string; vehicleCode?: string; exceptionalVehicleChange?: boolean; exceptionalReason?: string; priceAr?: number; depositRequiredAr?: number; meetingPoint?: string; meetingTime?: string; operatorPhone?: string; paymentMessage?: string; mvolaNumber?: string; mvolaAccountName?: string; orangeMoneyNumber?: string; orangeMoneyAccountName?: string; airtelMoneyNumber?: string; airtelMoneyAccountName?: string };
  if (!Number.isInteger(body.priceAr) || body.priceAr! <= 0 || !Number.isInteger(body.depositRequiredAr) || body.depositRequiredAr! < 0 || body.depositRequiredAr! > body.priceAr!) return reply.badRequest('Tarif ou avance invalide');
  try {
    const trip = await prisma.trip.findUnique({ where: { id: tripId } }); if (!trip) return reply.notFound('Départ introuvable');
    if (!canManageTrip(staff, trip)) return reply.forbidden('Vous ne pouvez publier que les départs de votre arrêt');
    const requestedDepartureAt = body.departureAt ? new Date(body.departureAt) : trip.departureAt;
    if (Number.isNaN(requestedDepartureAt.getTime())) return reply.badRequest('Date et heure de départ invalides');
    if (requestedDepartureAt.getTime() !== trip.departureAt.getTime()) {
      const existingBookings = await prisma.booking.count({ where: { tripId } });
      if (existingBookings > 0) return reply.conflict('La date ou l’heure ne peut plus être modifiée après une réservation');
    }
    // Règle métier : le véhicule doit être choisi EXPLICITEMENT par l'opérateur.
    // Aucun repli automatique sur l'ancien véhicule ni sur une valeur par défaut.
    const vehicleSelection = requireExplicitVehicleSelection(body.vehicleId);
    if (!vehicleSelection.ok) return reply.badRequest('Choisissez explicitement le véhicule de ce départ avant de publier.');
    const selectedVehicleId = vehicleSelection.vehicleId;
    const vehicle = await prisma.vehicle.findUnique({ where: { id: selectedVehicleId }, include: { primaryDriver: { select: { id: true } } } });
    const selectedDriverId = resolveDefaultDriverId({
      requestedDriverId: body.driverId ?? null,
      existingTripDriverId: trip.driverId,
      selectedVehicleId,
      previousVehicleId: trip.vehicleId,
      vehiclePrimaryDriverId: vehicle?.primaryDriver?.id ?? null,
    });
    if (selectedDriverId) {
      const driver = await prisma.user.findUnique({ where: { id: selectedDriverId }, select: { id: true, role: true, primaryVehicleId: true } });
      if (!driver || driver.role !== UserRole.DRIVER) return reply.badRequest('Chauffeur invalide');
      const driverAssertion = assertDriverMatchesVehicle({
        driverPrimaryVehicleId: driver.primaryVehicleId,
        selectedVehicleId,
        staffRole: staff.role,
        exceptionalVehicleChange: body.exceptionalVehicleChange,
        exceptionalReason: body.exceptionalReason,
      });
      if (!driverAssertion.ok) {
        return reply.conflict('Ce chauffeur est rattaché à un autre véhicule. Un changement exceptionnel doit être autorisé par un administrateur avec un motif.');
      }
    }
    if (!vehicle || !vehicle.active) return reply.badRequest('Véhicule indisponible');
    const nextVehicleCode = body.vehicleCode?.trim();
    if (nextVehicleCode && nextVehicleCode !== vehicle.code) {
      const exceptionAuthorized = staff.role === UserRole.ADMIN || staff.role === UserRole.SUPER_ADMIN;
      if (!exceptionAuthorized) {
        return reply.badRequest('Seul un administrateur ou le super administrateur peut modifier le code du véhicule. Utilisez l\'écran de gestion des véhicules.');
      }
      const duplicate = await prisma.vehicle.findUnique({ where: { code: nextVehicleCode } });
      if (duplicate && duplicate.id !== vehicle.id) return reply.conflict('Ce numéro de véhicule est déjà utilisé');
      await prisma.vehicle.update({ where: { id: vehicle.id }, data: { code: nextVehicleCode } });
      vehicle.code = nextVehicleCode;
    }
    const bookedSeats = await prisma.seatBooking.count({ where: { tripId } });
    if (bookedSeats > vehicle.capacity) return reply.conflict('Ce véhicule ne possède pas assez de places pour les réservations existantes');
    // Corrige la cause racine de l'incident FIF-3D70DA41B0 : l'ancien contrôle
    // ne regardait que les statuts PUBLISHED/FULL et ratait les voyages DRAFT
    // concurrents sur le même véhicule/créneau. checkVehicleConflict couvre
    // désormais tous les statuts actifs (DRAFT, SCHEDULED, PUBLISHED, FULL).
    const vehicleConflict = await checkVehicleConflict({
      prisma,
      tripId,
      vehicleId: selectedVehicleId,
      departureAt: requestedDepartureAt,
    });
    const exceptionAuthorized = staff.role === UserRole.ADMIN || staff.role === UserRole.SUPER_ADMIN;
    const exceptionValid = body.exceptionalVehicleChange === true && exceptionAuthorized && Boolean(body.exceptionalReason?.trim());
    if (vehicleConflict.hasConflict) {
      if (!exceptionValid) {
        request.log.warn(
          { tripId, vehicleId: selectedVehicleId, conflictingTripIds: vehicleConflict.conflictingTrips.map((t) => t.id) },
          'Conflit véhicule/créneau détecté à la publication',
        );
        return reply.conflict('Ce véhicule est déjà affecté à un autre départ à cette date et heure (y compris un brouillon non publié).');
      }
    }
    const updated = await prisma.trip.update({ where: { id: tripId, }, data: { departureAt: requestedDepartureAt, vehicleId: selectedVehicleId, driverId: selectedDriverId || null, status: bookedSeats >= vehicle.capacity ? TripStatus.FULL : TripStatus.PUBLISHED, operatorId: staff.id, publishedAt: new Date(), exceptionalVehicleChangeReason: exceptionValid ? body.exceptionalReason!.trim() : trip.exceptionalVehicleChangeReason, exceptionalVehicleChangeById: exceptionValid ? staff.id : trip.exceptionalVehicleChangeById, exceptionalVehicleChangeAt: exceptionValid ? new Date() : trip.exceptionalVehicleChangeAt, priceAr: body.priceAr, depositRequiredAr: body.depositRequiredAr, meetingPoint: body.meetingPoint?.trim() || null, meetingTime: body.meetingTime?.trim() || null, operatorPhone: body.operatorPhone?.trim() || null, paymentMessage: body.paymentMessage?.trim() || null, mvolaNumber: body.mvolaNumber?.trim() || null, mvolaAccountName: body.mvolaAccountName?.trim() || null, orangeMoneyNumber: body.orangeMoneyNumber?.trim() || null, orangeMoneyAccountName: body.orangeMoneyAccountName?.trim() || null, airtelMoneyNumber: body.airtelMoneyNumber?.trim() || null, airtelMoneyAccountName: body.airtelMoneyAccountName?.trim() || null } });
    return { message: 'Départ publié pour les passagers.', trip: updated };
  } catch (error) {
    if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.conflict('Ce numéro de véhicule est déjà utilisé. Choisissez un autre numéro.');
    request.log.error({ err: error }, 'Erreur détaillée lors de la publication du départ');
    return reply.internalServerError('Impossible de publier le départ. Consultez le journal du backend.');
  }
});

app.get('/api/staff/trips/:tripId/manifest', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  const { tripId } = request.params as { tripId: string };
  try {
    const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: { vehicle: true, driver: { select: { id: true, fullName: true, email: true } }, departureStop: true, bookings: { include: { boardingStop: true, destinationStop: true, seatBookings: { orderBy: { seatNumber: 'asc' } } }, orderBy: { createdAt: 'asc' } }, waitlistEntries: { where: { status: 'WAITING' }, orderBy: { createdAt: 'asc' } } } });
    if (!trip) return reply.notFound('Départ introuvable');
    if (!canViewTrip(staff, trip)) return reply.forbidden('Ce manifeste est réservé au chauffeur assigné ou à la gestion autorisée');
    const visible = trip.bookings.filter((booking) => canViewBooking(staff, { boardingStopId: booking.boardingStopId, trip }));
    const totalReservedSeats = trip.bookings.filter((booking) => booking.status !== BookingStatus.CANCELLED).reduce((sum, booking) => sum + booking.seats, 0);
    const visibleReservedSeats = visible.filter((booking) => booking.status !== BookingStatus.CANCELLED).reduce((sum, booking) => sum + booking.seats, 0);
    return { trip: { id: trip.id, departureAt: trip.departureAt, vehicleCode: trip.vehicle.code, capacity: trip.vehicle.capacity, driverId: trip.driverId, driverName: trip.driver?.fullName ?? null, totalReservedSeats, visibleReservedSeats, departureStop: trip.departureStop?.name }, passengers: visible.map((booking) => ({ id: booking.id, reference: booking.reference, passengerName: booking.passengerName, passengerPhone: booking.passengerPhone, seats: booking.seatBookings.map((seat) => seat.seatNumber), status: booking.status, origin: booking.origin, amountPaidAr: booking.amountPaidAr, priceAtBookingAr: booking.priceAtBookingAr, paymentReference: booking.paymentReference, boardingStop: booking.boardingStop?.name, destinationStop: booking.destinationStop?.name })), waitlist: trip.waitlistEntries };
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de charger la liste passagers'); }
});

app.post('/api/staff/bookings/:bookingId/verify-payment', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  const { bookingId } = request.params as { bookingId: string };
  try {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { trip: true } });
    if (!booking || booking.status !== BookingStatus.PAYMENT_DECLARED) return reply.notFound('Déclaration de paiement introuvable');
    if (!canManageBooking(staff, booking)) return reply.forbidden('Vous ne pouvez vérifier que les paiements liés à votre arrêt');
    await prisma.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.CONFIRMED, paymentVerifiedAt: new Date(), verifiedById: staff.id } });
    return { message: 'Paiement vérifié. Réservation confirmée.' };
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de vérifier le paiement'); }
});

app.post('/api/staff/bookings/:bookingId/cancel', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  const { bookingId } = request.params as { bookingId: string }; const body = request.body as { reason?: string };
  try {
    const result = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { trip: { include: { vehicle: true } } } });
      if (!booking || booking.status === BookingStatus.CANCELLED) throw new Error('BOOKING_NOT_FOUND');
      if (!canManageBooking(staff, booking)) throw new Error('FORBIDDEN');
      await tx.seatBooking.deleteMany({ where: { bookingId } });
      await tx.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.CANCELLED, cancelledAt: new Date(), cancellationReason: body.reason?.trim() || 'Annulée par l’opérateur' } });
      const remaining = await tx.seatBooking.count({ where: { tripId: booking.tripId } });
      if (remaining < booking.trip.vehicle.capacity && booking.trip.status === TripStatus.FULL) await tx.trip.update({ where: { id: booking.tripId }, data: { status: TripStatus.PUBLISHED } });
      const nextWaiting = await tx.waitlistEntry.findFirst({ where: { tripId: booking.tripId, status: 'WAITING' }, orderBy: { createdAt: 'asc' } });
      return { remaining, capacity: booking.trip.vehicle.capacity, nextWaiting };
    });
    return { message: 'Réservation annulée et siège libéré.', availableSeats: result.capacity - result.remaining, nextWaitlistEntry: result.nextWaiting };
  } catch (error) { if (error instanceof Error && error.message === 'BOOKING_NOT_FOUND') return reply.notFound('Réservation introuvable'); if (error instanceof Error && error.message === 'FORBIDDEN') return reply.forbidden('Accès non autorisé'); if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible d’annuler la réservation'); }
});

app.get('/api/admin/bookings', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  if (staff.role === UserRole.DRIVER) return reply.forbidden('La vue globale des réservations est réservée à la gestion');
  const query = request.query as { date?: string; direction?: Direction; vehicle?: string; status?: BookingStatus; stopId?: string; origin?: BookingOrigin; paymentNetwork?: PaymentNetwork; search?: string };
  const date = query.date ? parseDate(query.date) : null; if (query.date && !date) return reply.badRequest('date invalide');
  const next = date ? new Date(date) : null; next?.setUTCDate(next.getUTCDate() + 1);
  try {
    const accessFilters: Prisma.BookingWhereInput[] = [];
    if (query.search) accessFilters.push({ OR: [{ passengerName: { contains: query.search, mode: Prisma.QueryMode.insensitive } }, { passengerPhone: { contains: query.search } }, { reference: { contains: query.search, mode: Prisma.QueryMode.insensitive } }] });
    if (staff.role === UserRole.OPERATOR) accessFilters.push({ OR: [{ boardingStopId: staff.managedStopId! }, { trip: { departureStopId: staff.managedStopId! } }] });
    const bookingWhere: Prisma.BookingWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.origin ? { origin: query.origin } : {}),
      ...(query.paymentNetwork ? { paymentNetwork: query.paymentNetwork } : {}),
      ...(query.stopId && (staff.role === UserRole.SUPER_ADMIN || staff.role === UserRole.ADMIN) ? { boardingStopId: query.stopId } : {}),
      ...(accessFilters.length > 0 ? { AND: accessFilters } : {}),
      trip: {
        ...(date && next ? { departureAt: { gte: date, lt: next } } : {}),
        ...(query.direction ? { route: { direction: query.direction } } : {}),
        ...(query.vehicle ? { vehicle: { code: query.vehicle } } : {}),
      },
    };
    const bookings = (await prisma.booking.findMany({
      where: bookingWhere,
      include: { trip: { include: { vehicle: true, route: true, departureStop: true } }, seatBookings: { orderBy: { seatNumber: 'asc' } }, boardingStop: true, destinationStop: true },
      orderBy: [{ trip: { departureAt: 'asc' } }, { createdAt: 'asc' }],
    })) as unknown as AdminBookingRow[];
    return bookings.map((booking) => ({ id: booking.id, reference: booking.reference, passengerName: booking.passengerName, passengerPhone: booking.passengerPhone, seats: booking.seatBookings.map((seat) => seat.seatNumber), createdAt: booking.createdAt, departureAt: booking.trip.departureAt, vehicleCode: booking.trip.vehicle.code, route: booking.trip.route.name, tripStatus: booking.trip.status, bookingStatus: booking.status, origin: booking.origin, paymentNetwork: booking.paymentNetwork, amountPaidAr: booking.amountPaidAr, depositRequiredAr: booking.depositRequiredAr, priceAtBookingAr: booking.priceAtBookingAr, boardingStop: booking.boardingStop?.name ?? booking.trip.departureStop?.name ?? null, destinationStop: booking.destinationStop?.name ?? null }));
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); request.log.error(error); return reply.internalServerError('Impossible de charger les réservations'); }
});

app.post('/api/staff/counter-bookings', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  if (staff.role === UserRole.DRIVER) return reply.forbidden('Le chauffeur ne peut pas créer une réservation au guichet');
  const body = request.body as { tripId?: string; passengerName?: string; passengerPhone?: string; seatNumbers?: number[]; boardingStopId?: string; destinationStopId?: string; createdAtStopId?: string; amountPaidAr?: number; paymentNetwork?: PaymentNetwork; paymentReference?: string };
  const name = body.passengerName?.trim(); const phone = body.passengerPhone?.trim(); const seats = Array.isArray(body.seatNumbers) ? body.seatNumbers : [];
  const amountPaidAr = Number.isInteger(body.amountPaidAr) ? (body.amountPaidAr as number) : 0;
  const paymentNetwork = body.paymentNetwork ?? null;
  const paymentReference = body.paymentReference?.trim() ?? null;
  if (!body.tripId || !name || !phone || seats.length === 0) return reply.badRequest('voyage, nom, téléphone et au moins un siège sont obligatoires');
  if (new Set(seats).size !== seats.length || seats.some((seat) => !Number.isInteger(seat) || seat < 1 || seat > 17)) return reply.badRequest('sélection de sièges invalide');
  if (amountPaidAr < 0) return reply.badRequest('Le montant payé ne peut pas être négatif');
  if (amountPaidAr > 0 && (!paymentNetwork || !Object.values(PaymentNetwork).includes(paymentNetwork) || !paymentReference)) return reply.badRequest('Réseau et référence de transaction sont requis pour un paiement');
  try {
    const result = await prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: body.tripId }, include: { vehicle: true, route: { include: { stops: { include: { stop: true }, orderBy: { order: 'asc' } } } } } });
      if (!trip || !BOOKABLE_TRIP_STATUSES.includes(trip.status)) throw new Error('TRIP_UNAVAILABLE');
      // Corrige une divergence de contrôle d'accès avec /api/staff/bookings/counter :
      // avant, seul boardingStopId était vérifié ici, jamais trip.departureStopId,
      // ce qui permettait à un opérateur de réserver sur un voyage géré par un
      // autre arrêt tant que boardingStopId pointait vers son propre arrêt.
      const authorization = assertOperatorCanCreateCounterBooking({
        staff,
        trip: { departureStopId: trip.departureStopId },
        boardingStopId: body.boardingStopId ?? null,
      });
      if (!authorization.ok) throw new Error('COUNTER_STOP_FORBIDDEN');
      if (seats.some((seat) => seat > trip.vehicle.capacity)) throw new Error('SEAT_RANGE');
      const orderedStops = trip.route.stops;
      const boardingStopId = body.boardingStopId ?? staff.managedStopId ?? orderedStops[0]?.stopId;
      const destinationStopId = body.destinationStopId ?? orderedStops[orderedStops.length - 1]?.stopId;
      const boardingIndex = orderedStops.findIndex((routeStop) => routeStop.stopId === boardingStopId);
      const destinationIndex = orderedStops.findIndex((routeStop) => routeStop.stopId === destinationStopId);
      if (!boardingStopId || !destinationStopId || boardingIndex < 0 || destinationIndex < 0 || boardingIndex >= destinationIndex) throw new Error('INVALID_STOPS');
      const occupied = await tx.seatBooking.count({ where: { tripId: trip.id, seatNumber: { in: seats } } });
      if (occupied) throw new Error('SEAT_TAKEN');
      let reference = makeReference(); while (await tx.booking.findUnique({ where: { reference } })) reference = makeReference();
      const total = trip.priceAr * seats.length;
      if (amountPaidAr > total) throw new Error('PAYMENT_AMOUNT');
      const booking = await tx.booking.create({ data: { reference, tripId: trip.id, passengerName: name, passengerPhone: phone, seats: seats.length, boardingStopId, destinationStopId, priceAtBookingAr: total, depositRequiredAr: trip.depositRequiredAr * seats.length, status: amountPaidAr > 0 ? BookingStatus.PAYMENT_DECLARED : BookingStatus.PENDING_PAYMENT, ...(amountPaidAr > 0 ? { amountPaidAr, paymentNetwork, paymentReference, paymentDeclaredAt: new Date() } : {}), origin: BookingOrigin.COUNTER, createdById: staff.id, createdAtStopId: body.createdAtStopId ?? staff.managedStopId ?? null } });
      await tx.seatBooking.createMany({ data: seats.map((seatNumber) => ({ tripId: trip.id, bookingId: booking.id, seatNumber })) });
      const bookedSeats = await tx.seatBooking.count({ where: { tripId: trip.id } }); if (bookedSeats >= trip.vehicle.capacity) await tx.trip.update({ where: { id: trip.id }, data: { status: TripStatus.FULL } });
      return { booking, full: bookedSeats >= trip.vehicle.capacity, departureAt: trip.departureAt, route: trip.route.name, vehicleCode: trip.vehicle.code, boardingStopName: orderedStops.find((item) => item.stopId === booking.boardingStopId)?.stop?.name ?? null, destinationStopName: orderedStops.find((item) => item.stopId === booking.destinationStopId)?.stop?.name ?? null };
    });
    return reply.code(201).send({ id: result.booking.id, reference: result.booking.reference, origin: BookingOrigin.COUNTER, status: result.booking.status, message: 'Réservation guichet enregistrée.', full: result.full, passengerName: name, passengerPhone: phone, seats, amountPaidAr, priceAtBookingAr: result.booking.priceAtBookingAr, depositRequiredAr: result.booking.depositRequiredAr, departureAt: result.departureAt.toISOString(), route: result.route, vehicleCode: result.vehicleCode, boardingStop: result.boardingStopName, destinationStop: result.destinationStopName, createdBy: staff.fullName, createdAt: result.booking.createdAt.toISOString() });
  } catch (error) {
    if (error instanceof Error && error.message === 'TRIP_UNAVAILABLE') return reply.conflict('Ce départ n’est plus disponible.');
    if (error instanceof Error && error.message === 'COUNTER_STOP_FORBIDDEN') return reply.forbidden('Cette réservation guichet doit être créée depuis votre arrêt géré.');
    if (error instanceof Error && error.message === 'SEAT_RANGE') return reply.badRequest('Siège hors capacité du véhicule');
    if (error instanceof Error && error.message === 'INVALID_STOPS') return reply.badRequest('Arrêts de montée et destination invalides');
    if (error instanceof Error && error.message === 'SEAT_TAKEN') return reply.conflict('Un des sièges vient d’être réservé');
    if (error instanceof Error && error.message === 'PAYMENT_AMOUNT') return reply.badRequest('Le montant payé dépasse le total de la réservation');
    if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error);
    request.log.error(error); return reply.internalServerError('Impossible d’enregistrer la réservation guichet');
  }
});

app.post('/api/feedback', async (request, reply) => {
  const body = request.body as { type?: FeedbackType; authorType?: FeedbackAuthorType; authorName?: string; authorPhone?: string; bookingReference?: string; subject?: string; message?: string; rating?: number; audience?: FeedbackAudience };
  if (!body.type || !body.authorType || !body.authorName?.trim() || !body.message?.trim()) return reply.badRequest('type, auteur, nom et message sont obligatoires');
  if (body.type === FeedbackType.REVIEW && body.rating !== undefined && (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5)) return reply.badRequest('La note doit être comprise entre 1 et 5');
  try {
    const booking = body.bookingReference ? await prisma.booking.findUnique({ where: { reference: body.bookingReference.trim() }, select: { id: true } }) : null;
    const feedback = await prisma.feedback.create({ data: { type: body.type, authorType: body.authorType, audience: body.audience ?? FeedbackAudience.SUPER_ADMIN, authorName: body.authorName.trim(), authorPhone: body.authorPhone?.trim(), bookingId: booking?.id, subject: body.subject?.trim(), message: body.message.trim(), rating: body.rating } });
    return reply.code(201).send({ id: feedback.id, status: feedback.status, message: body.type === FeedbackType.COMPLAINT ? 'Votre plainte a été enregistrée.' : 'Votre avis a été enregistré.' });
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible d’enregistrer votre message'); }
});

app.get('/api/staff/feedback', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  const query = request.query as { type?: FeedbackType; status?: FeedbackStatus; audience?: FeedbackAudience; priority?: string };
  if (staff.role === UserRole.OPERATOR || staff.role === UserRole.DRIVER) return reply.forbidden('Les avis et plaintes sont réservés à la gestion');
  const where: Prisma.FeedbackWhereInput = { ...(query.type ? { type: query.type } : {}), ...(query.status ? { status: query.status } : {}), ...(query.audience ? { audience: query.audience } : {}), ...(query.priority ? { priority: Number(query.priority) } : {}) };
  try { return await prisma.feedback.findMany({ where, include: { booking: { select: { reference: true, passengerName: true } }, assignedTo: { select: { fullName: true, email: true } } }, orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }] }); } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de charger les avis et plaintes'); }
});

app.patch('/api/staff/feedback/:id', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  if (staff.role !== UserRole.SUPER_ADMIN && staff.role !== UserRole.ADMIN) return reply.forbidden('Droit de gestion insuffisant');
  const body = request.body as { status?: FeedbackStatus; response?: string; assignedToId?: string | null; audience?: FeedbackAudience; priority?: number };
  try {
    const updated = await prisma.feedback.update({ where: { id: (request.params as { id: string }).id }, data: { ...(body.status ? { status: body.status } : {}), ...(body.response !== undefined ? { response: body.response } : {}), ...(body.assignedToId !== undefined ? { assignedToId: body.assignedToId } : {}), ...(body.audience ? { audience: body.audience } : {}), ...(body.priority !== undefined ? { priority: body.priority } : {}), ...(body.status === FeedbackStatus.RESOLVED || body.status === FeedbackStatus.CLOSED ? { resolvedAt: new Date() } : {}) } });
    return { id: updated.id, status: updated.status, message: 'Avis/plainte mis à jour.' };
  } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return reply.notFound('Avis ou plainte introuvable'); if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de mettre à jour cet élément'); }
});

app.get('/api/super-admin/overview', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  if (staff.role !== UserRole.SUPER_ADMIN) return reply.forbidden('Réservé au super administrateur');
  const query = request.query as { from?: string; to?: string };
  const from = query.from ? parseDate(query.from) : null; const to = query.to ? parseDate(query.to) : null; if ((query.from && !from) || (query.to && !to)) return reply.badRequest('Période invalide');
  const where: Prisma.BookingWhereInput = { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86400000) } : {}) } };
  try {
    const [total, confirmed, cancelled, sums, byOrigin] = await Promise.all([prisma.booking.count({ where }), prisma.booking.count({ where: { ...where, status: BookingStatus.CONFIRMED } }), prisma.booking.count({ where: { ...where, status: BookingStatus.CANCELLED } }), prisma.booking.aggregate({ where, _sum: { priceAtBookingAr: true, amountPaidAr: true, seats: true } }), prisma.booking.groupBy({ by: ['origin'], where, _count: { _all: true }, _sum: { seats: true, priceAtBookingAr: true, amountPaidAr: true } })]);
    return { period: { from, to }, reservations: { total, confirmed, cancelled }, totals: { seats: sums._sum.seats ?? 0, grossAmountAr: sums._sum.priceAtBookingAr ?? 0, paidAmountAr: sums._sum.amountPaidAr ?? 0 }, byOrigin };
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de charger la vue globale'); }
});

app.addHook('onClose', async () => prisma.$disconnect());
await app.listen({ host: env.HOST, port: env.PORT });
