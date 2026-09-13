const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

(async () => {
  const db = new PrismaClient();

  try {
    // Admin details to add
    const adminData = {
      email: 'admin@errands.com',
      phone: '+234800000001',
      firstName: 'System',
      lastName: 'Administrator',
      passwordHash: await bcrypt.hash('Admin@123456', 10), // Hash the password
      role: 'ADMIN',
      isEmailVerified: true,
      isPhoneVerified: true,
      isTwoFactorEnabled: false,
      isActive: true,
      isBanned: false,
    };

    // Check if admin already exists
    const existingAdmin = await db.admin.findUnique({
      where: { email: adminData.email },
    });

    if (existingAdmin) {
      console.log('✓ Admin already exists:', existingAdmin);
      return;
    }

    // Create new admin
    const newAdmin = await db.admin.create({
      data: adminData,
    });

    console.log('✓ Admin created successfully:');
    console.log(JSON.stringify(newAdmin, null, 2));
  } catch (e) {
    console.error('✗ Error creating admin:', e.message);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
})();
