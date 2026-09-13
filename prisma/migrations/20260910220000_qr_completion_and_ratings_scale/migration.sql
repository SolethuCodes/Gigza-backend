-- AlterTable
ALTER TABLE "providers" ALTER COLUMN "avgRating" SET DATA TYPE DECIMAL(4,2);

-- AlterTable
ALTER TABLE "users" ADD COLUMN "avgRating" DECIMAL(4,2) NOT NULL DEFAULT 0,
ADD COLUMN "totalRatings" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ratings" ADD COLUMN "serviceId" TEXT;

-- CreateIndex
CREATE INDEX "ratings_serviceId_idx" ON "ratings"("serviceId");

-- Backfill denormalized serviceId from the parent booking
UPDATE "ratings" AS r
SET "serviceId" = b."serviceId"
FROM "bookings" AS b
WHERE r."bookingId" = b."id";

-- Scale historical 1–5 scores onto the 1–10 scale
UPDATE "ratings" SET "score" = "score" * 2 WHERE "score" BETWEEN 1 AND 5;

-- Recompute provider aggregates on the /10 scale
UPDATE "providers" AS p
SET
  "avgRating" = COALESCE(agg.avg_score, 0),
  "totalRatings" = COALESCE(agg.rating_count, 0)
FROM (
  SELECT
    "toProviderId" AS id,
    ROUND(AVG("score")::numeric, 2) AS avg_score,
    COUNT(*)::int AS rating_count
  FROM "ratings"
  WHERE "ratingFrom" = 'USER_TO_PROVIDER' AND "toProviderId" IS NOT NULL
  GROUP BY "toProviderId"
) AS agg
WHERE p."id" = agg.id;

-- Recompute user aggregates from provider→customer ratings
UPDATE "users" AS u
SET
  "avgRating" = COALESCE(agg.avg_score, 0),
  "totalRatings" = COALESCE(agg.rating_count, 0)
FROM (
  SELECT
    "toUserId" AS id,
    ROUND(AVG("score")::numeric, 2) AS avg_score,
    COUNT(*)::int AS rating_count
  FROM "ratings"
  WHERE "ratingFrom" = 'PROVIDER_TO_USER' AND "toUserId" IS NOT NULL
  GROUP BY "toUserId"
) AS agg
WHERE u."id" = agg.id;

-- CreateTable
CREATE TABLE "booking_completion_tokens" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "generatedByUserId" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3),
    "scannedByProviderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_completion_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_completion_tokens_bookingId_key" ON "booking_completion_tokens"("bookingId");

-- CreateIndex
CREATE INDEX "booking_completion_tokens_token_idx" ON "booking_completion_tokens"("token");

-- CreateIndex
CREATE INDEX "booking_completion_tokens_expiresAt_idx" ON "booking_completion_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "booking_completion_tokens" ADD CONSTRAINT "booking_completion_tokens_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_completion_tokens" ADD CONSTRAINT "booking_completion_tokens_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_completion_tokens" ADD CONSTRAINT "booking_completion_tokens_scannedByProviderId_fkey" FOREIGN KEY ("scannedByProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
