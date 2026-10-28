-- FIFIABE: traçabilité des changements exceptionnels de véhicule/chauffeur.
-- Les colonnes sont nullables afin de préserver les voyages existants.

ALTER TABLE "Trip"
  ADD COLUMN "exceptionalVehicleChangeReason" TEXT,
  ADD COLUMN "exceptionalVehicleChangeById" TEXT,
  ADD COLUMN "exceptionalVehicleChangeAt" TIMESTAMP(3);

CREATE INDEX "Trip_exceptionalVehicleChangeById_idx"
  ON "Trip"("exceptionalVehicleChangeById");

ALTER TABLE "Trip"
  ADD CONSTRAINT "Trip_exceptionalVehicleChangeById_fkey"
  FOREIGN KEY ("exceptionalVehicleChangeById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Trip_vehicle_departure_status_idx"
  ON "Trip"("vehicleId", "departureAt", "status");

CREATE INDEX "Trip_driver_departure_idx"
  ON "Trip"("driverId", "departureAt");

-- Cette migration ne modifie aucune réservation ni aucun siège.
-- Les conflits historiques sont traités séparément par un script dry-run.

