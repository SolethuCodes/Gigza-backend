-- CreateEnum
CREATE TYPE "PricingType" AS ENUM ('FLAT', 'PER_ITEM');

-- AlterTable
ALTER TABLE "services" ADD COLUMN "pricingType" "PricingType" NOT NULL DEFAULT 'FLAT',
ADD COLUMN "unitLabel" TEXT;

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
