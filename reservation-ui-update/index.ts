import crypto from 'node:crypto';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { Prisma, PrismaClient, Direction, UserRole } from '@prisma/client';
import { env } from './config/env.js';
import { healthRoutes } from './routes/health.routes.js';

const app = Fastify({ logger: true });
const prisma = new PrismaClient({
  transactionOptions: {
    maxWait: 15000,
    timeout: 30000,
    isolationLevel: 'Serializable',
  },
});

await app.register(cors, { origin: env.CORS_ORIGIN });
await app.register(sensible);
await app.register(healthRoutes);

const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P2024', 'P2028']);
const ADMIN_SESSION_DURATION_SECONDS = 8 * 60 * 60;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_COOLDOWN_MS = 15 * 60 * 1000;
const loginAttempts = new Map<string, { failures: number; blockedUntil: number }>();

type AdminTokenPayload = { sub: string; role: UserRole.ADMIN; exp: number };

function parseDate(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isTransientDatabaseError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && TRANSIENT_PRISMA_CODES.has(error.code);
}

function replyDatabaseUnavailable(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  request.log.warn({ err: error }, 'Connexion temporairement indisponible avec Supabase');
  return reply.code(503).send({
    message: 'Connexion temporairement indisponible avec la base de données. Réessayez dans quelques secondes.',
    retryable: true,
  });
}

function signAdminToken(payload: AdminTokenPayload) {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', env.JWT_SECRET).update(unsignedToken).digest('base64url');
  return `${unsignedToken}.${signature}`;
}

function verifyAdminToken(token: string): AdminTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, receivedSignature] = parts;
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto.createHmac('sha256', env.JWT_SECRET).update(unsignedToken).digest('base64url');
  if (receivedSignature.length !== expectedSignature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expectedSignature))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AdminTokenPayload;
    if (payload.role !== UserRole.ADMIN || !payload.sub || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function registerLoginFailure(clientId: string) {
  const current = loginAttempts.get(clientId) ?? { failures: 0, blockedUntil: 0 };
  const failures = current.failures + 1;
  const blockedUntil = failures >= MAX_LOGIN_ATTEMPTS ? Date.now() + LOGIN_COOLDOWN_MS : 0;
  loginAttempts.set(clientId, { failures: blockedUntil ? 0 : failures, blockedUntil });
}

function isLoginBlocked(clientId: string) {
  const current = loginAttempts.get(clientId);
  if (!current) return false;
  if (current.blockedUntil > Date.now()) return true;
  if (current.blockedUntil) loginAttempts.delete(clientId);
  return false;
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  const payload = token ? verifyAdminToken(token) : null;
  if (!payload) {
    await reply.unauthorized('Connexion administrateur requise');
    return null;
  }
  return payload;
}

app.get('/api/trips', async (request, reply) => {
  const query = request.query as { date?: string; direction?: string };
  if (!query.date || !query.direction) return reply.badRequest('date et direction sont obligatoires');
  const date = parseDate(query.date);
  if (!date) return reply.badRequest('date invalide');

  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const direction = query.direction === 'SAVA_TO_TANA' ? Direction.SAVA_TO_TANA : Direction.TANA_TO_SAVA;

  try {
    const trips = await prisma.trip.findMany({
      where: { departureAt: { gte: date, lt: nextDate }, route: { direction }, status: 'SCHEDULED' },
      include: { vehicle: true, route: true, seatBookings: { select: { seatNumber: true } } },
      orderBy: { departureAt: 'asc' },
    });

    return trips.map((trip) => ({
      id: trip.id,
      departureAt: trip.departureAt,
      priceAr: trip.priceAr,
      vehicleCode: trip.vehicle.code,
      capacity: trip.vehicle.capacity,
      bookedSeats: trip.seatBookings.length,
      availableSeats: trip.vehicle.capacity - trip.seatBookings.length,
      route: trip.route.name,
    }));
  } catch (error) {
    if (isTransientDatabaseError(error)) return replyDatabaseUnavailable(request, reply, error);
    request.log.error(error);
    return reply.internalServerError('Impossible de charger les départs');
  }
});

app.get('/api/trips/:tripId/seats', async (request, reply) => {
  const { tripId } = request.params as { tripId: string };

  try {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: { vehicle: true, seatBookings: { select: { seatNumber: true } } },
    });
    if (!trip) return reply.notFound('Voyage introuvable');

    const occupiedSeats = trip.seatBookings.map((seat) => seat.seatNumber);
    return {
      tripId: trip.id,
      vehicleCode: trip.vehicle.code,
      capacity: trip.vehicle.capacity,
      seats: Array.from({ length: trip.vehicle.capacity }, (_, index) => ({
        number: index + 1,
        occupied: occupiedSeats.includes(index + 1),
      })),
    };
  } catch (error) {
    if (isTransientDatabaseError(error)) return replyDatabaseUnavailable(request, reply, error);
    request.log.error(error);
    return reply.internalServerError('Impossible de charger le plan des sièges');
  }
});

