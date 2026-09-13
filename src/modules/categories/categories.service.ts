import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { SuggestCategoryDto } from './dto/suggest-category.dto';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Public list — only approved, active categories. */
  findAll() {
    return this.prisma.serviceCategory.findMany({
      where: { isActive: true, status: 'APPROVED' },
      orderBy: { sortOrder: 'asc' },
    });
  }

  findOne(id: string) {
    return this.prisma.serviceCategory.findUniqueOrThrow({ where: { id } });
  }

  /** Admin — create a category directly (already approved). */
  create(data: CreateCategoryDto) {
    return this.prisma.serviceCategory.create({
      data: {
        ...data,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
        status: 'APPROVED',
      },
    });
  }

  /** Admin — categories waiting for review. */
  listPending() {
    return this.prisma.serviceCategory.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: {
        suggestedByProvider: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { services: true } },
      },
    });
  }

  /** Provider — propose a new category. Hidden until an admin approves it. */
  async suggest(providerId: string, dto: SuggestCategoryDto) {
    const name = dto.name.trim();
    if (name.length < 2) {
      throw new BadRequestException('Category name is too short');
    }
    const existing = await this.prisma.serviceCategory.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      // Already known — surface it rather than creating a duplicate.
      return existing;
    }
    return this.prisma.serviceCategory.create({
      data: {
        name,
        slug: await this.uniqueSlug(slugify(name)),
        description: dto.description?.trim() || `${name} services`,
        isActive: false,
        status: 'PENDING',
        sortOrder: 0,
        suggestedByProviderId: providerId,
      },
    });
  }

  async approve(id: string) {
    const category = await this.prisma.serviceCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    const updated = await this.prisma.serviceCategory.update({
      where: { id },
      data: { status: 'APPROVED', isActive: true },
    });
    if (category.suggestedByProviderId) {
      await this.notifications.send(
        category.suggestedByProviderId,
        'SYSTEM_ALERT',
        'Category approved',
        `"${updated.name}" is now live. Your listing using it is visible to customers.`,
        { type: 'category', categoryId: updated.id },
        'provider',
      );
    }
    return updated;
  }

  async reject(id: string) {
    const category = await this.prisma.serviceCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    const updated = await this.prisma.serviceCategory.update({
      where: { id },
      data: { status: 'REJECTED', isActive: false },
    });
    if (category.suggestedByProviderId) {
      await this.notifications.send(
        category.suggestedByProviderId,
        'SYSTEM_ALERT',
        'Category not approved',
        `"${category.name}" wasn't added. Pick the closest match from the existing list for your listing.`,
        { type: 'category', categoryId: category.id },
        'provider',
      );
    }
    return updated;
  }

  /**
   * Resolve a provider-supplied category by name for a service listing.
   * Matches an approved category, or (re)creates a PENDING suggestion so the
   * listing can be saved and shown once an admin approves the new category.
   * Returns the category id and whether it is still awaiting review.
   */
  async resolveForProvider(
    providerId: string,
    input: { categoryId?: string; categoryName?: string; categoryDescription?: string },
  ): Promise<{ categoryId: string; pending: boolean }> {
    if (input.categoryId) {
      const category = await this.prisma.serviceCategory.findUnique({ where: { id: input.categoryId } });
      if (!category) throw new BadRequestException(`Invalid categoryId: ${input.categoryId}`);
      return { categoryId: category.id, pending: category.status !== 'APPROVED' };
    }

    const name = (input.categoryName ?? '').trim();
    if (!name) throw new BadRequestException('Either categoryId or categoryName is required');

    const approved = await this.prisma.serviceCategory.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, status: 'APPROVED', isActive: true },
    });
    if (approved) return { categoryId: approved.id, pending: false };

    const anyExisting = await this.prisma.serviceCategory.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (anyExisting) return { categoryId: anyExisting.id, pending: anyExisting.status !== 'APPROVED' };

    const created = await this.prisma.serviceCategory.create({
      data: {
        name,
        slug: await this.uniqueSlug(slugify(name)),
        description: input.categoryDescription?.trim() || `${name} services`,
        isActive: false,
        status: 'PENDING',
        sortOrder: 0,
        suggestedByProviderId: providerId,
      },
    });
    return { categoryId: created.id, pending: true };
  }

  private async uniqueSlug(base: string): Promise<string> {
    const root = base || `category-${Date.now()}`;
    let slug = root;
    let n = 2;
    // eslint-disable-next-line no-await-in-loop
    while (await this.prisma.serviceCategory.findUnique({ where: { slug } })) {
      slug = `${root}-${n}`;
      n += 1;
    }
    return slug;
  }
}
