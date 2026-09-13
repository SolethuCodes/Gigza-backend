-- Drop the legacy service_requests table and its indexes/constraints.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_requestId_fkey";
DROP INDEX IF EXISTS "service_requests_userId_idx";
DROP INDEX IF EXISTS "service_requests_categoryId_idx";
DROP INDEX IF EXISTS "service_requests_isActive_preferredDate_idx";
DROP TABLE IF EXISTS "service_requests";