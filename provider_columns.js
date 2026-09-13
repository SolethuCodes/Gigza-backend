const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const cols = await prisma.$queryRawUnsafe(`
      SELECT table_name, column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN (
        'provider_profiles','provider_current_locations','provider_location_history','provider_service_categories','wallets','bookings','payments','withdrawal_requests','ratings'
      )
      ORDER BY table_name, column_name;
    `);
    console.log(JSON.stringify(cols, null, 2));
  } catch (e) {
    console.error('ERROR', e);
  } finally {
    await prisma.$disconnect();
  }
})();
