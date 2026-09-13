-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "kycConsentAt" TIMESTAMP(3),
ADD COLUMN     "smileIdJobId" TEXT,
ADD COLUMN     "smileIdUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "providers_smileIdJobId_key" ON "providers"("smileIdJobId");
