-- Provider-suggested categories: providers can propose a new category from the
-- listing form; it stays hidden until an admin approves it. Existing categories
-- are all treated as already APPROVED.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CategoryStatus" AS ENUM ('APPROVED', 'PENDING', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "service_categories"
  ADD COLUMN IF NOT EXISTS "status" "CategoryStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS "suggestedByProviderId" TEXT;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "service_categories"
    ADD CONSTRAINT "service_categories_suggestedByProviderId_fkey"
    FOREIGN KEY ("suggestedByProviderId") REFERENCES "providers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
