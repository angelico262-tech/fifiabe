// backend/src/services/tripSchedulingService.ts
//
// Règles métier de planification des voyages, isolées de la couche HTTP
// (Fastify) pour être testables indépendamment et pour centraliser une
// logique aujourd'hui dupliquée/incomplète dans index.ts.
//
// Corrige la cause racine identifiée dans l'audit : le contrôle de conflit
// véhicule/créneau ne regardait que les statuts PUBLISHED/FULL, ratant les
// voyages DRAFT concurrents (cas réel FIF-006 du 22/08/2026).
//
// Chaque fonction reçoit son client Prisma en paramètre (injection de
// dépendance) plutôt que d'importer un singleton global : ça permet de les
// tester avec un client de test, et ça garde la porte ouverte pour qu'une
// future portée "coopérative" s'ajoute au `where` sans toucher les appelants
// (voir backend/src/config/organization.ts).

import { Prisma, PrismaClient, Trip, TripStatus, UserRole } from '@prisma/client';
import { organizationConfig } from '../config/organization.js';
import crypto from 'node:crypto';

/** Statuts considérés "actifs" pour la détection de conflit véhicule/créneau. */
const ACTIVE_TRIP_STATUSES: TripStatus[] = [
  TripStatus.DRAFT,
  TripStatus.SCHEDULED,
  TripStatus.PUBLISHED,
  TripStatus.FULL,
];

export type VehicleConflictCheckInput = {
  prisma: PrismaClient | Prisma.TransactionClient;
  tripId: string;
  vehicleId: string;
  departureAt: Date;
};

export type VehicleConflictResult =
  | { hasConflict: false }
  | { hasConflict: true; conflictingTrips: Trip[] };

/**
 * Détecte si un véhicule est déjà engagé sur un autre voyage actif au même
 * créneau, quelle que soit la route/direction (invariant métier : un
 * véhicule ne peut pas être sur deux voyages actifs en même temps).
 *
 * Contrairement à l'ancien contrôle dans index.ts, celui-ci couvre TOUS les
 * statuts actifs (y compris DRAFT), pas seulement PUBLISHED/FULL.
 */
export async function checkVehicleConflict(
  input: VehicleConflictCheckInput,
): Promise<VehicleConflictResult> {
  const conflictingTrips = await input.prisma.trip.findMany({
    where: {
      id: { not: input.tripId },
      vehicleId: input.vehicleId,
      departureAt: input.departureAt,
      status: { in: ACTIVE_TRIP_STATUSES },
    },
  });

  if (conflictingTrips.length === 0) return { hasConflict: false };
  return { hasConflict: true, conflictingTrips };
}

export type ResolveDefaultDriverInput = {
  requestedDriverId?: string | null;
  /** driverId actuellement enregistré sur le voyage AVANT la publication. */
  existingTripDriverId?: string | null;
  /** Le véhicule sélectionné pour CETTE publication (peut différer de l'ancien). */
  selectedVehicleId: string;
  /** Le véhicule qui était déjà sur le voyage avant cette publication, s'il existe. */
  previousVehicleId?: string | null;
  vehiclePrimaryDriverId?: string | null;
};

/**
 * Détermine quel chauffeur doit être proposé/retenu par défaut.
 *
 * Règle (invariant 7) : si aucun chauffeur n'est explicitement demandé, le
 * chauffeur par défaut doit être le chauffeur PRINCIPAL DU VÉHICULE
 * SÉLECTIONNÉ — pas le chauffeur qui était sur le voyage avant, surtout si
 * le véhicule vient de changer. L'ancien code (`body.driverId ?? trip.driverId
 * ?? vehicle.primaryDriver.id`) pouvait garder un chauffeur périmé quand le
 * véhicule changeait tout en laissant `trip.driverId` non vide, ce qui a
 * contribué au scénario d'incident. Ici, `trip.driverId` n'est utilisé comme
 * repli que si le véhicule n'a PAS changé.
 */
export function resolveDefaultDriverId(input: ResolveDefaultDriverInput): string | null {
  if (input.requestedDriverId) return input.requestedDriverId;

  const vehicleUnchanged = input.previousVehicleId === input.selectedVehicleId;
  if (vehicleUnchanged && input.existingTripDriverId) return input.existingTripDriverId;

  return input.vehiclePrimaryDriverId ?? null;
}

export type AssertDriverMatchesVehicleInput = {
  driverPrimaryVehicleId: string | null;
  selectedVehicleId: string;
  staffRole: UserRole;
  exceptionalVehicleChange?: boolean;
  exceptionalReason?: string;
};

export type DriverVehicleAssertionResult =
  | { ok: true }
  | { ok: false; reason: 'DRIVER_VEHICLE_MISMATCH' };

/**
 * Vérifie qu'un chauffeur ne conduit que son véhicule permanent, sauf
 * exception administrative dûment motivée (invariant : les opérateurs ne
 * peuvent pas modifier l'affectation permanente chauffeur-véhicule).
 */
export function assertDriverMatchesVehicle(
  input: AssertDriverMatchesVehicleInput,
): DriverVehicleAssertionResult {
  if (input.driverPrimaryVehicleId === input.selectedVehicleId) return { ok: true };

  const exceptionAuthorized =
    input.staffRole === UserRole.ADMIN || input.staffRole === UserRole.SUPER_ADMIN;
  const exceptionValid =
    input.exceptionalVehicleChange === true &&
    exceptionAuthorized &&
    Boolean(input.exceptionalReason?.trim());

  if (exceptionValid) return { ok: true };
  return { ok: false, reason: 'DRIVER_VEHICLE_MISMATCH' };
}

// --- Sélection explicite du véhicule (règle métier obligatoire) ----------
//
// En production, chaque voyage doit recevoir un véhicule choisi EXPLICITEMENT
// par l'opérateur dans l'interface. Le système ne doit JAMAIS sélectionner
// automatiquement ou aléatoirement un véhicule : ni par identifiant le plus
// petit, ni par ordre de création, ni par chauffeur principal, ni par valeur
// par défaut. Le chauffeur principal peut être déduit du véhicule choisi,
// mais ne doit jamais servir à choisir le véhicule.

export type ExplicitVehicleSelectionResult =
  | { ok: true; vehicleId: string }
  | { ok: false; reason: 'VEHICLE_REQUIRED' };

/**
 * Refuse toute publication/création de voyage sans vehicleId fourni
 * explicitement dans la requête (aucun repli sur l'ancien véhicule du voyage,
 * aucun choix automatique).
 */
export function requireExplicitVehicleSelection(requestedVehicleId: unknown): ExplicitVehicleSelectionResult {
  if (typeof requestedVehicleId !== 'string') return { ok: false, reason: 'VEHICLE_REQUIRED' };
  const trimmed = requestedVehicleId.trim();
  if (!trimmed) return { ok: false, reason: 'VEHICLE_REQUIRED' };
  return { ok: true, vehicleId: trimmed };
}

// --- Références de réservation ------------------------------------------
//
// Déplacé ici pour ne dépendre que de organizationConfig, plus jamais du
// texte "FIF" en dur ailleurs dans le code.

export function makeBookingReference(): string {
  return `${organizationConfig.bookingReferencePrefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

export function isValidBookingReference(reference: string): boolean {
  const prefix = organizationConfig.bookingReferencePrefix;
  const pattern = new RegExp(`^${prefix}-[A-F0-9]{10}$`, 'i');
  return pattern.test(reference);
}
