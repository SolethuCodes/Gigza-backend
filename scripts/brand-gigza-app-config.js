/**
 * Rebrands the remote app config row (left over from the E-RRANDS fork) to Gigza.
 * The mobile app applies colorPrimary/colorAccent/colorTeal over its theme and
 * shows these taglines/slides/FAQs, so stale values leak Errands navy + gold.
 *
 * Saves a snapshot of the current row first (restorable from the admin panel).
 *
 *   node -r dotenv/config scripts/brand-gigza-app-config.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const GIGZA = {
  platformName: 'GIGZA',
  taglineUser: 'Any Vibe, Any Night',
  taglineProvider: 'Get booked. Grow your fanbase.',
  splashTagline: 'DJ Booking Platform',
  poweredBy: '',
  // White app with black as the primary colour, pink + purple as brand accents.
  colorPrimary: '#0A0A0A',
  colorAccent: '#FF2D95',
  colorTeal: '#8B5CF6',
  supportEmail: 'support@gigza.co.za',
  maintenanceMessage: 'GIGZA is temporarily unavailable while we finish a platform update. Please try again shortly.',
  websiteHeadline: 'Book your DJ, in minutes.',
  websiteSubheadline: 'Verified DJs for weddings, parties and events — paid securely in South Africa.',
  websiteFooter: '© GIGZA.',
  onboardingSlides: [
    {
      key: 'discover',
      kicker: 'Discover',
      title: 'Find the right DJ, fast',
      body: 'Book verified DJs for weddings, parties, and club nights — all in one app.',
    },
    {
      key: 'verified',
      kicker: 'Verified',
      title: 'Every DJ is vetted',
      body: 'ID checks and admin approval keep DJs accountable before they accept a gig.',
    },
    {
      key: 'secure',
      kicker: 'Secure',
      title: 'Pay safely, track live',
      body: 'Digital payments in ZAR with real-time updates from booking to gig day.',
    },
  ],
  faqs: [
    {
      question: 'How do I book a DJ?',
      answer:
        'Browse Discover or Home, pick a DJ or package, choose your event date and time, and confirm your booking details. You’ll get a confirmation once the DJ accepts.',
    },
    {
      question: 'How and when do I pay?',
      answer:
        'Payments are securely processed through PayFast. Depending on the package, you can pay upfront or once the gig is completed — your payment is always held securely until the gig is done.',
    },
    {
      question: 'Can I cancel or reschedule a booking?',
      answer:
        'Yes. Open the booking from My Bookings and choose to cancel or message the DJ to reschedule, up until the gig has started.',
    },
    {
      question: 'How are DJs verified?',
      answer:
        'Every DJ on GIGZA completes DJ Verification (ID checks) before they can accept bookings, so you always know who’s playing your event.',
    },
  ],
};

/** Swap the old brand name inside legal docs without rewriting the content. */
function rebrandDoc(doc) {
  if (!doc) return doc;
  return JSON.parse(JSON.stringify(doc).replace(/E-RRANDS/g, 'GIGZA'));
}

(async () => {
  const row = await prisma.appConfig.findUnique({ where: { id: 'singleton' } });
  if (!row) {
    console.log('No app config row yet — the backend creates it on first request. Nothing to do.');
    return;
  }

  await prisma.appConfigSnapshot.create({
    data: {
      version: row.version,
      label: 'Before Gigza rebrand',
      reason: 'Automatic backup from scripts/brand-gigza-app-config.js',
      payload: JSON.parse(JSON.stringify(row)),
    },
  });

  await prisma.appConfig.update({
    where: { id: 'singleton' },
    data: {
      ...GIGZA,
      version: { increment: 1 },
      legalTerms: rebrandDoc(row.legalTerms),
      legalPrivacy: rebrandDoc(row.legalPrivacy),
      publishedAt: new Date(),
    },
  });

  console.log(`✓ App config rebranded (was "${row.platformName}", accent ${row.colorAccent}). Snapshot saved.`);
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
