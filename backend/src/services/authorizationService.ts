// backend/src/services/authorizationService.ts
//
// Contrôles d'autorisation centralisés, extraits de index.ts à l'IDENTIQUE
// (aucun changement de comportement) pour pouvoir être couverts par des tests
// unitaires : importer index.ts démarrerait le serveur Fastify.

import { UserRole } from '@prisma/client';

export type AuthUser = { id: string; role: UserRole; managedStopId: string | null; fullName: string };

export function canManageTrip(user: AuthUser, trip: { departureStopId: string | null }) {
  return user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN || (user.role === UserRole.OPERATOR && user.managedStopId === trip.departureStopId);
}

export function canViewTrip(user: AuthUser, trip: { driverId?: string | null; departureStopId: string | null; bookings?: { boardingStopId: string | null }[] }) {
  if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN) return true;
  if (user.role === UserRole.DRIVER) return trip.driverId === user.id;
  return user.role === UserRole.OPERATOR && !!user.managedStopId && (trip.departureStopId === user.managedStopId || trip.bookings?.some((booking) => booking.boardingStopId === user.managedStopId) === true);
}

export function canViewBooking(user: AuthUser, booking: { boardingStopId: string | null; trip: { driverId?: string | null; departureStopId: string | null } }) {
  if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN || user.role === UserRole.DRIVER) return true;
  if (user.role !== UserRole.OPERATOR || !user.managedStopId) return false;
  return booking.trip.departureStopId === user.managedStopId || booking.boardingStopId === user.managedStopId;
}

export function canManageBooking(user: AuthUser, booking: { boardingStopId: string | null; trip: { departureStopId: string | null } }) {
  return user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN || (user.role === UserRole.OPERATOR && canViewBooking(user, booking));
}
