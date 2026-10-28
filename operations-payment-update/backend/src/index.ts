import crypto from 'node:crypto';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { BookingStatus, Direction, PaymentNetwork, Prisma, PrismaClient, TripStatus, UserRole } from '@prisma/client';
import { env } from './config/env.js';
import { healthRoutes } from './routes/health.routes.js';

const app = Fastify({ logger: true });
const prisma = new PrismaClient({ transactionOptions: { maxWait: 15000, timeout: 30000, isolationLevel: 'Serializable' } });
await app.register(cors, { origin: env.CORS_ORIGIN });
await app.register(sensible);
await app.register(healthRoutes);

const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P2024', 'P2028']);
const SESSION_SECONDS = 8 * 60 * 60;
const loginAttempts = new Map<string, { failures: number; blockedUntil: number }>();
const STAFF_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.OPERATOR];
const PUBLIC_TRIP_STATUSES: TripStatus[] = [TripStatus.PUBLISHED, TripStatus.FULL, TripStatus.SCHEDULED];
const BOOKABLE_TRIP_STATUSES: TripStatus[] = [TripStatus.PUBLISHED, TripStatus.SCHEDULED];

type SessionPayload = { sub: string; role: UserRole; stopId?: string; exp: number };
type AuthUser = { id: string; role: UserRole; managedStopId: string | null; fullName: string };

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
  if (!user || !STAFF_ROLES.includes(user.role)) { await reply.forbidden('Accès réservé au personnel FIFIABE'); return null; }
  return user;
}
function canManageTrip(user: AuthUser, trip: { departureStopId: string | null }) {
  return user.role === UserRole.ADMIN || (user.role === UserRole.OPERATOR && user.managedStopId === trip.departureStopId);
}
function makeReference() { return `FIF-${crypto.randomBytes(5).toString('hex').toUpperCase()}`; }
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
        priceAtBookingAr: trip.priceAr * seats.length, depositRequiredAr: trip.depositRequiredAr * seats.length, status: BookingStatus.PENDING_PAYMENT,
      } });
      await tx.seatBooking.createMany({ data: seats.map((seatNumber) => ({ tripId: trip.id, bookingId: booking.id, seatNumber })) });
      const total = await tx.seatBooking.count({ where: { tripId: trip.id } });
      if (total >= trip.vehicle.capacity) await tx.trip.update({ where: { id: trip.id }, data: { status: TripStatus.FULL } });
      return { booking, full: total >= trip.vehicle.capacity };
    });
    return reply.code(201).send({ id: result.booking.id, reference: result.booking.reference, status: result.booking.status, message: 'Place réservée. Conservez votre référence pour suivre le paiement.', seatNumbers: seats, full: result.full });
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

app.get('/api/reservations/:reference', async (request, reply) => {
  const { reference } = request.params as { reference: string };
  if (!/^FIF-[A-F0-9]{10}$/i.test(reference)) return reply.badRequest('Référence de réservation invalide');
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
  if (!body.network || !Object.values(PaymentNetwork).includes(body.network) || !body.paymentReference?.trim() || !body.payerPhone?.trim() || typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return reply.badRequest('Réseau, référence de transaction, numéro émetteur et montant sont obligatoires');
  try {
    const booking = await prisma.booking.findUnique({ where: { reference: reference.toUpperCase() } });
    if (!booking || booking.status === BookingStatus.CANCELLED) return reply.notFound('Réservation introuvable ou annulée');
    if (amount < booking.depositRequiredAr) return reply.badRequest(`L’avance déclarée doit être au moins de ${booking.depositRequiredAr} Ar`);
    const updated = await prisma.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.PAYMENT_DECLARED, paymentNetwork: body.network, paymentReference: body.paymentReference.trim(), payerPhone: body.payerPhone.trim(), amountPaidAr: amount, paymentDeclaredAt: new Date() } });
    return { message: 'Paiement déclaré. Il sera confirmé après vérification par l’opérateur.', status: updated.status };
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
    const vehicles = await prisma.vehicle.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
    return vehicles.map((vehicle) => ({ id: vehicle.id, code: vehicle.code, capacity: vehicle.capacity }));
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de charger les véhicules'); }
});

