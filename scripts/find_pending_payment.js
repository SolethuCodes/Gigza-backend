const { PrismaClient } = require('@prisma/client');
(async () => {
  const db = new PrismaClient();
  try {
    const p = await db.payment.findFirst({ where: { paymentGateway: 'PAYFAST', status: 'PENDING' } });
    console.log(JSON.stringify(p, null, 2));
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
})();
