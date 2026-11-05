-- Cart checkout: one gateway transaction paying for several bookings.
-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "checkoutId" TEXT;

-- CreateTable
CREATE TABLE "payment_checkouts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "gatewayResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_checkouts_reference_key" ON "payment_checkouts"("reference");

-- CreateIndex
CREATE INDEX "payment_checkouts_userId_idx" ON "payment_checkouts"("userId");

-- CreateIndex
CREATE INDEX "payments_checkoutId_idx" ON "payments"("checkoutId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "payment_checkouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

