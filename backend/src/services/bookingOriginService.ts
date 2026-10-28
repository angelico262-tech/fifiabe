// backend/src/services/bookingOriginService.ts
//
// Isole deux règles aujourd'hui dupliquées (et divergentes) entre les deux
// endpoints guichet /api/staff/bookings/counter et /api/staff/counter-bookings :
//   1) qui a le droit de créer une réservation guichet sur quel voyage,
//   2) quelle valeur BookingOrigin attribuer selon le canal.
//
// Constat d'audit : /api/staff/counter-bookings vérifie uniquement que
// `boardingStopId` correspond à l'arrêt géré par l'opérateur, sans jamais
// appeler `canManageTrip` (contrairement à /api/staff/bookings/counter).
// Un opérateur pouvait donc créer une réservation guichet sur un voyage
// dont il ne gère pas l'arrêt de départ, tant que `boardingStopId` déclaré
// dans le corps de la requête pointait vers son propre arrêt. Cette fonction
// unique doit être appelée par les deux routes pour supprimer la divergence.

import { BookingOrigin, UserRole } from '@prisma/client';

export type AuthUser = {
  id: string;
  role: UserRole;
  managedStopId: string | null;
};

export type CounterBookingAuthorizationInput = {
  staff: AuthUser;
  trip: { departureStopId: string | null };
  boardingStopId: string | null;
};

export type CounterBookingAuthorizationResult =
  | { ok: true }
  | { ok: false; reason: 'TRIP_NOT_MANAGED' | 'BOARDING_STOP_MISMATCH' };

/**
 * Un opérateur ne peut créer une réservation guichet que :
 *   - sur un voyage dont il gère l'arrêt de départ (ou qui reçoit déjà des
 *     réservations à son arrêt — même règle que canManageTrip), ET
 *   - avec un boardingStopId qui correspond à son propre arrêt géré.
 *
 * Les deux conditions sont désormais vérifiées ensemble, quel que soit
 * l'endpoint appelant.
 */
export function assertOperatorCanCreateCounterBooking(
  input: CounterBookingAuthorizationInput,
): CounterBookingAuthorizationResult {
  const { staff, trip, boardingStopId } = input;

  // Les rôles ADMIN / SUPER_ADMIN ne sont pas restreints à un arrêt géré.
  if (staff.role !== UserRole.OPERATOR) return { ok: true };

  const managesTripDeparture = staff.managedStopId != null && trip.departureStopId === staff.managedStopId;
  if (!managesTripDeparture) return { ok: false, reason: 'TRIP_NOT_MANAGED' };

  if (staff.managedStopId && boardingStopId !== staff.managedStopId) {
    return { ok: false, reason: 'BOARDING_STOP_MISMATCH' };
  }

  return { ok: true };
}

export type BookingChannel = 'public_app' | 'staff_counter' | 'legacy_import';

/**
 * Traduit un canal applicatif en BookingOrigin Prisma, en un seul endroit,
 * pour que l'origine reste toujours explicite et jamais déduite au hasard
 * dans les routes.
 */
export function resolveBookingOrigin(channel: BookingChannel): BookingOrigin {
  switch (channel) {
    case 'public_app':
      return BookingOrigin.PASSENGER_APP;
    case 'staff_counter':
      return BookingOrigin.COUNTER;
    case 'legacy_import':
      return BookingOrigin.LEGACY_UNKNOWN;
  }
}
