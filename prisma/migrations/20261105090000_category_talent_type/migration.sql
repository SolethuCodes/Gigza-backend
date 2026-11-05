-- Categories now belong to a kind of talent (DJ, MC, PHOTOGRAPHER, DANCER).
-- Every existing category is a DJ genre, so the default keeps them as-is.
ALTER TABLE "service_categories" ADD COLUMN "talentType" TEXT NOT NULL DEFAULT 'DJ';

-- CreateIndex
CREATE INDEX "service_categories_talentType_idx" ON "service_categories"("talentType");
