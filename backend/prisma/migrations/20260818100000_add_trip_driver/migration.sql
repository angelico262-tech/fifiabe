-- Option A: affectation explicite d'un voyage à un chauffeur
ALTER TABLE "Trip" ADD COLUMN "driverId" TEXT;

CREATE INDEX "Trip_driverId_departureAt_idx" ON "Trip"("driverId", "departureAt");

ALTER TABLE "Trip"
  ADD CONSTRAINT "Trip_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
