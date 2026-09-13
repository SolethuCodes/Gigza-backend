/**
 * Inserts a handful of providers in various KYC states so the admin KYC-approval
 * flow can be exercised locally. Safe to re-run (upserts by email).
 *
 *   node scripts/seed-kyc-test-providers.mjs
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const passwordHash = await bcrypt.hash('Provider@123!', 12);

const providers = [
  { email: 'thabo.review@example.com',  phone: '+27610000001', firstName: 'Thabo',  lastName: 'Nkosi',    kycStatus: 'UNDER_REVIEW' },
  { email: 'lerato.review@example.com',  phone: '+27610000002', firstName: 'Lerato', lastName: 'Dlamini',  kycStatus: 'UNDER_REVIEW' },
  { email: 'sipho.pending@example.com',  phone: '+27610000003', firstName: 'Sipho',  lastName: 'Khumalo',  kycStatus: 'PENDING' },
  { email: 'naledi.approved@example.com',phone: '+27610000004', firstName: 'Naledi', lastName: 'Mokoena',  kycStatus: 'APPROVED' },
];

for (const p of providers) {
  const row = await prisma.provider.upsert({
    where: { email: p.email },
    update: { kycStatus: p.kycStatus, kycReviewNotes: null, kycReviewedAt: null, kycReviewedBy: null },
    create: {
      email: p.email,
      phone: p.phone,
      passwordHash,
      firstName: p.firstName,
      lastName: p.lastName,
      bio: 'Test provider for KYC approval flow.',
      kycStatus: p.kycStatus,
      kycDocuments: [
        { type: 'ID_CARD', url: 'https://example.com/mock/id-front.jpg', uploadedAt: new Date().toISOString() },
        { type: 'SELFIE', url: 'https://example.com/mock/selfie.jpg', uploadedAt: new Date().toISOString() },
      ],
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  console.log(`  ${row.kycStatus.padEnd(13)} ${row.email}  (${row.id})`);
}

await prisma.$disconnect();
console.log('\nDone. Login password for all: Provider@123!');
