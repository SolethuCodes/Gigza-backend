/**
 * Seed the canonical service categories and retire everything else.
 *
 * Categories are only *deactivated* (isActive: false), never deleted — any
 * services already attached to a retired category keep working, the category
 * just stops appearing in the app's pickers.
 *
 * Usage:
 *   # against local
 *   node scripts/fix-categories.js
 *   # against production (careful)
 *   DATABASE_URL="postgresql://...prod..." node scripts/fix-categories.js
 *
 * Add --apply to actually write; without it, it only prints what it would do.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const CANONICAL = [
  { name: 'Cleaning', slug: 'cleaning', description: 'Home and office cleaning services', sortOrder: 1 },
  { name: 'Maintenance & Repairs', slug: 'maintenance', description: 'Plumbing, electrical, painting and general repairs', sortOrder: 2 },
  { name: 'Landscaping', slug: 'landscaping', description: 'Garden maintenance, lawn care and landscaping', sortOrder: 3 },
  { name: 'Personal Assistance', slug: 'personal-assistance', description: 'Errand running, shopping and personal tasks', sortOrder: 4 },
  { name: 'IT Services', slug: 'it-services', description: 'Tech support, setup and IT solutions', sortOrder: 5 },
  { name: 'Moving & Delivery', slug: 'moving', description: 'Furniture moving and delivery services', sortOrder: 6 },
  { name: 'Cooking & Catering', slug: 'cooking', description: 'Meal preparation and catering services', sortOrder: 7 },
  { name: 'Tutoring & Education', slug: 'tutoring', description: 'Academic tutoring and coaching', sortOrder: 8 },
  { name: 'Painting', slug: 'painting', description: 'Interior and exterior painting', sortOrder: 9 },
];

async function main() {
  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to write) ===\n');

  const canonicalSlugs = new Set(CANONICAL.map((c) => c.slug));
  const existing = await prisma.serviceCategory.findMany({
    include: { _count: { select: { services: true, providers: true } } },
    orderBy: { name: 'asc' },
  });

  console.log('Current categories:');
  for (const c of existing) {
    console.log(
      `  ${c.isActive ? '●' : '○'} ${c.name} (${c.slug})  services=${c._count.services} providers=${c._count.providers}`,
    );
  }
  console.log('');

  // 1. Upsert the canonical set.
  for (const c of CANONICAL) {
    const match = existing.find(
      (e) => e.slug === c.slug || e.name.toLowerCase() === c.name.toLowerCase(),
    );
    if (match) {
      console.log(`keep/refresh: ${c.name}`);
      if (APPLY) {
        await prisma.serviceCategory.update({
          where: { id: match.id },
          data: { name: c.name, slug: c.slug, description: c.description, sortOrder: c.sortOrder, isActive: true },
        });
      }
    } else {
      console.log(`create:       ${c.name}`);
      if (APPLY) {
        await prisma.serviceCategory.create({
          data: { name: c.name, slug: c.slug, description: c.description, sortOrder: c.sortOrder, isActive: true },
        });
      }
    }
  }

  // 2. Move services off non-canonical categories, then deactivate the category.
  const FALLBACK_SLUG = 'personal-assistance';
  const fallback = APPLY ? await prisma.serviceCategory.findUnique({ where: { slug: FALLBACK_SLUG } }) : null;

  for (const e of existing) {
    const isCanonical =
      canonicalSlugs.has(e.slug) ||
      CANONICAL.some((c) => c.name.toLowerCase() === e.name.toLowerCase());
    if (isCanonical || !e.isActive) continue;

    if (e._count.services > 0) {
      console.log(`reassign:     ${e._count.services} service(s): "${e.name}" -> "${FALLBACK_SLUG}"`);
      if (APPLY && fallback) {
        await prisma.service.updateMany({ where: { categoryId: e.id }, data: { categoryId: fallback.id } });
      }
    }
    console.log(`deactivate:   ${e.name}`);
    if (APPLY) {
      await prisma.serviceCategory.update({ where: { id: e.id }, data: { isActive: false } });
    }
  }

  console.log(APPLY ? '\nDone.' : '\nDry run complete — re-run with --apply to write.');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
