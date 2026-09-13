import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('TestPass1!', 12);
  const admin = await prisma.admin.upsert({
    where: { email: 'claude-test-admin@e-rrands.co.za' },
    update: { passwordHash, isActive: true, isBanned: false, mustChangePassword: false },
    create: {
      email: 'claude-test-admin@e-rrands.co.za',
      phone: '+27000000099',
      passwordHash,
      firstName: 'Claude',
      lastName: 'Test',
      role: 'ADMIN',
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    },
  });
  console.log('TEST_ADMIN_ID=' + admin.id);
}

main().finally(() => prisma.$disconnect());
