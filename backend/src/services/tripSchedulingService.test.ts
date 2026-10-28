// Tests unitaires du service de planification — FIFIABE
//
// Exécution : cd backend && pnpm test
// Aucune connexion base : les fonctions sont pures ou reçoivent un client
// Prisma simulé (injection de dépendance prévue par le service).
//
// Couverture demandée :
//   - création/publication SANS véhicule → refus obligatoire ;
//   - création/publication AVEC véhicule explicitement choisi → accepté ;
//   - conflit de créneau véhicule (tous statuts actifs, y compris DRAFT) ;
//   - changement vers un véhicule occupé au même créneau → conflit détecté ;
//   - affectation du chauffeur principal déduite du VÉHICULE choisi
//     (jamais l'inverse : aucun mécanisme ne choisit le véhicule) ;
//   - exception administrative documentée pour un chauffeur hors véhicule.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma, TripStatus, UserRole, type Trip } from '@prisma/client';
import {
  assertDriverMatchesVehicle,
  checkVehicleConflict,
  requireExplicitVehicleSelection,
  resolveDefaultDriverId,
} from './tripSchedulingService.js';

const VEHICULE_A = 'veh-a-fif001';
const VEHICULE_B = 'veh-b-fif002';
const DRIVER_A = 'user-driver-a';
const DRIVER_B = 'user-driver-b';
const ADMIN = UserRole.ADMIN;
const OPERATOR = UserRole.OPERATOR;

const CRENEAU = new Date('2026-08-29T13:00:00.000Z');

/** Client Prisma simulé renvoyant des voyages conflictuels configurables. */
function fakePrismaWithTrips(trips: Trip[]) {
  return {
    trip: {
      findMany: async () => trips,
    },
  } as unknown as Prisma.TransactionClient;
}

function makeTrip(overrides: Partial<Trip> & { id: string }): Trip {
  return {
    vehicleId: VEHICULE_A,
    departureAt: CRENEAU,
    status: TripStatus.PUBLISHED,
    ...overrides,
  } as Trip;
}

// --- Sélection explicite du véhicule --------------------------------------

describe('requireExplicitVehicleSelection', () => {
  it('refuse la publication sans vehicleId (aucun repli automatique)', () => {
    const result = requireExplicitVehicleSelection(undefined);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'VEHICLE_REQUIRED');
  });

  it('refuse un vehicleId null, vide ou composé d\'espaces', () => {
    assert.equal(requireExplicitVehicleSelection(null).ok, false);
    assert.equal(requireExplicitVehicleSelection('').ok, false);
    assert.equal(requireExplicitVehicleSelection('   ').ok, false);
  });

  it('refuse un type non chaîne (nombre, objet)', () => {
    assert.equal(requireExplicitVehicleSelection(42).ok, false);
    assert.equal(requireExplicitVehicleSelection({ id: VEHICULE_A }).ok, false);
  });

  it('accepte un véhicule explicitement choisi par l\'opérateur', () => {
    const result = requireExplicitVehicleSelection(VEHICULE_B);
    assert.deepEqual(result, { ok: true, vehicleId: VEHICULE_B });
  });
});

// --- Conflit de créneau ----------------------------------------------------

describe('checkVehicleConflict', () => {
  it('détecte un conflit quand le véhicule est déjà sur un autre voyage PUBLISHED au même créneau', async () => {
    const prisma = fakePrismaWithTrips([makeTrip({ id: 'trip-existing' })]);
    const result = await checkVehicleConflict({
      prisma,
      tripId: 'trip-new',
      vehicleId: VEHICULE_A,
      departureAt: CRENEAU,
    });
    assert.equal(result.hasConflict, true);
    if (result.hasConflict) assert.deepEqual(result.conflictingTrips.map((t) => t.id), ['trip-existing']);
  });

  it('détecte un conflit même contre un voyage DRAFT (statut actif souvent oublié historiquement)', async () => {
    const prisma = fakePrismaWithTrips([makeTrip({ id: 'trip-draft', status: TripStatus.DRAFT })]);
    const result = await checkVehicleConflict({
      prisma,
      tripId: 'trip-new',
      vehicleId: VEHICULE_A,
      departureAt: CRENEAU,
    });
    assert.equal(result.hasConflict, true);
  });

  it("détecte un conflit lors d'un changement vers un véhicule déjà occupé au créneau", async () => {
    // L'opérateur déplace le voyage vers le véhicule B ; B est déjà engagé.
    const prisma = fakePrismaWithTrips([
      makeTrip({ id: 'trip-on-b', vehicleId: VEHICULE_B }),
    ]);
    const result = await checkVehicleConflict({
      prisma,
      tripId: 'trip-being-moved',
      vehicleId: VEHICULE_B,
      departureAt: CRENEAU,
    });
    assert.equal(result.hasConflict, true);
    if (result.hasConflict) {
      assert.equal(result.conflictingTrips[0].vehicleId, VEHICULE_B);
    }
  });

  it('n\'est PAS en conflit si aucun autre voyage actif n\'occupe le créneau', async () => {
    const prisma = fakePrismaWithTrips([]);
    const result = await checkVehicleConflict({
      prisma,
      tripId: 'trip-new',
      vehicleId: VEHICULE_A,
      departureAt: CRENEAU,
    });
    assert.deepEqual(result, { hasConflict: false });
  });
});

