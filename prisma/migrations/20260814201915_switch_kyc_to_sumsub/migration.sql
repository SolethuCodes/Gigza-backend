-- DropIndex
DROP INDEX "providers_smileIdJobId_key";

-- AlterTable
ALTER TABLE "providers" DROP COLUMN "smileIdJobId",
DROP COLUMN "smileIdUserId",
ADD COLUMN     "sumsubApplicantId" TEXT;
