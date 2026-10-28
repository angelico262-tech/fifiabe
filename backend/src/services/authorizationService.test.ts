// Tests unitaires du service d'autorisation — FIFIABE
//
// Exécution : cd backend && pnpm test
// Fonctions pures extraites de index.ts : aucune connexion base requise.
//
// Couverture demandée : isolation du chauffeur (il ne voit que les voyages
// de SON véhicule) et cloisonnement des rôles opérateur/admin/super-admin.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UserRole } from '@prisma/client';
import { canManageBooking, canManageTrip, canViewBooking, canViewTrip, type AuthUser } from './authorizationService.js';

const STOP_SAMBAVA = 'stop-sambava';
const STOP_TANA = 'stop-tana';

function makeUser(overrides: Partial<AuthUser>): AuthUser {
  return { id: 'user-x', role: UserRole.OPERATOR, managedStopId: null, fullName: 'X', ...overrides };
}

describe("isolation du chauffeur — canViewTrip", () => {
  it("un chauffeur ne voit que les voyages où il est affecté (driverId = lui-même)", () => {
    const driver = makeUser({ id: 'driver-a', role: UserRole.DRIVER });
    const hisTrip = { driverId: 'driver-a', departureStopId: STOP_SAMBAVA };
    const otherTrip = { driverId: 'driver-b', departureStopId: STOP_SAMBAVA };
    assert.equal(canViewTrip(driver, hisTrip), true);
    assert.equal(canViewTrip(driver, otherTrip), false);
  });

  it("un chauffeur ne voit pas un voyage d'un autre véhicule même sans arrêt géré", () => {
    const driver = makeUser({ id: 'driver-a', role: UserRole.DRIVER, managedStopId: STOP_SAMBAVA });
    assert.equal(canViewTrip(driver, { driverId: 'driver-b', departureStopId: STOP_SAMBAVA }), false);
  });

  it("un chauffeur ne voit pas un voyage sans chauffeur affecté", () => {
    const driver = makeUser({ id: 'driver-a', role: UserRole.DRIVER });
    assert.equal(canViewTrip(driver, { driverId: null, departureStopId: STOP_SAMBAVA }), false);
  });

  it("un opérateur ne peut pas contourner l'isolation en se faisant passer pour un chauffeur", () => {
    // Un opérateur ne passe JAMAIS par la branche DRIVER, quel que soit son stop géré.
    const operator = makeUser({ id: 'driver-a', role: UserRole.OPERATOR, managedStopId: STOP_SAMBAVA });
    assert.equal(canViewTrip(operator, { driverId: 'driver-a', departureStopId: STOP_TANA }), false);
  });

  it("les administrateurs voient tous les voyages", () => {
    for (const role of [UserRole.ADMIN, UserRole.SUPER_ADMIN]) {
      const admin = makeUser({ role, managedStopId: null });
      assert.equal(canViewTrip(admin, { driverId: 'driver-b', departureStopId: STOP_TANA }), true);
    }
  });

  it("un opérateur ne voit que les voyages liés à son guichet (départ ou montée d'un passager)", () => {
    const operator = makeUser({ role: UserRole.OPERATOR, managedStopId: STOP_SAMBAVA });
    assert.equal(canViewTrip(operator, { departureStopId: STOP_SAMBAVA }), true);
    assert.equal(
      canViewTrip(operator, {
        departureStopId: STOP_TANA,
        bookings: [{ boardingStopId: STOP_SAMBAVA }],
      }),
      true,
    );
    assert.equal(
      canViewTrip(operator, { departureStopId: STOP_TANA, bookings: [{ boardingStopId: STOP_TANA }] }),
      false,
    );
  });
});

describe("canManageTrip", () => {
  it("seuls super-admin, admin et l'opérateur du stop de départ peuvent modifier un voyage", () => {
    assert.equal(canManageTrip(makeUser({ role: UserRole.SUPER_ADMIN }), { departureStopId: STOP_TANA }), true);
    assert.equal(canManageTrip(makeUser({ role: UserRole.ADMIN }), { departureStopId: STOP_TANA }), true);
    assert.equal(
      canManageTrip(makeUser({ role: UserRole.OPERATOR, managedStopId: STOP_TANA }), { departureStopId: STOP_TANA }),
      true,
    );
    // Opérateur d'un autre guichet : refus
    assert.equal(
      canManageTrip(makeUser({ role: UserRole.OPERATOR, managedStopId: STOP_SAMBAVA }), { departureStopId: STOP_TANA }),
      false,
    );
    // Un chauffeur ne modifie jamais un voyage
    assert.equal(canManageTrip(makeUser({ role: UserRole.DRIVER }), { departureStopId: STOP_TANA }), false);
  });
});

describe("canViewBooking / canManageBooking", () => {
  const bookingOfSambava = {
    boardingStopId: STOP_SAMBAVA,
    trip: { driverId: 'driver-a', departureStopId: STOP_TANA },
  };
  const bookingOfTana = {
    boardingStopId: STOP_TANA,
    trip: { driverId: 'driver-a', departureStopId: STOP_TANA },
  };

  it("un opérateur voit uniquement les réservations de son guichet", () => {
    const operatorSambava = makeUser({ role: UserRole.OPERATOR, managedStopId: STOP_SAMBAVA });
    assert.equal(canViewBooking(operatorSambava, bookingOfSambava), true);
    assert.equal(canViewBooking(operatorSambava, bookingOfTana), false);
  });

  it("un opérateur sans guichet ne voit aucune réservation", () => {
    const operatorNoStop = makeUser({ role: UserRole.OPERATOR, managedStopId: null });
    assert.equal(canViewBooking(operatorNoStop, bookingOfTana), false);
  });

  it("les rôles élevés et le chauffeur du voyage consultent toutes les réservations", () => {
    const driver = makeUser({ id: 'driver-a', role: UserRole.DRIVER });
    assert.equal(canViewBooking(driver, bookingOfTana), true);
    assert.equal(canViewBooking(makeUser({ role: UserRole.ADMIN }), bookingOfTana), true);
    assert.equal(canViewBooking(makeUser({ role: UserRole.SUPER_ADMIN }), bookingOfTana), true);
  });

  it("la gestion d'une réservation suit exactement la visibilité côté opérateur", () => {
    const operatorSambava = makeUser({ role: UserRole.OPERATOR, managedStopId: STOP_SAMBAVA });
    assert.equal(canManageBooking(operatorSambava, bookingOfSambava), true);
    assert.equal(canManageBooking(operatorSambava, bookingOfTana), false);
  });
});
