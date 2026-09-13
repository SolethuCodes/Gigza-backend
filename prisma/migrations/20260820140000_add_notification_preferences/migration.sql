-- Per-account notification preference toggles for users and providers.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifyBookingUpdates" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifyBookingMessages" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifyPaymentAlerts" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifyAccountAlerts" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "notifyBookingUpdates" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "notifyBookingMessages" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "notifyPaymentAlerts" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "notifyAccountAlerts" BOOLEAN NOT NULL DEFAULT true;
