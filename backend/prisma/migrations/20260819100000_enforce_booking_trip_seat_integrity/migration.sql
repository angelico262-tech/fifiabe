-- Répare les anciennes lignes SeatBooking dont le tripId ne correspondait pas
-- au tripId de leur réservation. Les réservations et leurs sièges restent conservés.

-- Si plusieurs lignes deviennent le même siège sur le même voyage après réparation,
-- on conserve la première ligne créée et on supprime uniquement le doublon technique.
WITH ranked AS (
  SELECT
    sb."id",
    ROW_NUMBER() OVER (
      PARTITION BY b."tripId", sb."seatNumber"
      ORDER BY sb."createdAt" ASC, sb."id" ASC
    ) AS row_number
  FROM "SeatBooking" sb
  JOIN "Booking" b ON b."id" = sb."bookingId"
)
DELETE FROM "SeatBooking" sb
USING ranked r
WHERE sb."id" = r."id"
  AND r.row_number > 1;

UPDATE "SeatBooking" sb
SET "tripId" = b."tripId"
FROM "Booking" b
WHERE sb."bookingId" = b."id"
  AND sb."tripId" <> b."tripId";

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_id_tripId_key" UNIQUE ("id", "tripId");

ALTER TABLE "SeatBooking"
  DROP CONSTRAINT IF EXISTS "SeatBooking_bookingId_fkey";

ALTER TABLE "SeatBooking"
  ADD CONSTRAINT "SeatBooking_bookingId_tripId_fkey"
  FOREIGN KEY ("bookingId", "tripId")
  REFERENCES "Booking"("id", "tripId")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "SeatBooking_bookingId_idx" ON "SeatBooking"("bookingId");
