/**
 * Seeds demo content so the Gigza app has something to show:
 *   - styles (service categories) for each kind of talent: DJ genres, MC,
 *     photography and dance styles
 *   - a demo host login and a demo DJ login (both pre-verified)
 *   - KYC-approved showcase DJs, MCs, photographers and dancers with packages,
 *     spread across SA
 *
 * Idempotent: re-running updates the same records. Every demo account uses a
 * `@demo.gigza.co.za` email so it's easy to find and remove.
 *
 *   node -r dotenv/config scripts/seed-gigza-demo.js            # seed / refresh
 *   node -r dotenv/config scripts/seed-gigza-demo.js --remove   # delete demo accounts (keeps styles)
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
  micStudio: img('1478737270239-2f02b77fc618'),
  micVintage: img('1511671782779-c97d3d27a1d4'),
  conference: img('1540575467063-178a50c2df87'),
  concert: img('1524368535928-5b5e00ddc76b'),
  cameraFilm: img('1452587925148-ce544e77e70d'),
  cameraWhite: img('1502920917128-1aa500764cbd'),
  cameraLenses: img('1516035069371-29a1b244cc32'),
  bride: img('1519741497674-611481863552'),
  breakdance: img('1508700929628-666bc8bd84ea'),
  streetDance: img('1535525153412-5a42439a210d'),
  contemporary: img('1547153760-18fc86324498'),
  danceFloor: img('1504609813442-a8924e83f76e'),
};

// [name, slug, talentType] — order here is the order styles appear in the app.
const STYLES = [
  ['Amapiano', 'amapiano', 'DJ'],
  ['House', 'house', 'DJ'],
  ['Deep House', 'deep-house', 'DJ'],
  ['Hip-Hop', 'hip-hop', 'DJ'],
  ['Afrobeats', 'afrobeats', 'DJ'],
  ['Gqom', 'gqom', 'DJ'],
  ['R&B', 'rnb', 'DJ'],
  ['Commercial / Top 40', 'commercial', 'DJ'],
  ['EDM', 'edm', 'DJ'],
  ['Wedding MC', 'wedding-mc', 'MC'],
  ['Hype MC', 'hype-mc', 'MC'],
  ['Corporate MC', 'corporate-mc', 'MC'],
  ['Event Photography', 'event-photography', 'PHOTOGRAPHER'],
  ['Wedding Photography', 'wedding-photography', 'PHOTOGRAPHER'],
  ['Portraits & Content', 'portraits-content', 'PHOTOGRAPHER'],
  ['Pantsula', 'pantsula', 'DANCER'],
  ['Amapiano Dancers', 'amapiano-dancers', 'DANCER'],
  ['Hip-Hop Dance', 'hip-hop-dance', 'DANCER'],
  ['Contemporary', 'contemporary-dance', 'DANCER'],
];

const HOST = {
  email: `host${DEMO_DOMAIN}`,
  phone: '+27600000100',
  firstName: 'Demo',
  lastName: 'Host',
};

// `login: true` marks the DJ account handed out for signing in as a DJ.
// Each package's `genre` is a style slug from STYLES above.
const TALENT = [
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
  {
    key: 'thabo', firstName: 'MC', lastName: 'Thabo', phone: '+27600000206',
    bio: 'Bilingual wedding and corporate MC. Keeps the programme on time and the room laughing.',
    joinedDaysAgo: 150, rating: [4.9, 18], jobs: 24,
    location: [-26.1929, 28.0305, 'Braamfontein, Johannesburg'], avatar: PHOTOS.micVintage,
    packages: [
      { genre: 'wedding-mc', name: 'Wedding MC — Ceremony to Reception', price: 4500, unit: 'event', image: PHOTOS.bride },
      { genre: 'corporate-mc', name: 'Corporate Awards Host (3hrs)', price: 6000, unit: 'event', image: PHOTOS.conference },
    ],
  },
  {
    key: 'naledi', firstName: 'Naledi', lastName: 'Hype', phone: '+27600000207',
    bio: 'High-energy hype MC for clubs, festivals and 21sts. English, isiXhosa and Sesotho.',
    joinedDaysAgo: 20, rating: [0, 0], jobs: 0,
    location: [-33.9321, 18.8602, 'Stellenbosch'], avatar: PHOTOS.micStudio,
    packages: [
      { genre: 'hype-mc', name: 'Club Night Hype MC', price: 900, unit: 'hour', image: PHOTOS.concert },
      { genre: 'hype-mc', name: 'Festival Stage Host (full day)', price: 7500, unit: 'event', image: PHOTOS.crowd },
    ],
  },
  {
    key: 'ayanda', firstName: 'Ayanda', lastName: 'Lens', phone: '+27600000208',
    bio: 'Wedding and event photographer. Natural light, candid moments, edited gallery in 7 days.',
    joinedDaysAgo: 300, rating: [4.8, 27], jobs: 35,
    location: [-29.7275, 31.0846, 'Umhlanga, Durban'], avatar: PHOTOS.cameraFilm,
    packages: [
      { genre: 'wedding-photography', name: 'Full Wedding Day Coverage', price: 12000, unit: 'event', image: PHOTOS.bride },
      { genre: 'event-photography', name: 'Event Photography', price: 1500, unit: 'hour', image: PHOTOS.danceFloor },
    ],
  },
  {
    key: 'kgomotso', firstName: 'Kgomotso', lastName: 'Frames', phone: '+27600000209',
    bio: 'Portraits, brand content and party coverage in Pretoria and Joburg.',
    joinedDaysAgo: 9, rating: [0, 0], jobs: 0,
    location: [-25.7615, 28.2423, 'Brooklyn, Pretoria'], avatar: PHOTOS.cameraWhite,
    packages: [
      { genre: 'portraits-content', name: 'Portrait & Content Session (2hrs)', price: 2500, unit: 'event', image: PHOTOS.cameraLenses },
      { genre: 'event-photography', name: 'Birthday Party Coverage', price: 1100, unit: 'hour', image: PHOTOS.crowd },
    ],
  },
  {
    key: 'kasi', firstName: 'Kasi', lastName: 'Pantsula Crew', phone: '+27600000210',
    bio: 'Soweto pantsula crew — 6 dancers. Weddings, launches, music videos and festivals.',
    joinedDaysAgo: 120, rating: [4.9, 11], jobs: 14,
    location: [-26.2678, 27.8585, 'Orlando, Soweto'], avatar: PHOTOS.breakdance,
    packages: [
      { genre: 'pantsula', name: 'Pantsula Showcase (15-min set)', price: 3500, unit: 'event', image: PHOTOS.breakdance },
      { genre: 'amapiano-dancers', name: 'Amapiano Dance Floor Starters (1hr)', price: 2800, unit: 'event', image: PHOTOS.streetDance },
    ],
  },
  {
    key: 'rhythm', firstName: 'Rhythm', lastName: 'Collective', phone: '+27600000211',
    bio: 'Contemporary and hip-hop dance company. Choreographed pieces for weddings and corporate shows.',
    joinedDaysAgo: 45, rating: [4.7, 5], jobs: 6,
    location: [-33.9180, 18.4233, 'Woodstock, Cape Town'], avatar: PHOTOS.contemporary,
    packages: [
      { genre: 'contemporary-dance', name: 'First Dance Choreography (3 lessons)', price: 2400, unit: 'event', image: PHOTOS.contemporary },
      { genre: 'hip-hop-dance', name: 'Corporate Show Dance Act', price: 6500, unit: 'event', image: PHOTOS.streetDance },
    ],
  },
];

const talentEmail = (t) => (t.login ? `dj${DEMO_DOMAIN}` : `${t.key}${DEMO_DOMAIN}`);

async function remove() {
  const providers = await prisma.provider.deleteMany({ where: { email: { endsWith: DEMO_DOMAIN } } });
  const users = await prisma.user.deleteMany({ where: { email: { endsWith: DEMO_DOMAIN } } });
  console.log(`Removed ${providers.count} demo talent and ${users.count} demo hosts (styles kept).`);
}

async function seed() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const styleIds = {};
  for (const [i, [name, slug, talentType]] of STYLES.entries()) {
    const style = await prisma.serviceCategory.upsert({
      where: { slug },
      update: { name, talentType, isActive: true, status: 'APPROVED', sortOrder: i },
      create: { name, slug, talentType, isActive: true, status: 'APPROVED', sortOrder: i },
    });
    styleIds[slug] = style.id;
  }
  console.log(`✓ ${STYLES.length} styles`);

  await prisma.user.upsert({
    where: { email: HOST.email },
    update: { passwordHash, isEmailVerified: true, isPhoneVerified: true, isActive: true, isBanned: false, deletedAt: null },
    create: { ...HOST, passwordHash, role: 'USER', isEmailVerified: true, isPhoneVerified: true },
  });
  console.log(`✓ demo host ${HOST.email}`);

  for (const dj of TALENT) {
    const email = talentEmail(dj);
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

    // Update packages in place (matched by name) so existing demo bookings keep
    // pointing at a real package; packages no longer listed are deactivated.
    const keptIds = [];
    for (const pkg of dj.packages) {
      const data = {
        categoryId: styleIds[pkg.genre],
        name: pkg.name,
        description: `${pkg.name} by ${dj.firstName} ${dj.lastName}.`,
        basePrice: pkg.price,
        priceUnit: pkg.pricingType === 'PER_ITEM' ? pkg.unitLabel : pkg.unit,
        pricingType: pkg.pricingType ?? 'FLAT',
        unitLabel: pkg.unitLabel ?? null,
        imageUrl: pkg.image,
        isActive: true,
      };
      const existing = await prisma.service.findFirst({ where: { providerId: provider.id, name: pkg.name } });
      const service = existing
        ? await prisma.service.update({ where: { id: existing.id }, data })
        : await prisma.service.create({ data: { ...data, providerId: provider.id } });
      keptIds.push(service.id);
    }
    await prisma.service.updateMany({
      where: { providerId: provider.id, id: { notIn: keptIds } },
      data: { isActive: false },
    });
    await prisma.providerServiceCategory.deleteMany({ where: { providerId: provider.id } });
    const genreSlugs = [...new Set(dj.packages.map((p) => p.genre))];
    for (const slug of genreSlugs) {
      const cheapest = Math.min(...dj.packages.filter((p) => p.genre === slug).map((p) => p.price));
      await prisma.providerServiceCategory.create({
        data: { providerId: provider.id, categoryId: styleIds[slug], basePrice: cheapest, yearsExperience: 3 },
      });
    }
    console.log(`✓ ${dj.login ? 'demo DJ login' : 'showcase talent'} ${dj.firstName} ${dj.lastName} <${email}>`);
  }

  console.log(`\nDemo logins (password for both: ${DEMO_PASSWORD})`);
  console.log(`  Host: ${HOST.email}`);
  console.log(`  DJ:   ${talentEmail(TALENT[0])}`);
}

(process.argv.includes('--remove') ? remove() : seed())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
