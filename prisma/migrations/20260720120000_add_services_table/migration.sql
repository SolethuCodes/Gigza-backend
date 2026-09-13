-- Create services table and backfill from service_requests
CREATE TABLE "services" (
  "id" TEXT NOT NULL,
  "providerId" TEXT,
  "categoryId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "basePrice" DECIMAL(10,2),
  "priceUnit" TEXT,
  "imageUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

INSERT INTO "services" ("id", "providerId", "categoryId", "name", "description", "basePrice", "priceUnit", "imageUrl", "isActive", "createdAt", "updatedAt")
SELECT
  sr."id",
  NULL,
  sr."categoryId",
  sr."title",
  sr."description",
  sr."estimatedBudget",
  sr."preferredTimeSlot",
  NULL,
  sr."isActive",
  sr."createdAt",
  sr."updatedAt"
FROM "service_requests" sr;

CREATE INDEX "services_providerId_idx" ON "services"("providerId");
CREATE INDEX "services_categoryId_idx" ON "services"("categoryId");
CREATE INDEX "services_providerId_categoryId_idx" ON "services"("providerId", "categoryId");

ALTER TABLE "services"
  ADD CONSTRAINT "services_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "services"
  ADD CONSTRAINT "services_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
