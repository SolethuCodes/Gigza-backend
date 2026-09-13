-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "address" TEXT,
ADD COLUMN     "latitude" DECIMAL(10,8),
ADD COLUMN     "longitude" DECIMAL(11,8);
