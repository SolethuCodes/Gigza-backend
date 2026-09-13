const { PrismaClient } = require('@prisma/client');
(async () => {
  const db = new PrismaClient();
  try {
    const p = await db.payment.findUnique({ where: { id: 'cmr7zrn7m000ch20emv27bcxc' } });
    const b = p ? await db.booking.findUnique({ where: { id: p.bookingId } }) : null;
    console.log('payment:', JSON.stringify(p, null, 2));
    console.log('booking:', JSON.stringify(b, null, 2));
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
})();
