/*
  Warnings:

  - The values [PROVIDER] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `againstId` on the `disputes` table. All the data in the column will be lost.
  - You are about to drop the column `raisedById` on the `disputes` table. All the data in the column will be lost.
  - You are about to drop the column `providerProfileId` on the `provider_current_locations` table. All the data in the column will be lost.
  - You are about to drop the column `providerProfileId` on the `provider_location_history` table. All the data in the column will be lost.
  - You are about to drop the column `providerProfileId` on the `provider_service_categories` table. All the data in the column will be lost.
  - You are about to drop the column `providerProfileId` on the `wallets` table. All the data in the column will be lost.
  - You are about to drop the `provider_profiles` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[providerId]` on the table `provider_current_locations` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[providerId,categoryId]` on the table `provider_service_categories` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[providerId]` on the table `wallets` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `providerId` to the `provider_current_locations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `providerId` to the `provider_location_history` table without a default value. This is not possible if the table is not empty.
  - Added the required column `providerId` to the `provider_service_categories` table without a default value. This is not possible if the table is not empty.
  - Added the required column `providerId` to the `wallets` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('USER', 'ADMIN', 'SUPPORT');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';
COMMIT;

-- DropForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_providerId_fkey";

-- DropForeignKey
ALTER TABLE "disputes" DROP CONSTRAINT "disputes_againstId_fkey";

-- DropForeignKey
ALTER TABLE "disputes" DROP CONSTRAINT "disputes_raisedById_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_providerId_fkey";

-- DropForeignKey
ALTER TABLE "provider_current_locations" DROP CONSTRAINT "provider_current_locations_providerProfileId_fkey";

-- DropForeignKey
ALTER TABLE "provider_location_history" DROP CONSTRAINT "provider_location_history_providerProfileId_fkey";

-- DropForeignKey
ALTER TABLE "provider_profiles" DROP CONSTRAINT "provider_profiles_userId_fkey";

-- DropForeignKey
ALTER TABLE "provider_service_categories" DROP CONSTRAINT "provider_service_categories_providerProfileId_fkey";

-- DropForeignKey
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_fromUserId_fkey";

-- DropForeignKey
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_toUserId_fkey";

-- DropForeignKey
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_providerProfileId_fkey";

-- DropForeignKey
ALTER TABLE "withdrawal_requests" DROP CONSTRAINT "withdrawal_requests_providerId_fkey";

-- DropIndex
DROP INDEX "provider_current_locations_providerProfileId_key";

-- DropIndex
DROP INDEX "provider_location_history_providerProfileId_recordedAt_idx";

-- DropIndex
DROP INDEX "provider_service_categories_providerProfileId_categoryId_key";

-- DropIndex
DROP INDEX "wallets_providerProfileId_key";

-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "providerId" TEXT;

-- AlterTable
ALTER TABLE "disputes" DROP COLUMN "againstId",
DROP COLUMN "raisedById",
ADD COLUMN     "againstProviderId" TEXT,
ADD COLUMN     "againstUserId" TEXT,
ADD COLUMN     "raisedByProviderId" TEXT,
ADD COLUMN     "raisedByUserId" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "providerId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "provider_current_locations" DROP COLUMN "providerProfileId",
ADD COLUMN     "providerId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "provider_location_history" DROP COLUMN "providerProfileId",
ADD COLUMN     "providerId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "provider_service_categories" DROP COLUMN "providerProfileId",
ADD COLUMN     "providerId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ratings" ADD COLUMN     "fromProviderId" TEXT,
ADD COLUMN     "toProviderId" TEXT,
ALTER COLUMN "fromUserId" DROP NOT NULL,
ALTER COLUMN "toUserId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "wallets" DROP COLUMN "providerProfileId",
ADD COLUMN     "providerId" TEXT NOT NULL;

-- DropTable
DROP TABLE "provider_profiles";

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "bannedAt" TIMESTAMP(3),
    "bannedBy" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "bio" TEXT,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "kycDocuments" JSONB NOT NULL DEFAULT '[]',
    "kycRejectionReason" TEXT,
    "kycReviewedAt" TIMESTAMP(3),
    "kycReviewedBy" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "avgRating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "totalRatings" INTEGER NOT NULL DEFAULT 0,
    "totalJobsCompleted" INTEGER NOT NULL DEFAULT 0,
    "serviceRadius" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "providers_email_key" ON "providers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "providers_phone_key" ON "providers"("phone");

-- CreateIndex
CREATE INDEX "providers_email_idx" ON "providers"("email");

-- CreateIndex
CREATE INDEX "providers_phone_idx" ON "providers"("phone");

-- CreateIndex
CREATE INDEX "providers_isActive_isBanned_idx" ON "providers"("isActive", "isBanned");

-- CreateIndex
CREATE INDEX "providers_kycStatus_idx" ON "providers"("kycStatus");

-- CreateIndex
CREATE INDEX "activity_logs_providerId_idx" ON "activity_logs"("providerId");

-- CreateIndex
CREATE INDEX "notifications_providerId_isRead_idx" ON "notifications"("providerId", "isRead");

-- CreateIndex
CREATE UNIQUE INDEX "provider_current_locations_providerId_key" ON "provider_current_locations"("providerId");

-- CreateIndex
CREATE INDEX "provider_location_history_providerId_recordedAt_idx" ON "provider_location_history"("providerId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_service_categories_providerId_categoryId_key" ON "provider_service_categories"("providerId", "categoryId");

-- CreateIndex
CREATE INDEX "ratings_toProviderId_idx" ON "ratings"("toProviderId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_providerId_key" ON "wallets"("providerId");

-- AddForeignKey
ALTER TABLE "provider_service_categories" ADD CONSTRAINT "provider_service_categories_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_current_locations" ADD CONSTRAINT "provider_current_locations_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_location_history" ADD CONSTRAINT "provider_location_history_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_fromProviderId_fkey" FOREIGN KEY ("fromProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_toProviderId_fkey" FOREIGN KEY ("toProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raisedByUserId_fkey" FOREIGN KEY ("raisedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raisedByProviderId_fkey" FOREIGN KEY ("raisedByProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_againstUserId_fkey" FOREIGN KEY ("againstUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_againstProviderId_fkey" FOREIGN KEY ("againstProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