app.post('/api/bookings', async (request, reply) => {
  const body = request.body as { tripId?: string; passengerName?: string; passengerPhone?: string; seatNumbers?: number[] };
  const passengerName = body.passengerName?.trim();
  const passengerPhone = body.passengerPhone?.trim();
  const seatNumbers = Array.isArray(body.seatNumbers) ? body.seatNumbers : [];

  if (!body.tripId || !passengerName || !passengerPhone || seatNumbers.length === 0) {
    return reply.badRequest('voyage, nom, téléphone et au moins un siège sont obligatoires');
  }
  if (passengerName.length < 2) return reply.badRequest('nom du passager invalide');
  if (new Set(seatNumbers).size !== seatNumbers.length || seatNumbers.some((seat) => !Number.isInteger(seat) || seat < 1 || seat > 17)) {
    return reply.badRequest('sélection de sièges invalide');
  }

  try {
    const booking = await prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: body.tripId }, include: { vehicle: true } });
      if (!trip || trip.status !== 'SCHEDULED') throw new Error('TRIP_NOT_AVAILABLE');
      if (seatNumbers.some((seat) => seat > trip.vehicle.capacity)) throw new Error('SEAT_OUT_OF_RANGE');

      const occupied = await tx.seatBooking.findMany({ where: { tripId: trip.id, seatNumber: { in: seatNumbers } } });
      if (occupied.length > 0) throw new Error('SEAT_ALREADY_BOOKED');

      const createdBooking = await tx.booking.create({
        data: { tripId: trip.id, passengerName, passengerPhone, seats: seatNumbers.length },
      });
      await tx.seatBooking.createMany({
        data: seatNumbers.map((seatNumber) => ({ tripId: trip.id, bookingId: createdBooking.id, seatNumber })),
      });
      return createdBooking;
    });

    return reply.code(201).send({ id: booking.id, message: 'Réservation enregistrée', seatNumbers });
  } catch (error) {
    if (error instanceof Error && error.message === 'TRIP_NOT_AVAILABLE') return reply.notFound('Voyage indisponible');
    if (error instanceof Error && error.message === 'SEAT_OUT_OF_RANGE') return reply.badRequest('Siège hors capacité du véhicule');
    if (error instanceof Error && error.message === 'SEAT_ALREADY_BOOKED') return reply.conflict('Un des sièges sélectionnés vient d’être réservé');
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.conflict('Un des sièges sélectionnés est déjà réservé');
    if (isTransientDatabaseError(error)) return replyDatabaseUnavailable(request, reply, error);

    request.log.error(error);
    return reply.internalServerError('Impossible d’enregistrer la réservation');
  }
});

app.post('/api/admin/login', async (request, reply) => {
  const clientId = request.ip;
  if (isLoginBlocked(clientId)) return reply.tooManyRequests('Trop de tentatives. Réessayez dans 15 minutes.');

  const body = request.body as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? '';
  if (!email || !password) return reply.badRequest('Adresse e-mail et mot de passe requis');

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    const passwordValid = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !passwordValid || user.role !== UserRole.ADMIN) {
      registerLoginFailure(clientId);
      request.log.warn({ email }, 'Tentative de connexion administrateur refusée');
      return reply.unauthorized('Identifiants administrateur invalides');
    }

    loginAttempts.delete(clientId);
    const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_SESSION_DURATION_SECONDS;
    const token = signAdminToken({ sub: user.id, role: UserRole.ADMIN, exp: expiresAt });
    return { token, expiresAt, fullName: user.fullName };
  } catch (error) {
    if (isTransientDatabaseError(error)) return replyDatabaseUnavailable(request, reply, error);
    request.log.error(error);
    return reply.internalServerError('Impossible de démarrer la session administrateur');
  }
});

app.get('/api/admin/bookings', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return;

  const query = request.query as { date?: string };
  const date = query.date ? parseDate(query.date) : null;
  if (query.date && !date) return reply.badRequest('date invalide');

  try {
    const nextDate = date ? new Date(date) : null;
    nextDate?.setUTCDate(nextDate.getUTCDate() + 1);
    const bookings = await prisma.booking.findMany({
      where: date && nextDate ? { trip: { departureAt: { gte: date, lt: nextDate } } } : undefined,
      include: {
        trip: { include: { vehicle: true, route: true } },
        seatBookings: { select: { seatNumber: true }, orderBy: { seatNumber: 'asc' } },
      },
      orderBy: [{ trip: { departureAt: 'asc' } }, { createdAt: 'asc' }],
    });

    return bookings.map((booking) => ({
      id: booking.id,
      passengerName: booking.passengerName,
      passengerPhone: booking.passengerPhone,
      seats: booking.seatBookings.map((seat) => seat.seatNumber),
      createdAt: booking.createdAt,
      departureAt: booking.trip.departureAt,
      vehicleCode: booking.trip.vehicle.code,
      route: booking.trip.route.name,
      status: booking.trip.status,
    }));
  } catch (error) {
    if (isTransientDatabaseError(error)) return replyDatabaseUnavailable(request, reply, error);
    request.log.error({ err: error, adminId: admin.sub }, 'Impossible de charger les réservations administrateur');
    return reply.internalServerError('Impossible de charger les réservations');
  }
});

app.addHook('onClose', async () => prisma.$disconnect());
await app.listen({ host: env.HOST, port: env.PORT });
