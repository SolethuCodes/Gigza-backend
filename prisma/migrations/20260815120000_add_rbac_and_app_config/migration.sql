-- RBAC roles, admin invite fields, audit adminId, and platform app config.
-- IF NOT EXISTS keeps this safe if Azure was previously updated with `db push`.

CREATE TABLE IF NOT EXISTS "admin_roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_roles_slug_key" ON "admin_roles"("slug");
CREATE INDEX IF NOT EXISTS "admin_roles_slug_idx" ON "admin_roles"("slug");

ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "roleId" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "inviteStatus" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "invitedBy" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "invitedAt" TIMESTAMP(3);
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "admins_roleId_idx" ON "admins"("roleId");
CREATE INDEX IF NOT EXISTS "admins_inviteStatus_idx" ON "admins"("inviteStatus");

ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "adminId" TEXT;
CREATE INDEX IF NOT EXISTS "activity_logs_adminId_idx" ON "activity_logs"("adminId");

CREATE TABLE IF NOT EXISTS "app_configs" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "version" INTEGER NOT NULL DEFAULT 1,
    "platformName" TEXT NOT NULL DEFAULT 'E-RRANDS',
    "taglineUser" TEXT NOT NULL DEFAULT 'Book verified pros. Pay securely.',
    "taglineProvider" TEXT NOT NULL DEFAULT 'Get bookings. Grow your earnings.',
    "splashTagline" TEXT NOT NULL DEFAULT 'Enterprise Services Platform',
    "poweredBy" TEXT NOT NULL DEFAULT 'Powered by TechXM',
    "helpHeroTitle" TEXT NOT NULL DEFAULT 'How can we help you?',
    "helpHeroBody" TEXT NOT NULL DEFAULT 'Our team is here for anything about bookings, payments, or your account.',
    "colorPrimary" TEXT NOT NULL DEFAULT '#0F1C34',
    "colorAccent" TEXT NOT NULL DEFAULT '#BDA375',
    "colorTeal" TEXT NOT NULL DEFAULT '#0D9488',
    "supportEmail" TEXT NOT NULL DEFAULT 'support@errands.co.za',
    "supportPhone" TEXT NOT NULL DEFAULT '+27 800 000 000',
    "supportHours" TEXT NOT NULL DEFAULT 'Monday – Saturday, 8am – 6pm SAST',
    "liveChatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMessage" TEXT NOT NULL DEFAULT 'E-RRANDS is temporarily unavailable while we finish a platform update. Please try again shortly.',
    "websiteHeadline" TEXT NOT NULL DEFAULT 'Trusted help, booked in minutes.',
    "websiteSubheadline" TEXT NOT NULL DEFAULT 'Verified professionals for home, office and everyday errands — paid securely in South Africa.',
    "websiteFooter" TEXT NOT NULL DEFAULT '© E-RRANDS. A TechXM company.',
    "faqs" JSONB NOT NULL,
    "legalTerms" JSONB NOT NULL,
    "legalPrivacy" JSONB NOT NULL,
    "onboardingSlides" JSONB NOT NULL,
    "contentFlags" JSONB,
    "publishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "app_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "app_config_snapshots" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "reason" TEXT,
    "payload" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_config_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "app_config_snapshots_createdAt_idx" ON "app_config_snapshots"("createdAt");

DO $$
BEGIN
    ALTER TABLE "admins"
        ADD CONSTRAINT "admins_roleId_fkey"
        FOREIGN KEY ("roleId") REFERENCES "admin_roles"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "activity_logs"
        ADD CONSTRAINT "activity_logs_adminId_fkey"
        FOREIGN KEY ("adminId") REFERENCES "admins"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
