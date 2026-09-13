/*
  Warnings:

  - You are about to drop the column `declineReason` on the `bookings` table. All the data in the column will be lost.
  - You are about to drop the column `declinedAt` on the `bookings` table. All the data in the column will be lost.
  - You are about to drop the column `declinedByProviderId` on the `bookings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "declineReason",
DROP COLUMN "declinedAt",
DROP COLUMN "declinedByProviderId";
