import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { ServiceRequestsService } from './service-requests.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';

describe('ServiceRequestsService', () => {
  let service: ServiceRequestsService;

  const prismaMock: any = {
    serviceRequest: {
      findUnique: jest.fn(),
    },
    provider: {
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    service = new ServiceRequestsService(prismaMock as unknown as PrismaService, {
      initiateMatching: jest.fn(),
    } as unknown as MatchingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a non-owner who tries to view matches for someone else\'s service request', async () => {
    prismaMock.serviceRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      userId: 'owner-1',
      categoryId: 'cat-1',
      latitude: -33.9,
      longitude: 18.4,
      category: { name: 'Cleaning' },
    });

    await expect(service.findMatches('req-1', 'other-user')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.provider.findMany).not.toHaveBeenCalled();
  });
});
