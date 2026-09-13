-- Soft-delete marker for accounts anonymised via in-app "delete my account".
-- Admin lists and platform counts exclude rows where "deletedAt" IS NOT NULL.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "users_deletedAt_idx" ON "users"("deletedAt");
CREATE INDEX IF NOT EXISTS "providers_deletedAt_idx" ON "providers"("deletedAt");

-- Backfill accounts that were already anonymised before this column existed.
UPDATE "users"
   SET "deletedAt" = COALESCE("updatedAt", now())
 WHERE "deletedAt" IS NULL
   AND "email" LIKE 'deleted\_%@deleted.errandss.co.za';

UPDATE "providers"
   SET "deletedAt" = COALESCE("updatedAt", now())
 WHERE "deletedAt" IS NULL
   AND "email" LIKE 'deleted\_%@deleted.errandss.co.za';
