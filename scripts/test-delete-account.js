/**
 * Local test for DELETE /users/me (account deletion).
 *
 * Usage:  docker compose up -d && npm run dev   (one terminal)
 *         node scripts/test-delete-account.js   (another)
 *
 * Optional env: API_BASE (default http://localhost:4000/api/v1)
 */
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const prisma = new PrismaClient();

const post = (path, body, token) =>
  axios.post(`${API_BASE}${path}`, body, {
    validateStatus: () => true,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
const del = (path, body, token) =>
  axios.request({
    method: 'DELETE',
    url: `${API_BASE}${path}`,
    data: body,
    validateStatus: () => true,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

async function register() {
  const stamp = Date.now().toString().slice(-9);
  const email = `qa_del_${stamp}@example.com`;
  const password = 'DeleteMe@123';
  const phone = `+2771${stamp}`;
  const res = await post('/auth/register', {
    email,
    password,
    phone,
    firstName: 'Quality',
    lastName: 'Assurance',
  });
  if (res.status >= 300) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.data)}`);
  const token = res.data?.data?.tokens?.accessToken;
  const userId = res.data?.data?.user?.id;
  return { email, password, phone, token, userId };
}

async function main() {
  console.log(`API: ${API_BASE}\n`);

  // --- happy path ---
  const a = await register();
  console.log(`1) registered ${a.email}  (id ${a.userId})`);

  const wrong = await del('/users/me', { confirmation: 'delete' }, a.token);
  console.log(`2) wrong confirmation  -> ${wrong.status}  ${JSON.stringify(wrong.data).slice(0, 120)}`);

  const ok = await del('/users/me', { confirmation: 'DELETE' }, a.token);
  console.log(`3) delete              -> ${ok.status}  ${JSON.stringify(ok.data).slice(0, 120)}`);

  const relogin = await post('/auth/login', { email: a.email, password: a.password });
  console.log(`4) login after delete  -> ${relogin.status} (expect 401)  ${JSON.stringify(relogin.data).slice(0, 120)}`);

  const row = await prisma.user.findUnique({ where: { id: a.userId } });
  console.log('5) db row after delete ->', {
    email: row?.email,
    firstName: row?.firstName,
    lastName: row?.lastName,
    isActive: row?.isActive,
    passwordHash: row?.passwordHash,
  });
  const oauth = await prisma.oAuthAccount.count({ where: { userId: a.userId } });
  console.log(`   oauth links remaining: ${oauth} (expect 0)`);

  // --- blocked by active booking ---
  const b = await register();
  const anyService = await prisma.service.findFirst();
  const anyProvider = await prisma.provider.findFirst();
  if (anyService && anyProvider) {
    await prisma.booking.create({
      data: {
        serviceId: anyService.id,
        userId: b.userId,
        providerId: anyProvider.id,
        status: 'PENDING',
        quotedPrice: 100,
        commissionRate: 0.1,
      },
    });
    const blocked = await del('/users/me', { confirmation: 'DELETE' }, b.token);
    console.log(`\n6) delete w/ active booking -> ${blocked.status} (expect 409)  ${JSON.stringify(blocked.data).slice(0, 160)}`);
    // cleanup so the throwaway user can still be removed later
    await prisma.booking.updateMany({ where: { userId: b.userId }, data: { status: 'CANCELLED' } });
    const after = await del('/users/me', { confirmation: 'DELETE' }, b.token);
    console.log(`7) delete after cancel     -> ${after.status} (expect 200)`);
  } else {
    console.log('\n(6/7 skipped — no seed service/provider to build a booking)');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