app.get('/api/staff/trips', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  const query = request.query as { date?: string; status?: TripStatus };
  const date = query.date ? parseDate(query.date) : null; if (query.date && !date) return reply.badRequest('date invalide');
  const next = date ? new Date(date) : null; next?.setUTCDate(next.getUTCDate() + 1);
  try {
    const trips = await prisma.trip.findMany({
      where: { ...(staff.role === UserRole.OPERATOR ? { departureStopId: staff.managedStopId! } : {}), ...(date && next ? { departureAt: { gte: date, lt: next } } : {}), ...(query.status ? { status: query.status } : {}) },
      include: { vehicle: true, route: true, departureStop: true, seatBookings: true, waitlistEntries: { where: { status: 'WAITING' } } }, orderBy: { departureAt: 'asc' },
    });
    return trips.map((trip) => ({ id: trip.id, vehicleId: trip.vehicleId, departureAt: trip.departureAt, status: trip.status, priceAr: trip.priceAr, depositRequiredAr: trip.depositRequiredAr, vehicleCode: trip.vehicle.code, capacity: trip.vehicle.capacity, bookedSeats: trip.seatBookings.length, availableSeats: trip.vehicle.capacity - trip.seatBookings.length, route: trip.route.name, departureStop: trip.departureStop?.name, waitlistCount: trip.waitlistEntries.length, meetingPoint: trip.meetingPoint, meetingTime: trip.meetingTime }));
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de charger les départs'); }
});

app.put('/api/staff/trips/:tripId/publication', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  const { tripId } = request.params as { tripId: string };
  const body = request.body as { vehicleId?: string; vehicleCode?: string; priceAr?: number; depositRequiredAr?: number; meetingPoint?: string; meetingTime?: string; operatorPhone?: string; paymentMessage?: string; mvolaNumber?: string; mvolaAccountName?: string; orangeMoneyNumber?: string; orangeMoneyAccountName?: string; airtelMoneyNumber?: string; airtelMoneyAccountName?: string };
  if (!Number.isInteger(body.priceAr) || body.priceAr! <= 0 || !Number.isInteger(body.depositRequiredAr) || body.depositRequiredAr! < 0 || body.depositRequiredAr! > body.priceAr!) return reply.badRequest('Tarif ou avance invalide');
  try {
    const trip = await prisma.trip.findUnique({ where: { id: tripId } }); if (!trip) return reply.notFound('Départ introuvable');
    if (!canManageTrip(staff, trip)) return reply.forbidden('Vous ne pouvez publier que les départs de votre arrêt');
    const selectedVehicleId = body.vehicleId || trip.vehicleId;
    const vehicle = await prisma.vehicle.findUnique({ where: { id: selectedVehicleId } });
    if (!vehicle || !vehicle.active) return reply.badRequest('Véhicule indisponible');
    const nextVehicleCode = body.vehicleCode?.trim();
    if (nextVehicleCode && nextVehicleCode !== vehicle.code) {
      const duplicate = await prisma.vehicle.findUnique({ where: { code: nextVehicleCode } });
      if (duplicate && duplicate.id !== vehicle.id) return reply.conflict('Ce numéro de véhicule est déjà utilisé');
      await prisma.vehicle.update({ where: { id: vehicle.id }, data: { code: nextVehicleCode } });
      vehicle.code = nextVehicleCode;
    }
    const bookedSeats = await prisma.seatBooking.count({ where: { tripId } });
    if (bookedSeats > vehicle.capacity) return reply.conflict('Ce véhicule ne possède pas assez de places pour les réservations existantes');
    const conflictingTrip = await prisma.trip.findFirst({ where: { id: { not: tripId }, vehicleId: selectedVehicleId, departureAt: trip.departureAt, status: { in: [TripStatus.PUBLISHED, TripStatus.FULL] } } });
    if (conflictingTrip) return reply.conflict('Ce véhicule est déjà affecté à un autre départ à cette date et heure');
    const updated = await prisma.trip.update({ where: { id: tripId }, data: { vehicleId: selectedVehicleId, status: bookedSeats >= vehicle.capacity ? TripStatus.FULL : TripStatus.PUBLISHED, operatorId: staff.id, publishedAt: new Date(), priceAr: body.priceAr, depositRequiredAr: body.depositRequiredAr, meetingPoint: body.meetingPoint?.trim() || null, meetingTime: body.meetingTime?.trim() || null, operatorPhone: body.operatorPhone?.trim() || null, paymentMessage: body.paymentMessage?.trim() || null, mvolaNumber: body.mvolaNumber?.trim() || null, mvolaAccountName: body.mvolaAccountName?.trim() || null, orangeMoneyNumber: body.orangeMoneyNumber?.trim() || null, orangeMoneyAccountName: body.orangeMoneyAccountName?.trim() || null, airtelMoneyNumber: body.airtelMoneyNumber?.trim() || null, airtelMoneyAccountName: body.airtelMoneyAccountName?.trim() || null } });
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
    const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: { vehicle: true, departureStop: true, bookings: { include: { boardingStop: true, destinationStop: true, seatBookings: { orderBy: { seatNumber: 'asc' } } }, orderBy: { createdAt: 'asc' } }, waitlistEntries: { where: { status: 'WAITING' }, orderBy: { createdAt: 'asc' } } } });
    if (!trip) return reply.notFound('Départ introuvable'); if (!canManageTrip(staff, trip) && staff.role !== UserRole.ADMIN) return reply.forbidden('Accès non autorisé');
    const visible = trip.bookings;
    return { trip: { id: trip.id, departureAt: trip.departureAt, vehicleCode: trip.vehicle.code, capacity: trip.vehicle.capacity, totalReservedSeats: trip.bookings.filter((booking) => booking.status !== BookingStatus.CANCELLED).reduce((sum, booking) => sum + booking.seats, 0), departureStop: trip.departureStop?.name }, passengers: visible.map((booking) => ({ id: booking.id, reference: booking.reference, passengerName: booking.passengerName, passengerPhone: booking.passengerPhone, seats: booking.seatBookings.map((seat) => seat.seatNumber), status: booking.status, amountPaidAr: booking.amountPaidAr, paymentReference: booking.paymentReference, boardingStop: booking.boardingStop?.name, destinationStop: booking.destinationStop?.name })), waitlist: trip.waitlistEntries };
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); return reply.internalServerError('Impossible de charger la liste passagers'); }
});

