/// <reference types="node" />
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Seed service categories
  const categories = [
    { name: 'Cleaning', slug: 'cleaning', description: 'Home and office cleaning services', iconUrl: '/icons/cleaning.svg', sortOrder: 1 },
    { name: 'Maintenance & Repairs', slug: 'maintenance', description: 'Plumbing, electrical, and general repairs', iconUrl: '/icons/maintenance.svg', sortOrder: 2 },
    { name: 'Landscaping', slug: 'landscaping', description: 'Garden maintenance, lawn care, and landscaping', iconUrl: '/icons/landscaping.svg', sortOrder: 3 },
    { name: 'Personal Assistance', slug: 'personal-assistance', description: 'Errand running, shopping, and personal tasks', iconUrl: '/icons/personal.svg', sortOrder: 4 },
    { name: 'IT Services', slug: 'it-services', description: 'Tech support, setup, and IT solutions', iconUrl: '/icons/it.svg', sortOrder: 5 },
    { name: 'Moving & Delivery', slug: 'moving', description: 'Furniture moving and delivery services', iconUrl: '/icons/moving.svg', sortOrder: 6 },
    { name: 'Cooking & Catering', slug: 'cooking', description: 'Meal preparation and catering services', iconUrl: '/icons/cooking.svg', sortOrder: 7 },
    { name: 'Tutoring & Education', slug: 'tutoring', description: 'Academic tutoring and coaching', iconUrl: '/icons/tutoring.svg', sortOrder: 8 },
  ];

  for (const category of categories) {
    await prisma.serviceCategory.upsert({
      where: { slug: category.slug },
      update: {},
      create: category,
    });
  }

  console.log('✓ Service categories seeded');

  // Seed default admin account in the dedicated admins table
  const adminPassword = process.env['ADMIN_PASSWORD'] ?? 'Admin@123!';
  const adminPasswordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.admin.upsert({
    where: { email: 'admin@e-rrands.co.za' },
    update: { passwordHash: adminPasswordHash },
    create: {
      email: 'admin@e-rrands.co.za',
      phone: '+27000000000',
      passwordHash: adminPasswordHash,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'ADMIN',
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    },
  });

  console.log('✓ Admin user seeded');

  const superRole = await prisma.adminRole.upsert({
    where: { slug: 'super-admin' },
    update: {
      name: 'Super Admin',
      description: 'Full control of the administrator console',
      permissions: [
        'users.view', 'users.manage', 'users.export',
        'providers.view', 'providers.verify', 'providers.manage', 'providers.export',
        'bookings.view', 'bookings.export',
        'issues.view', 'issues.resolve',
        'payments.view', 'payments.withdrawals', 'payments.export',
        'analytics.view', 'analytics.export',
        'audit.view', 'support.view', 'system.view',
        'settings.view', 'settings.update',
        'access.view', 'access.manage',
      ],
      isSystem: true,
    },
    create: {
      name: 'Super Admin',
      slug: 'super-admin',
      description: 'Full control of the administrator console',
      permissions: [
        'users.view', 'users.manage', 'users.export',
        'providers.view', 'providers.verify', 'providers.manage', 'providers.export',
        'bookings.view', 'bookings.export',
        'issues.view', 'issues.resolve',
        'payments.view', 'payments.withdrawals', 'payments.export',
        'analytics.view', 'analytics.export',
        'audit.view', 'support.view', 'system.view',
        'settings.view', 'settings.update',
        'access.view', 'access.manage',
      ],
      isSystem: true,
    },
  });

  await prisma.admin.update({
    where: { email: 'admin@e-rrands.co.za' },
    data: { roleId: superRole.id, inviteStatus: 'ACTIVE', mustChangePassword: false },
  });

  console.log('✓ Super Admin role seeded');

  // Seed a SUPPORT-role account and a plain USER account for role-gating tests
  const supportPasswordHash = await bcrypt.hash('Support@123!', 12);
  await prisma.user.upsert({
    where: { email: 'support@e-rrands.co.za' },
    update: { passwordHash: supportPasswordHash },
    create: {
      email: 'support@e-rrands.co.za',
      phone: '+27000000001',
      passwordHash: supportPasswordHash,
      firstName: 'Support',
      lastName: 'Staff',
      role: 'SUPPORT',
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    },
  });

  console.log('✓ Support user seeded');

  const testUserPasswordHash = await bcrypt.hash('User@123!', 12);
  await prisma.user.upsert({
    where: { email: 'testuser@e-rrands.co.za' },
    update: { passwordHash: testUserPasswordHash },
    create: {
      email: 'testuser@e-rrands.co.za',
      phone: '+27000000002',
      passwordHash: testUserPasswordHash,
      firstName: 'Test',
      lastName: 'User',
      role: 'USER',
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    },
  });

  console.log('✓ Test user seeded');

  await seedDemoData();
  console.log('\n🚀 Database seed complete!');
}

