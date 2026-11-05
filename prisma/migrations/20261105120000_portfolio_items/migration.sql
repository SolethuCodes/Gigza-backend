-- Talent portfolios: photos of past work and links to videos, mixes and posts.
-- CreateTable
CREATE TABLE "portfolio_items" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "imageUrl" TEXT,
    "linkUrl" TEXT,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portfolio_items_providerId_sortOrder_idx" ON "portfolio_items"("providerId", "sortOrder");

-- CreateIndex
CREATE INDEX "portfolio_items_createdAt_idx" ON "portfolio_items"("createdAt");

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

