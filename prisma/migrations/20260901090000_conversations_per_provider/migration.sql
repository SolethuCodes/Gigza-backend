-- Re-key conversations from one-per-booking to one-per-(customer, provider).
-- Messages gain a conversationId; bookingId is kept (nullable) for per-message
-- context. Existing duplicate threads for the same pair are merged.

-- 1. New columns -------------------------------------------------------------
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastBookingId" TEXT;

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "conversationId" TEXT;

-- 2. Backfill conversation owner from the booking it was tied to ------------
UPDATE "conversations" c
   SET "userId"        = b."userId",
       "providerId"    = b."providerId",
       "lastBookingId" = c."bookingId"
  FROM "bookings" b
 WHERE b."id" = c."bookingId"
   AND c."userId" IS NULL;

-- 3. Make sure every booking that has messages has a conversation row -------
INSERT INTO "conversations"
  ("id", "bookingId", "userId", "providerId", "lastBookingId",
   "unreadCountCustomer", "unreadCountProvider", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || b."id"),
       b."id", b."userId", b."providerId", b."id", 0, 0, now(), now()
  FROM "bookings" b
 WHERE b."id" IN (SELECT DISTINCT "bookingId" FROM "messages")
   AND NOT EXISTS (SELECT 1 FROM "conversations" c WHERE c."bookingId" = b."id");

-- 4. Point every message at its booking's conversation --------------------
UPDATE "messages" m
   SET "conversationId" = c."id"
  FROM "conversations" c
 WHERE c."bookingId" = m."bookingId"
   AND m."conversationId" IS NULL;

-- 5. Merge duplicate conversations for the same (userId, providerId) -------
--    canonical = earliest createdAt (then id) for that pair
--    5a. repoint messages of non-canonical conversations
UPDATE "messages" m
   SET "conversationId" = canon."canonical_id"
  FROM (
    SELECT c."id" AS conv_id,
           (SELECT c2."id" FROM "conversations" c2
             WHERE c2."userId" = c."userId" AND c2."providerId" = c."providerId"
             ORDER BY c2."createdAt" ASC, c2."id" ASC
             LIMIT 1) AS canonical_id
      FROM "conversations" c
     WHERE c."userId" IS NOT NULL AND c."providerId" IS NOT NULL
  ) canon
 WHERE m."conversationId" = canon."conv_id"
   AND canon."conv_id" <> canon."canonical_id";

--    5b. fold unread counts into the canonical row
UPDATE "conversations" keep
   SET "unreadCountCustomer" = agg."uc",
       "unreadCountProvider" = agg."up"
  FROM (
    SELECT (SELECT c2."id" FROM "conversations" c2
             WHERE c2."userId" = c."userId" AND c2."providerId" = c."providerId"
             ORDER BY c2."createdAt" ASC, c2."id" ASC
             LIMIT 1) AS canonical_id,
           SUM(c."unreadCountCustomer") AS uc,
           SUM(c."unreadCountProvider") AS up
      FROM "conversations" c
     WHERE c."userId" IS NOT NULL AND c."providerId" IS NOT NULL
     GROUP BY c."userId", c."providerId"
  ) agg
 WHERE keep."id" = agg."canonical_id";

--    5c. delete the non-canonical rows
DELETE FROM "conversations" c
 USING (
    SELECT c1."id" AS conv_id,
           (SELECT c2."id" FROM "conversations" c2
             WHERE c2."userId" = c1."userId" AND c2."providerId" = c1."providerId"
             ORDER BY c2."createdAt" ASC, c2."id" ASC
             LIMIT 1) AS canonical_id
      FROM "conversations" c1
     WHERE c1."userId" IS NOT NULL AND c1."providerId" IS NOT NULL
 ) dup
 WHERE c."id" = dup."conv_id"
   AND dup."conv_id" <> dup."canonical_id";

-- 6. Recompute last-message pointer on survivors from real messages -------
UPDATE "conversations" c
   SET "lastMessageId"   = lm."id",
       "lastMessageText" = lm."text",
       "lastMessageAt"   = lm."createdAt",
       "lastBookingId"   = COALESCE(lm."bookingId", c."lastBookingId")
  FROM (
    SELECT DISTINCT ON (m."conversationId")
           m."conversationId", m."id", m."text", m."createdAt", m."bookingId"
      FROM "messages" m
     ORDER BY m."conversationId", m."createdAt" DESC
  ) lm
 WHERE lm."conversationId" = c."id";

-- 7. Drop rows we could not map, then enforce the new shape ---------------
DELETE FROM "messages"      WHERE "conversationId" IS NULL;
DELETE FROM "conversations" WHERE "userId" IS NULL OR "providerId" IS NULL;

ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_bookingId_fkey";
DROP INDEX IF EXISTS "conversations_bookingId_key";
DROP INDEX IF EXISTS "conversations_bookingId_idx";
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "bookingId";

ALTER TABLE "conversations" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "conversations" ALTER COLUMN "providerId" SET NOT NULL;

ALTER TABLE "messages" ALTER COLUMN "conversationId" SET NOT NULL;
ALTER TABLE "messages" ALTER COLUMN "bookingId" DROP NOT NULL;
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_bookingId_fkey";
DROP INDEX IF EXISTS "messages_bookingId_createdAt_idx";

-- 8. Constraints + indexes ----------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_userId_providerId_key"
  ON "conversations"("userId", "providerId");
CREATE INDEX IF NOT EXISTS "conversations_userId_idx"     ON "conversations"("userId");
CREATE INDEX IF NOT EXISTS "conversations_providerId_idx" ON "conversations"("providerId");

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "conversations_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "conversations_lastBookingId_fkey"
    FOREIGN KEY ("lastBookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "messages_conversationId_createdAt_idx"
  ON "messages"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "messages_bookingId_idx" ON "messages"("bookingId");

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "messages_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
