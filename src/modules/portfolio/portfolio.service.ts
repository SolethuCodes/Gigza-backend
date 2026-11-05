import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePortfolioItemDto, UpdatePortfolioItemDto } from './dto/portfolio-item.dto';

/** Keeps portfolios focused and the feed fast. */
export const MAX_PORTFOLIO_ITEMS = 30;
const FEED_DEFAULT_LIMIT = 60;
const FEED_MAX_LIMIT = 120;

/** Only talent a host could actually book shows up in the feed. */
const BOOKABLE_PROVIDER: Prisma.ProviderWhereInput = {
  isActive: true,
  isBanned: false,
  deletedAt: null,
  kycStatus: 'APPROVED',
};

const FEED_PROVIDER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  avgRating: true,
  totalRatings: true,
  isAvailable: true,
  currentLocation: { select: { latitude: true, longitude: true, address: true } },
  serviceCategories: { select: { category: { select: { name: true, slug: true, talentType: true } } } },
} satisfies Prisma.ProviderSelect;

type FeedProvider = Prisma.ProviderGetPayload<{ select: typeof FEED_PROVIDER_SELECT }>;

@Injectable()
export class PortfolioService {
  constructor(private readonly prisma: PrismaService) {}

  /** One talent's portfolio, in their chosen order. */
  listForProvider(providerId: string) {
    return this.prisma.portfolioItem.findMany({
      where: { providerId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Recent work from bookable talent, newest first, optionally limited to one
   * kind of talent. Each item carries a slim provider summary (with location)
   * so the app can sort by distance and open the profile.
   */
  async feed(options: { talentType?: string; limit?: number }) {
    const limit = Math.min(Math.max(Number(options.limit) || FEED_DEFAULT_LIMIT, 1), FEED_MAX_LIMIT);
    const talentType = options.talentType?.trim().toUpperCase() || undefined;

    const items = await this.prisma.portfolioItem.findMany({
      where: {
        provider: {
          ...BOOKABLE_PROVIDER,
          ...(talentType ? { serviceCategories: { some: { category: { talentType } } } } : {}),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { provider: { select: FEED_PROVIDER_SELECT } },
    });

    return items.map(({ provider, ...item }) => ({ ...item, provider: this.toSummary(provider) }));
  }

  async create(providerId: string, dto: CreatePortfolioItemDto) {
    const count = await this.prisma.portfolioItem.count({ where: { providerId } });
    if (count >= MAX_PORTFOLIO_ITEMS) {
      throw new BadRequestException(`Your portfolio is full (${MAX_PORTFOLIO_ITEMS} items). Remove one to add another.`);
    }
    return this.prisma.portfolioItem.create({
      data: {
        providerId,
        type: dto.type,
        imageUrl: dto.imageUrl ?? null,
        linkUrl: dto.type === 'LINK' ? dto.linkUrl : null,
        caption: dto.caption?.trim() || null,
        // New work goes to the end of the provider's own ordering.
        sortOrder: count,
      },
    });
  }

  async update(providerId: string, id: string, dto: UpdatePortfolioItemDto) {
    await this.findOwned(providerId, id);
    return this.prisma.portfolioItem.update({
      where: { id },
      data: {
        ...(dto.caption !== undefined ? { caption: dto.caption.trim() || null } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  async remove(providerId: string, id: string) {
    await this.findOwned(providerId, id);
    await this.prisma.portfolioItem.delete({ where: { id } });
    return { deleted: true };
  }

  private async findOwned(providerId: string, id: string) {
    const item = await this.prisma.portfolioItem.findUnique({ where: { id } });
    if (!item || item.providerId !== providerId) throw new NotFoundException('Portfolio item not found');
    return item;
  }

  private toSummary(provider: FeedProvider) {
    const { serviceCategories, currentLocation, ...rest } = provider;
    const styles = serviceCategories.map((link) => link.category);
    return {
      ...rest,
      latitude: currentLocation ? Number(currentLocation.latitude) : null,
      longitude: currentLocation ? Number(currentLocation.longitude) : null,
      address: currentLocation?.address ?? null,
      talentTypes: [...new Set(styles.map((s) => s.talentType))],
      styles: styles.map(({ name, slug }) => ({ name, slug })),
    };
  }
}
