const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const roles = await prisma.$queryRawUnsafe(`SELECT role, count(*) AS cnt FROM users GROUP BY role ORDER BY role;`);
    console.dir(roles, { depth: null, colors: false });
  } catch (e) {
    console.error('ERROR', e);
  } finally {
    await prisma.$disconnect();
  }
})();
