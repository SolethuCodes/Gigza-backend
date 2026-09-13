const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const roles = await prisma.$queryRawUnsafe(`SELECT role, count(*) AS cnt FROM users GROUP BY role ORDER BY role;`);
    const profileCount = await prisma.$queryRawUnsafe(`SELECT count(*) FROM provider_profiles;`);
    const providerCount = await prisma.$queryRawUnsafe(`SELECT count(*) FROM providers;`);
    console.log('roles:', JSON.stringify(roles, null, 2));
    console.log('provider_profiles:', JSON.stringify(profileCount, null, 2));
    console.log('providers:', JSON.stringify(providerCount, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
})();
