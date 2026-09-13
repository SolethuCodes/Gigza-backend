-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'DECLINED';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "declineReason" TEXT,
ADD COLUMN     "declinedAt" TIMESTAMP(3),
ADD COLUMN     "declinedByProviderId" TEXT;