// --- Chauffeur principal déduit du véhicule choisi -------------------------

describe('resolveDefaultDriverId', () => {
  it('utilise le chauffeur principal du véhicule CHOISI quand aucun chauffeur explicite n\'est fourni', () => {
    const result = resolveDefaultDriverId({
      selectedVehicleId: VEHICULE_B,
      previousVehicleId: VEHICULE_A, // le voyage change de véhicule
      existingTripDriverId: DRIVER_A, // ancien chauffeur périmé — ne doit PAS être conservé
      vehiclePrimaryDriverId: DRIVER_B,
    });
    assert.equal(result, DRIVER_B);
  });

  it('honore un chauffeur explicitement demandé (exception validée par ailleurs)', () => {
    const result = resolveDefaultDriverId({
      requestedDriverId: DRIVER_A,
      selectedVehicleId: VEHICULE_B,
      vehiclePrimaryDriverId: DRIVER_B,
    });
    assert.equal(result, DRIVER_A);
  });

  it("ne garde l'ancien chauffeur que si le véhicule est inchangé", () => {
    const result = resolveDefaultDriverId({
      selectedVehicleId: VEHICULE_A,
      previousVehicleId: VEHICULE_A,
      existingTripDriverId: DRIVER_A,
      vehiclePrimaryDriverId: null,
    });
    assert.equal(result, DRIVER_A);
  });

  it('retourne null plutôt que d\'inventer un chauffeur', () => {
    const result = resolveDefaultDriverId({
      selectedVehicleId: VEHICULE_A,
      previousVehicleId: VEHICULE_A,
      existingTripDriverId: null,
      vehiclePrimaryDriverId: null,
    });
    assert.equal(result, null);
  });

  it("n'expose aucune fonction qui choisirait automatiquement un véhicule (règle métier)", () => {
    // Garde-fou structurel : le module ne doit exporter AUCUN sélecteur
    // automatique de véhicule. Si quelqu'un ajoute un tel repli, ce test échoue.
    import('./tripSchedulingService.js').then((module) => {
      const exportedNames = Object.keys(module).filter((name) =>
        /auto|pick|choose|select.*vehicle|default.*vehicle/i.test(name),
      );
      assert.deepEqual(
        exportedNames.filter((name) => name !== 'requireExplicitVehicleSelection'),
        [],
        `Sélecteur(s) automatique(s) de véhicule interdit(s) exporté(s) : ${exportedNames.join(', ')}`,
      );
    });
  });
});

// --- Exception chauffeur/véhicule ------------------------------------------

describe('assertDriverMatchesVehicle', () => {
  it('autorise un chauffeur sur son véhicule principal', () => {
    const result = assertDriverMatchesVehicle({
      driverPrimaryVehicleId: VEHICULE_A,
      selectedVehicleId: VEHICULE_A,
      staffRole: UserRole.DRIVER,
    });
    assert.deepEqual(result, { ok: true });
  });

  it('refuse un chauffeur hors de son véhicule principal, même pour un opérateur', () => {
    const result = assertDriverMatchesVehicle({
      driverPrimaryVehicleId: VEHICULE_A,
      selectedVehicleId: VEHICULE_B,
      staffRole: OPERATOR,
      exceptionalVehicleChange: true,
      exceptionalReason: 'tentative non autorisée',
    });
    assert.deepEqual(result, { ok: false, reason: 'DRIVER_VEHICLE_MISMATCH' });
  });

  it("n'autorise l'exception qu'avec un motif ET un rôle administrateur", () => {
    // Admin avec motif → OK
    assert.deepEqual(
      assertDriverMatchesVehicle({
        driverPrimaryVehicleId: VEHICULE_A,
        selectedVehicleId: VEHICULE_B,
        staffRole: ADMIN,
        exceptionalVehicleChange: true,
        exceptionalReason: 'Véhicule A en panne, remplacement validé.',
      }),
      { ok: true },
    );
    // Admin SANS motif → refus
    assert.deepEqual(
      assertDriverMatchesVehicle({
        driverPrimaryVehicleId: VEHICULE_A,
        selectedVehicleId: VEHICULE_B,
        staffRole: ADMIN,
        exceptionalVehicleChange: true,
        exceptionalReason: '   ',
      }),
      { ok: false, reason: 'DRIVER_VEHICLE_MISMATCH' },
    );
  });
});
