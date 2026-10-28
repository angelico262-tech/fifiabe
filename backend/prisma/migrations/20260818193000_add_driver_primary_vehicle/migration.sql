-- Add stable primary vehicle assignment for drivers
ALTER TABLE "User" ADD COLUMN "primaryVehicleId" TEXT;

CREATE UNIQUE INDEX "User_primaryVehicleId_key" ON "User"("primaryVehicleId");

ALTER TABLE "User"
  ADD CONSTRAINT "User_primaryVehicleId_fkey"
  FOREIGN KEY ("primaryVehicleId") REFERENCES "Vehicle"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Helps management queries that inspect vehicle ownership.
CREATE INDEX "User_role_primaryVehicleId_idx" ON "User"("role", "primaryVehicleId");

-- Prisma relation metadata is represented by the foreign key above.
-- Existing users remain unassigned until the seed or an authorized management action assigns them.

-- Down migration (manual only):
-- DROP INDEX "User_role_primaryVehicleId_idx";
-- ALTER TABLE "User" DROP CONSTRAINT "User_primaryVehicleId_fkey";
-- DROP INDEX "User_primaryVehicleId_key";
-- ALTER TABLE "User" DROP COLUMN "primaryVehicleId";

