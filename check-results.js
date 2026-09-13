const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkResults() {
  try {
    const pending = await prisma.payment.count({ where: { status: 'PENDING' } });
    const completed = await prisma.payment.count({ where: { status: 'COMPLETED' } });

    console.log(`\n=== Payment Status Summary ===`);
    console.log(`PENDING: ${pending}`);
    console.log(`COMPLETED: ${completed}`);

    // Get wallet totals
    const wallets = await prisma.wallet.aggregate({
      _sum: { balance: true, totalEarned: true }
    });

    console.log(`\n=== Wallet Summary ===`);
    console.log(`Total Balance: R${wallets._sum.balance || 0}`);
    console.log(`Total Earned: R${wallets._sum.totalEarned || 0}`);

    // Get specific wallet for the provider in the screenshot
    const recentPayments = await prisma.payment.findMany({
      where: { status: 'COMPLETED' },
      take: 3,
      orderBy: { updatedAt: 'desc' },
      include: {
        booking: { select: { id: true, status: true } }
      }
    });

    console.log(`\n=== Latest 3 Confirmed Payments ===`);
    recentPayments.forEach(p => {
      console.log(`Payment ${p.id.substring(0, 8)}... → Booking ${p.bookingId.substring(0, 8)}... (${p.booking.status})`);
      console.log(`  Status: ${p.status}, Provider Earnings: R${p.providerEarnings}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkResults();
