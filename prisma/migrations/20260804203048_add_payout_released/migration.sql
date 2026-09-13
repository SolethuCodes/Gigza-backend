-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "payoutReleased" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payoutReleasedAt" TIMESTAMP(3),
ADD COLUMN     "payoutReleasedBy" TEXT;
