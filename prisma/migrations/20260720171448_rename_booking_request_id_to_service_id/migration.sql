/*
  Warnings:

  - You are about to drop the column `requestId` on the `bookings` table. All the data in the column will be lost.
  - Added the required column `serviceId` to the `bookings` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "requestId",
ADD COLUMN     "serviceId" TEXT NOT NULL;
