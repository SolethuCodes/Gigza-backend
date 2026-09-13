ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "reservedBalance" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "withdrawal_requests"
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS "reference" TEXT,
  ADD COLUMN IF NOT EXISTS "flutterwaveTransferId" TEXT,
  ADD COLUMN IF NOT EXISTS "flutterwaveReference" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "failureReason" TEXT;

UPDATE "withdrawal_requests"
SET "reference" = COALESCE("reference", 'WD-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || substring(md5(random()::text), 1, 8))
WHERE "reference" IS NULL;

ALTER TABLE "withdrawal_requests"
  ALTER COLUMN "reference" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "withdrawal_requests_reference_key"
  ON "withdrawal_requests"("reference");

CREATE UNIQUE INDEX IF NOT EXISTS "withdrawal_requests_idempotency_key"
  ON "withdrawal_requests"("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'SUCCESSFUL' AND enumtypid = '"WithdrawalStatus"'::regtype) THEN
    ALTER TYPE "WithdrawalStatus" ADD VALUE 'SUCCESSFUL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'FAILED' AND enumtypid = '"WithdrawalStatus"'::regtype) THEN
    ALTER TYPE "WithdrawalStatus" ADD VALUE 'FAILED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'REVERSED' AND enumtypid = '"WithdrawalStatus"'::regtype) THEN
    ALTER TYPE "WithdrawalStatus" ADD VALUE 'REVERSED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'CANCELLED' AND enumtypid = '"WithdrawalStatus"'::regtype) THEN
    ALTER TYPE "WithdrawalStatus" ADD VALUE 'CANCELLED';
  END IF;
END $$;