// Sample bookings/payments/disputes/withdrawals/support tickets so the admin
// dashboard has real, non-empty data to render (charts, tables, reports).
// Skipped if bookings already exist, so re-running seed doesn't pile up duplicates.
async function seedDemoData() {
  const existingBookings = await prisma.booking.count();
  if (existingBookings > 0) {
    console.log('✓ Demo booking/payment/dispute data already present, skipping');
    return;
  }

  const categories = await prisma.serviceCategory.findMany();
  const users = await prisma.user.findMany({ where: { role: 'USER' } });
  const providers = await prisma.provider.findMany();
  const admin = await prisma.admin.findFirstOrThrow({ where: { role: 'ADMIN' } });

  if (categories.length === 0 || users.length === 0 || providers.length === 0) {
    console.log('⚠ Not enough users/providers/categories to seed demo bookings, skipping');
    return;
  }

  // Ensure every provider has a wallet
  for (const provider of providers) {
    await prisma.wallet.upsert({
      where: { providerId: provider.id },
      update: {},
      create: { providerId: provider.id, balance: 0, pendingBalance: 0, totalEarned: 0, totalWithdrawn: 0 },
    });
  }

  const statuses = ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'PAID', 'CANCELLED', 'DISPUTED'] as const;
  const paymentMethods = ['CARD', 'MOBILE_WALLET', 'BANK_TRANSFER', 'WALLET_BALANCE'] as const;
  const paymentGateways = ['PAYFAST', 'STRIPE', 'MANUAL'] as const;

  const bookingIds: { id: string; status: string; providerId: string; userId: string; finalPrice: number }[] = [];

  // Spread 24 sample bookings across the last 6 months
  for (let i = 0; i < 24; i++) {
    const category = categories[i % categories.length];
    const user = users[i % users.length];
    const provider = providers[i % providers.length];
    const status = statuses[i % statuses.length];
    const monthsAgo = i % 6;
    const createdAt = new Date();
    createdAt.setMonth(createdAt.getMonth() - monthsAgo);
    createdAt.setDate(1 + (i % 27));

    const quotedPrice = 150 + (i % 10) * 45;
    const commissionRate = 0.15;
    const isTerminal = status === 'COMPLETED' || status === 'PAID' || status === 'DISPUTED';
    const finalPrice = isTerminal ? quotedPrice : null;
    const commissionAmount = isTerminal ? quotedPrice * commissionRate : null;
    const providerEarnings = isTerminal ? quotedPrice * (1 - commissionRate) : null;

    const request = await prisma.serviceRequest.create({
      data: {
        userId: user.id,
        categoryId: category.id,
        title: `${category.name} request #${i + 1}`,
        description: `Sample ${category.name.toLowerCase()} request generated for demo data.`,
        preferredDate: createdAt,
        address: '123 Demo Street, Johannesburg',
        estimatedBudget: quotedPrice,
        isActive: status === 'PENDING',
        createdAt,
      },
    });

    const booking = await prisma.booking.create({
      data: {
        requestId: request.id,
        userId: user.id,
        providerId: provider.id,
        status: status as never,
        quotedPrice,
        finalPrice,
        commissionRate,
        commissionAmount,
        providerEarnings,
        acceptedAt: status === 'PENDING' ? null : createdAt,
        completedAt: isTerminal ? createdAt : null,
        cancelledAt: status === 'CANCELLED' ? createdAt : null,
        createdAt,
        updatedAt: createdAt,
      },
    });
    bookingIds.push({ id: booking.id, status, providerId: provider.id, userId: user.id, finalPrice: finalPrice ?? 0 });

    if (isTerminal) {
      const paymentStatus = status === 'DISPUTED' ? 'COMPLETED' : 'COMPLETED';
      await prisma.payment.create({
        data: {
          bookingId: booking.id,
          userId: user.id,
          providerId: provider.id,
          amount: quotedPrice,
          commissionAmount: commissionAmount!,
          commissionRate,
          providerEarnings: providerEarnings!,
          paymentMethod: paymentMethods[i % paymentMethods.length] as never,
          paymentGateway: paymentGateways[i % paymentGateways.length] as never,
          status: paymentStatus as never,
          paidAt: createdAt,
        },
      });

      await prisma.wallet.update({
        where: { providerId: provider.id },
        data: { totalEarned: { increment: providerEarnings! }, balance: { increment: providerEarnings! } },
      });
    }
  }
  console.log('✓ 24 demo bookings + payments seeded across the last 6 months');

  // A couple of disputes on DISPUTED bookings
  const disputeTypes = ['SERVICE_QUALITY', 'PAYMENT', 'PROVIDER_NO_SHOW'] as const;
  const disputedBookings = bookingIds.filter((b) => b.status === 'DISPUTED');
  for (let i = 0; i < disputedBookings.length; i++) {
    const b = disputedBookings[i];
    await prisma.dispute.create({
      data: {
        bookingId: b.id,
        raisedByUserId: b.userId,
        againstProviderId: b.providerId,
        type: disputeTypes[i % disputeTypes.length] as never,
        description: 'Sample dispute generated for demo data — service did not match what was agreed.',
        status: (i % 2 === 0 ? 'OPEN' : 'RESOLVED') as never,
        resolution: i % 2 === 0 ? undefined : 'Refund issued to customer after review.',
        resolvedById: i % 2 === 0 ? undefined : admin.id,
        resolvedAt: i % 2 === 0 ? undefined : new Date(),
      },
    });
  }
  console.log(`✓ ${disputedBookings.length} demo disputes seeded`);

  // Withdrawal requests for providers with earnings
  const withdrawalStatuses = ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED'] as const;
  let widx = 0;
  for (const provider of providers) {
    const wallet = await prisma.wallet.findUnique({ where: { providerId: provider.id } });
    if (!wallet || Number(wallet.balance) <= 0) continue;
    const status = withdrawalStatuses[widx % withdrawalStatuses.length];
    const amount = Math.min(Number(wallet.balance), 200 + widx * 50);
    await prisma.withdrawalRequest.create({
      data: {
        walletId: wallet.id,
        providerId: provider.id,
        amount,
        bankDetails: { bankName: 'FNB', accountNumber: '62812345678', accountHolder: `${provider.firstName} ${provider.lastName}`, branchCode: '250655' },
        status: status as never,
        approvedById: status === 'PENDING' ? undefined : admin.id,
        processedAt: status === 'PENDING' ? undefined : new Date(),
        completedAt: status === 'COMPLETED' ? new Date() : undefined,
        rejectedAt: status === 'REJECTED' ? new Date() : undefined,
        rejectionReason: status === 'REJECTED' ? 'Bank details could not be verified.' : undefined,
      },
    });
    if (status === 'PENDING') {
      await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount }, pendingBalance: { increment: amount } } });
    }
    widx++;
  }
  console.log(`✓ ${widx} demo withdrawal requests seeded`);

  // Support tickets with a short message thread each
  const ticketSeeds = [
    { subject: 'Payment deducted twice for the same booking', priority: 'URGENT', status: 'OPEN', category: 'Billing' },
    { subject: 'Unable to upload KYC documents', priority: 'HIGH', status: 'IN_PROGRESS', category: 'Verification' },
    { subject: 'How do I change my service area?', priority: 'LOW', status: 'RESOLVED', category: 'General' },
    { subject: 'App crashes when booking a cleaning service', priority: 'HIGH', status: 'OPEN', category: 'Technical' },
  ];
  for (let i = 0; i < ticketSeeds.length; i++) {
    const seed = ticketSeeds[i];
    const user = users[i % users.length];
    const ticket = await prisma.supportTicket.create({
      data: {
        userId: user.id,
        subject: seed.subject,
        description: `${seed.subject} — reported by ${user.firstName} ${user.lastName}.`,
        status: seed.status as never,
        priority: seed.priority as never,
        category: seed.category,
        assignedToId: seed.status === 'OPEN' ? undefined : admin.id,
        resolvedAt: seed.status === 'RESOLVED' ? new Date() : undefined,
      },
    });
    await prisma.supportTicketMessage.create({
      data: { ticketId: ticket.id, authorId: user.id, body: 'Please could someone take a look at this?', isInternal: false },
    });
    if (seed.status !== 'OPEN') {
      await prisma.supportTicketMessage.create({
        data: { ticketId: ticket.id, authorId: admin.id, body: "Thanks for reporting — we're looking into it now.", isInternal: false },
      });
    }
  }
  console.log(`✓ ${ticketSeeds.length} demo support tickets seeded`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
