-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CASH';

-- Map existing /10 scores back onto 1–5
UPDATE "ratings"
SET "score" = GREATEST(1, LEAST(5, CEIL("score"::numeric / 2.0)::integer));

-- Recompute provider aggregates on the /5 scale
UPDATE "providers" AS p
SET
  "avgRating" = COALESCE(agg.avg_score, 0),
  "totalRatings" = COALESCE(agg.rating_count, 0)
FROM (
  SELECT
    "toProviderId" AS id,
    ROUND(AVG("score")::numeric, 2) AS avg_score,
    COUNT(*)::int AS rating_count
  FROM "ratings"
  WHERE "ratingFrom" = 'USER_TO_PROVIDER' AND "toProviderId" IS NOT NULL
  GROUP BY "toProviderId"
) AS agg
WHERE p."id" = agg.id;

-- Recompute user aggregates from provider→customer ratings
UPDATE "users" AS u
SET
  "avgRating" = COALESCE(agg.avg_score, 0),
  "totalRatings" = COALESCE(agg.rating_count, 0)
FROM (
  SELECT
    "toUserId" AS id,
    ROUND(AVG("score")::numeric, 2) AS avg_score,
    COUNT(*)::int AS rating_count
  FROM "ratings"
  WHERE "ratingFrom" = 'PROVIDER_TO_USER' AND "toUserId" IS NOT NULL
  GROUP BY "toUserId"
) AS agg
WHERE u."id" = agg.id;
