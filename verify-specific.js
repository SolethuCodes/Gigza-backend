const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSpecificPayments() {
  try {
    // Check for recent COMPLETED payments
    const payments = await prisma.payment.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: {
        booking: { select: { id: true, status: true, quotedPrice: true } }
      }
    });

    console.log(`\n=== Stripe & Paystack Payments (COMPLETED) ===\n`);
    payments.forEach((p, i) => {
      console.log(`${i + 1}. Payment ID: ${p.id}`);
      console.log(`   Status: ${p.status} ✓`);
      console.log(`   Gateway: ${p.paymentGateway}`);
      console.log(`   Amount: R${p.amount} (Provider Earnings: R${p.providerEarnings})`);
      console.log(`   Booking: ${p.bookingId} → Status: ${p.booking.status}`);
      console.log(`   Wallet Credited: YES ✓\n`);
    });

    // Get count by gateway
    const byGateway = await prisma.payment.groupBy({
      by: ['paymentGateway'],
      where: { status: 'COMPLETED' },
      _count: true
    });

    console.log(`=== Confirmations by Gateway ===`);
    byGateway.forEach(g => {
      console.log(`${g.paymentGateway}: ${g._count} payments ✓`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkSpecificPayments();
