import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PortfolioService, MAX_PORTFOLIO_ITEMS } from './portfolio.service';
import type { PrismaService } from '../../prisma/prisma.service';

function createPrismaMock() {
  return {
    portfolioItem: {
      count: jest.fn(),
      create: jest.fn((args) => Promise.resolve({ id: 'item-1', ...args.data })),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
}

describe('PortfolioService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: PortfolioService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new PortfolioService(prisma as unknown as PrismaService);
  });

  it('adds new work at the end of the provider ordering', async () => {
    prisma.portfolioItem.count.mockResolvedValue(3);
    const item = await service.create('prov-1', { type: 'PHOTO', imageUrl: 'https://img/1.jpg', caption: '  Wedding  ' });
    expect(item).toMatchObject({ providerId: 'prov-1', type: 'PHOTO', sortOrder: 3, caption: 'Wedding', linkUrl: null });
  });

  it('refuses to grow a full portfolio', async () => {
    prisma.portfolioItem.count.mockResolvedValue(MAX_PORTFOLIO_ITEMS);
    await expect(service.create('prov-1', { type: 'PHOTO', imageUrl: 'https://img/1.jpg' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.portfolioItem.create).not.toHaveBeenCalled();
  });

  it("won't let one provider edit or delete another's work", async () => {
    prisma.portfolioItem.findUnique.mockResolvedValue({ id: 'item-9', providerId: 'someone-else' });
    await expect(service.update('prov-1', 'item-9', { caption: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('prov-1', 'item-9')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.portfolioItem.update).not.toHaveBeenCalled();
    expect(prisma.portfolioItem.delete).not.toHaveBeenCalled();
  });

  it('shapes feed items with a slim provider summary and filters by talent type', async () => {
    prisma.portfolioItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        type: 'PHOTO',
        imageUrl: 'https://img/1.jpg',
        provider: {
          id: 'prov-1',
          firstName: 'Ayanda',
          lastName: 'Lens',
          avatarUrl: null,
          avgRating: 4.8,
          totalRatings: 27,
          isAvailable: true,
          currentLocation: { latitude: '-29.7275', longitude: '31.0846', address: 'Umhlanga' },
          serviceCategories: [
            { category: { name: 'Wedding Photography', slug: 'wedding-photography', talentType: 'PHOTOGRAPHER' } },
            { category: { name: 'Event Photography', slug: 'event-photography', talentType: 'PHOTOGRAPHER' } },
          ],
        },
      },
    ]);

    const [item] = await service.feed({ talentType: 'photographer', limit: 500 });

    const query = prisma.portfolioItem.findMany.mock.calls[0][0];
    expect(query.take).toBe(120);
    expect(query.where.provider).toMatchObject({
      kycStatus: 'APPROVED',
      serviceCategories: { some: { category: { talentType: 'PHOTOGRAPHER' } } },
    });
    expect(item.provider).toMatchObject({
      id: 'prov-1',
      latitude: -29.7275,
      longitude: 31.0846,
      address: 'Umhlanga',
      talentTypes: ['PHOTOGRAPHER'],
    });
    expect(item.provider).not.toHaveProperty('serviceCategories');
  });
});
