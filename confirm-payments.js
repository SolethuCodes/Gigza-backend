const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function confirmPayments() {
  try {
    // Get all pending payments
    const pendingPayments = await prisma.payment.findMany({
      where: { status: 'PENDING' },
      include: { booking: true }
    });

    console.log(`Found ${pendingPayments.length} pending payments\n`);

    for (const payment of pendingPayments) {
      console.log(`Processing payment: ${payment.id}`);
      console.log(`  Booking: ${payment.bookingId}`);
      console.log(`  Amount: R${payment.amount}`);
      console.log(`  Provider Earnings: R${payment.providerEarnings}`);
      console.log(`  Current Booking Status: ${payment.booking.status}`);

      // Get or create wallet for provider
      const wallet = await prisma.wallet.upsert({
        where: { providerId: payment.providerId },
        update: {},
        create: { providerId: payment.providerId }
      });

      const before = Number(wallet.balance);
      const amount = Number(payment.providerEarnings);
      const after = before + amount;

      // Update payment to COMPLETED
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'COMPLETED',
          paidAt: new Date(),
          gatewayTransactionId: `manual-confirm-${Date.now()}`,
          gatewayResponse: { manual: true, confirmedAt: new Date().toISOString() }
        }
      });

      // Update booking to PAID (only if not already completed)
      if (payment.booking.status !== 'PAID') {
        await prisma.booking.update({
          where: { id: payment.bookingId },
          data: {
            status: 'PAID',
            finalPrice: payment.amount,
            commissionAmount: payment.commissionAmount,
            providerEarnings: payment.providerEarnings
          }
        });
      }

      // Credit wallet
      await prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: after,
          totalEarned: { increment: amount }
        }
      });

      // Create wallet transaction record
      await prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          paymentId: payment.id,
          type: 'CREDIT',
          amount: amount,
          balanceBefore: before,
          balanceAfter: after,
          description: `Earnings for booking ${payment.bookingId}`
        }
      });

      console.log(`  ✓ CONFIRMED`);
      console.log(`  ✓ Wallet credited: R${before} → R${after}`);
      console.log(`  ✓ Booking status: PENDING → PAID\n`);
    }

    console.log(`\n✓ Successfully confirmed all ${pendingPayments.length} pending payments`);
    
  } catch (error) {
    console.error('Error confirming payments:', error);
  } finally {
    await prisma.$disconnect();
  }
}

confirmPayments();
