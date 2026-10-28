-- FIFIABE: suivi neutre, rôle propriétaire et réservations guichet
-- Les anciennes réservations reçoivent LEGACY_UNKNOWN afin de préserver l'historique.

ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';

CREATE TYPE "BookingOrigin" AS ENUM ('PASSENGER_APP', 'COUNTER', 'LEGACY_UNKNOWN');

ALTER TABLE "Booking"
  ADD COLUMN "origin" "BookingOrigin" NOT NULL DEFAULT 'LEGACY_UNKNOWN',
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "createdAtStopId" TEXT;

CREATE TYPE "FeedbackType" AS ENUM ('REVIEW', 'COMPLAINT');
CREATE TYPE "FeedbackAuthorType" AS ENUM ('PASSENGER', 'OPERATOR', 'ADMIN', 'DRIVER');
CREATE TYPE "FeedbackAudience" AS ENUM ('SUPER_ADMIN', 'COOPERATIVE_ADMIN', 'OPERATIONS');
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'IN_ANALYSIS', 'WAITING_RESPONSE', 'RESOLVED', 'REJECTED', 'CLOSED');

CREATE TABLE "CommissionSimulation" (
  "id" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "from" TIMESTAMP(3),
  "to" TIMESTAMP(3),
  "basis" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "assumedPercentage" DECIMAL(8,4),
  "assumedFixedAr" INTEGER,
  "reservationCount" INTEGER NOT NULL,
  "seatCount" INTEGER NOT NULL,
  "grossAmountAr" INTEGER NOT NULL,
  "paidAmountAr" INTEGER NOT NULL,
  "simulatedAmountAr" INTEGER NOT NULL,
  "note" TEXT,
  CONSTRAINT "CommissionSimulation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Booking_origin_createdAt_idx" ON "Booking"("origin", "createdAt");
CREATE INDEX "Booking_createdById_createdAt_idx" ON "Booking"("createdById", "createdAt");
CREATE INDEX "Booking_createdAtStopId_createdAt_idx" ON "Booking"("createdAtStopId", "createdAt");
CREATE INDEX "CommissionSimulation_createdById_createdAt_idx" ON "CommissionSimulation"("createdById", "createdAt");
CREATE INDEX "CommissionSimulation_createdAt_idx" ON "CommissionSimulation"("createdAt");

CREATE TABLE "Feedback" (
  "id" TEXT NOT NULL,
  "type" "FeedbackType" NOT NULL,
  "authorType" "FeedbackAuthorType" NOT NULL,
  "audience" "FeedbackAudience" NOT NULL DEFAULT 'SUPER_ADMIN',
  "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
  "priority" INTEGER NOT NULL DEFAULT 2,
  "rating" INTEGER,
  "authorName" TEXT NOT NULL,
  "authorPhone" TEXT,
  "authorUserId" TEXT,
  "bookingId" TEXT,
  "subject" TEXT,
  "message" TEXT NOT NULL,
  "response" TEXT,
  "assignedToId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Feedback_type_status_createdAt_idx" ON "Feedback"("type", "status", "createdAt");
CREATE INDEX "Feedback_audience_status_priority_idx" ON "Feedback"("audience", "status", "priority");
CREATE INDEX "Feedback_bookingId_idx" ON "Feedback"("bookingId");

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_createdAtStopId_fkey"
  FOREIGN KEY ("createdAtStopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommissionSimulation" ADD CONSTRAINT "CommissionSimulation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Booking" ALTER COLUMN "origin" DROP DEFAULT;
ALTER TABLE "Booking" ALTER COLUMN "origin" SET DEFAULT 'LEGACY_UNKNOWN';
