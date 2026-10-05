/**
 * Seeds demo content so the Gigza app has something to show:
 *   - DJ genres (service categories)
 *   - a demo host login and a demo DJ login (both pre-verified)
 *   - a handful of KYC-approved showcase DJs with packages, spread across SA
 *
 * Idempotent: re-running updates the same records. Every demo account uses a
 * `@demo.gigza.co.za` email so it's easy to find and remove.
 *
 *   node -r dotenv/config scripts/seed-gigza-demo.js            # seed / refresh
 *   node -r dotenv/config scripts/seed-gigza-demo.js --remove   # delete demo accounts (keeps genres)
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DEMO_DOMAIN = '@demo.gigza.co.za';
const DEMO_PASSWORD = 'GigzaDemo@1';
const DAY = 86_400_000;

const img = (id) => `https://images.unsplash.com/photo-${id}?w=600&fit=crop&q=80`;
const PHOTOS = {
  stage: img('1470225620780-dba8ba36b745'),
  crowd: img('1470229722913-7c0e2dbbafd3'),
  decks: img('1493225457124-a3eb161ffa5f'),
  booth: img('1514320291840-2e0a9bf2a9ae'),
  lights: img('1514525253161-7a46d19cd819'),
  mixer: img('1516450360452-9312f5e86fc7'),
  wedding: img('1571330735066-03aaa9429d89'),
  club: img('1598387993441-a364f854c3e1'),
};

const GENRES = [
  ['Amapiano', 'amapiano'],
  ['House', 'house'],
  ['Deep House', 'deep-house'],
  ['Hip-Hop', 'hip-hop'],
  ['Afrobeats', 'afrobeats'],
  ['Gqom', 'gqom'],
  ['R&B', 'rnb'],
  ['Commercial / Top 40', 'commercial'],
  ['EDM', 'edm'],
];

const HOST = {
  email: `host${DEMO_DOMAIN}`,
  phone: '+27600000100',
  firstName: 'Demo',
  lastName: 'Host',
};

// `login: true` marks the DJ account handed out for signing in as a DJ.
const DJS = [
  {
    key: 'dj', login: true, firstName: 'DJ', lastName: 'Demo', phone: '+27600000200',
    bio: 'Demo DJ account — sign in with this to explore the DJ side of Gigza.',
    joinedDaysAgo: 1, rating: [0, 0], jobs: 0,
    location: [-26.1452, 28.0436, 'Rosebank, Johannesburg'], avatar: PHOTOS.mixer,
    packages: [
      { genre: 'commercial', name: 'Party Set — Top 40 & Throwbacks', price: 1200, unit: 'hour', image: PHOTOS.club },
      { genre: 'edm', name: 'EDM Night (4hrs)', price: 5000, unit: 'event', image: PHOTOS.lights },
    ],
  },
  {
    key: 'nova', firstName: 'DJ', lastName: 'Nova', phone: '+27600000201',
    bio: 'Amapiano and soulful house for rooftops, weddings and late nights.',
    joinedDaysAgo: 3, rating: [0, 0], jobs: 0,
    location: [-26.1076, 28.0567, 'Sandton, Johannesburg'], avatar: PHOTOS.stage,
    packages: [
      { genre: 'amapiano', name: 'Amapiano Sundowner (3hrs)', price: 4500, unit: 'event', image: PHOTOS.crowd },
      { genre: 'house', name: 'Wedding Reception — Open Dancefloor', price: 1500, unit: 'hour', image: PHOTOS.wedding },
      { genre: 'amapiano', name: 'Extra hour', price: 1200, pricingType: 'PER_ITEM', unitLabel: 'extra hour', image: PHOTOS.decks },
    ],
  },
  {
    key: 'lerato', firstName: 'Lerato', lastName: 'Keys', phone: '+27600000202',
    bio: 'Deep house and R&B selector. Corporate events and intimate venues.',
    joinedDaysAgo: 12, rating: [0, 0], jobs: 0,
    location: [-33.9249, 18.4241, 'City Bowl, Cape Town'], avatar: PHOTOS.booth,
    packages: [
      { genre: 'deep-house', name: 'Deep House Lounge Set', price: 1100, unit: 'hour', image: PHOTOS.booth },
      { genre: 'rnb', name: 'R&B Dinner Party (3hrs)', price: 3800, unit: 'event', image: PHOTOS.lights },
    ],
  },
  {
    key: 'zulu', firstName: 'DJ', lastName: 'Zulu Bass', phone: '+27600000203',
    bio: 'Durban gqom and amapiano energy. Festivals, clubs and street parties.',
    joinedDaysAgo: 25, rating: [4.8, 3], jobs: 3,
    location: [-29.8587, 31.0218, 'Durban Central'], avatar: PHOTOS.decks,
    packages: [
      { genre: 'gqom', name: 'Gqom Club Takeover', price: 1300, unit: 'hour', image: PHOTOS.club },
      { genre: 'amapiano', name: 'Festival Stage Set (2hrs)', price: 6000, unit: 'event', image: PHOTOS.stage },
    ],
  },
  {
    key: 'blaze', firstName: 'MC', lastName: 'Blaze', phone: '+27600000204',
    bio: 'Hip-hop DJ and hype MC — birthdays, 21sts and campus events.',
    joinedDaysAgo: 200, rating: [4.9, 6], jobs: 6,
    location: [-26.2485, 27.854, 'Soweto, Johannesburg'], avatar: PHOTOS.crowd,
    packages: [
      { genre: 'hip-hop', name: 'Birthday Bash Hip-Hop Set (4hrs)', price: 4200, unit: 'event', image: PHOTOS.crowd },
      { genre: 'commercial', name: 'MC + DJ Combo', price: 1400, unit: 'hour', image: PHOTOS.mixer },
    ],
  },
  {
    key: 'sunset', firstName: 'Sunset', lastName: 'Selector', phone: '+27600000205',
    bio: 'Afrobeats and house for weddings and garden parties since 2016.',
    joinedDaysAgo: 400, rating: [4.6, 42], jobs: 58,
    location: [-25.7479, 28.2293, 'Hatfield, Pretoria'], avatar: PHOTOS.wedding,
    packages: [
      { genre: 'afrobeats', name: 'Afrobeats Garden Party (3hrs)', price: 5200, unit: 'event', image: PHOTOS.lights },
      { genre: 'house', name: 'Full Wedding Package (ceremony to last dance)', price: 9500, unit: 'event', image: PHOTOS.wedding },
    ],
  },
];

const djEmail = (dj) => (dj.login ? `dj${DEMO_DOMAIN}` : `${dj.key}${DEMO_DOMAIN}`);

async function remove() {
  const providers = await prisma.provider.deleteMany({ where: { email: { endsWith: DEMO_DOMAIN } } });
  const users = await prisma.user.deleteMany({ where: { email: { endsWith: DEMO_DOMAIN } } });
  console.log(`Removed ${providers.count} demo DJs and ${users.count} demo hosts (genres kept).`);
}

async function seed() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const genreIds = {};
  for (const [i, [name, slug]] of GENRES.entries()) {
    const genre = await prisma.serviceCategory.upsert({
      where: { slug },
      update: { name, isActive: true, status: 'APPROVED', sortOrder: i },
      create: { name, slug, isActive: true, status: 'APPROVED', sortOrder: i },
    });
    genreIds[slug] = genre.id;
  }
  console.log(`✓ ${GENRES.length} genres`);

  await prisma.user.upsert({
    where: { email: HOST.email },
    update: { passwordHash, isEmailVerified: true, isPhoneVerified: true, isActive: true, isBanned: false, deletedAt: null },
    create: { ...HOST, passwordHash, role: 'USER', isEmailVerified: true, isPhoneVerified: true },
  });
  console.log(`✓ demo host ${HOST.email}`);

  for (const dj of DJS) {
    const email = djEmail(dj);
    const [avgRating, totalRatings] = dj.rating;
    const profile = {
      firstName: dj.firstName,
      lastName: dj.lastName,
      bio: dj.bio,
      avatarUrl: dj.avatar,
      passwordHash,
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
      isBanned: false,
      deletedAt: null,
      kycStatus: 'APPROVED',
      kycReviewedAt: new Date(),
      isAvailable: true,
      avgRating,
      totalRatings,
      totalJobsCompleted: dj.jobs,
      serviceRadius: 50,
    };
    const provider = await prisma.provider.upsert({
      where: { email },
      update: profile,
      create: { ...profile, email, phone: dj.phone, createdAt: new Date(Date.now() - dj.joinedDaysAgo * DAY) },
    });

    const [latitude, longitude, address] = dj.location;
    await prisma.providerCurrentLocation.upsert({
      where: { providerId: provider.id },
      update: { latitude, longitude, address },
      create: { providerId: provider.id, latitude, longitude, address },
    });

    // Rebuild packages and genre links from scratch so edits above take effect.
    await prisma.service.deleteMany({ where: { providerId: provider.id } });
    await prisma.providerServiceCategory.deleteMany({ where: { providerId: provider.id } });
    for (const pkg of dj.packages) {
      await prisma.service.create({
        data: {
          providerId: provider.id,
          categoryId: genreIds[pkg.genre],
          name: pkg.name,
          description: `${pkg.name} by ${dj.firstName} ${dj.lastName}.`,
          basePrice: pkg.price,
          priceUnit: pkg.pricingType === 'PER_ITEM' ? pkg.unitLabel : pkg.unit,
          pricingType: pkg.pricingType ?? 'FLAT',
          unitLabel: pkg.unitLabel ?? null,
          imageUrl: pkg.image,
          isActive: true,
        },
      });
    }
    const genreSlugs = [...new Set(dj.packages.map((p) => p.genre))];
    for (const slug of genreSlugs) {
      const cheapest = Math.min(...dj.packages.filter((p) => p.genre === slug).map((p) => p.price));
      await prisma.providerServiceCategory.create({
        data: { providerId: provider.id, categoryId: genreIds[slug], basePrice: cheapest, yearsExperience: 3 },
      });
    }
    console.log(`✓ ${dj.login ? 'demo DJ login' : 'showcase DJ'} ${dj.firstName} ${dj.lastName} <${email}>`);
  }

  console.log(`\nDemo logins (password for both: ${DEMO_PASSWORD})`);
  console.log(`  Host: ${HOST.email}`);
  console.log(`  DJ:   ${djEmail(DJS[0])}`);
}

(process.argv.includes('--remove') ? remove() : seed())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