app.post('/api/staff/bookings/:bookingId/verify-payment', async (request, reply) => {
  const staff = await requireStaff(request, reply); if (!staff) return;
  const { bookingId } = request.params as { bookingId: string };
  try {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { trip: true } });
    if (!booking || booking.status !== BookingStatus.PAYMENT_DECLARED) return reply.notFound('Déclaration de paiement introuvable');
    if (!canManageTrip(staff, booking.trip)) return reply.forbidden('Vous ne pouvez vérifier que les paiements de votre arrêt');
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
      if (!canManageTrip(staff, booking.trip)) throw new Error('FORBIDDEN');
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
  const query = request.query as { date?: string; direction?: Direction; vehicle?: string; status?: BookingStatus; stopId?: string; search?: string };
  const date = query.date ? parseDate(query.date) : null; if (query.date && !date) return reply.badRequest('date invalide');
  const next = date ? new Date(date) : null; next?.setUTCDate(next.getUTCDate() + 1);
  try {
    const bookings = await prisma.booking.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.stopId && staff.role === UserRole.ADMIN ? { boardingStopId: query.stopId } : {}),
        ...(query.search ? { OR: [{ passengerName: { contains: query.search, mode: 'insensitive' } }, { passengerPhone: { contains: query.search } }, { reference: { contains: query.search, mode: 'insensitive' } }] } : {}),
        trip: {
          ...(staff.role === UserRole.OPERATOR ? { departureStopId: staff.managedStopId! } : {}),
          ...(date && next ? { departureAt: { gte: date, lt: next } } : {}),
          ...(query.direction ? { route: { direction: query.direction } } : {}),
          ...(query.vehicle ? { vehicle: { code: query.vehicle } } : {}),
        },
      },
      include: { trip: { include: { vehicle: true, route: true, departureStop: true } }, seatBookings: { orderBy: { seatNumber: 'asc' } }, boardingStop: true },
      orderBy: [{ trip: { departureAt: 'asc' } }, { createdAt: 'asc' }],
    });
    return bookings.map((booking) => ({ id: booking.id, reference: booking.reference, passengerName: booking.passengerName, passengerPhone: booking.passengerPhone, seats: booking.seatBookings.map((seat) => seat.seatNumber), createdAt: booking.createdAt, departureAt: booking.trip.departureAt, vehicleCode: booking.trip.vehicle.code, route: booking.trip.route.name, tripStatus: booking.trip.status, bookingStatus: booking.status, amountPaidAr: booking.amountPaidAr, depositRequiredAr: booking.depositRequiredAr, boardingStop: booking.boardingStop?.name ?? booking.trip.departureStop?.name ?? null }));
  } catch (error) { if (isTransientDatabaseError(error)) return databaseUnavailable(request, reply, error); request.log.error(error); return reply.internalServerError('Impossible de charger les réservations'); }
});

app.addHook('onClose', async () => prisma.$disconnect());
await app.listen({ host: env.HOST, port: env.PORT });
