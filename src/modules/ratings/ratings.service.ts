import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { PublicRatingDto, toPublicRatingDto } from './rating-display';

@Injectable()
export class RatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(fromId: string, data: CreateRatingDto) {
    if (!data?.bookingId || !data?.score) {
      throw new BadRequestException('bookingId and score are required');
    }

    if (!Number.isInteger(data.score) || data.score < 1 || data.score > 5) {
      throw new BadRequestException('score must be an integer between 1 and 5');
    }

    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: data.bookingId } });
    if (booking.userId !== fromId && booking.providerId !== fromId) throw new ForbiddenException();
    if (booking.status !== 'COMPLETED' && booking.status !== 'PAID') {
      throw new BadRequestException('A booking must be completed before it can be rated');
    }

    const ratingFrom = booking.userId === fromId ? 'USER_TO_PROVIDER' : 'PROVIDER_TO_USER';
    const existingRating = await this.prisma.rating.findFirst({ where: { bookingId: data.bookingId, ratingFrom } });
    if (existingRating) {
      throw new BadRequestException('A rating for this booking already exists');
    }

    const rating = await this.prisma.rating.create({
      data:
        ratingFrom === 'USER_TO_PROVIDER'
          ? {
              bookingId: data.bookingId,
              serviceId: booking.serviceId,
              score: data.score,
              comment: data.comment,
              photoUrls: data.photoUrls ?? [],
              fromUserId: fromId,
              toProviderId: booking.providerId,
              ratingFrom,
            }
          : {
              bookingId: data.bookingId,
              serviceId: booking.serviceId,
              score: data.score,
              comment: data.comment,
              photoUrls: data.photoUrls ?? [],
              fromProviderId: fromId,
              toUserId: booking.userId,
              ratingFrom,
            },
    });

    if (ratingFrom === 'USER_TO_PROVIDER') {
      const agg = await this.prisma.rating.aggregate({
        where: { toProviderId: booking.providerId, ratingFrom: 'USER_TO_PROVIDER' },
        _avg: { score: true },
        _count: { score: true },
      });
      await this.prisma.provider.update({
        where: { id: booking.providerId },
        data: { avgRating: agg._avg.score ?? 0, totalRatings: agg._count.score },
      });
    } else {
      const agg = await this.prisma.rating.aggregate({
        where: { toUserId: booking.userId, ratingFrom: 'PROVIDER_TO_USER' },
        _avg: { score: true },
        _count: { score: true },
      });
      await this.prisma.user.update({
        where: { id: booking.userId },
        data: { avgRating: agg._avg.score ?? 0, totalRatings: agg._count.score },
      });
    }

    const scoreLabel = `${data.score}/5`;
    if (ratingFrom === 'USER_TO_PROVIDER') {
      void this.notifications
        .send(booking.providerId, 'REVIEW_RECEIVED', 'New review', `A customer rated you ${scoreLabel}.`, { bookingId: data.bookingId, type: 'review' }, 'provider')
        .catch(() => undefined);
    } else {
      void this.notifications
        .send(booking.userId, 'REVIEW_RECEIVED', 'New review', `Your provider rated you ${scoreLabel}.`, { bookingId: data.bookingId, type: 'review' }, 'user')
        .catch(() => undefined);
    }

    return rating;
  }

  async getForProvider(providerId: string): Promise<PublicRatingDto[]> {
    const ratings = await this.prisma.rating.findMany({
      where: { toProviderId: providerId, ratingFrom: 'USER_TO_PROVIDER', isVisible: true },
      include: { fromUser: { select: { firstName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.toPublicList(ratings, (row) => row.fromUser?.firstName);
  }

  async getForService(serviceId: string): Promise<PublicRatingDto[]> {
    const ratings = await this.prisma.rating.findMany({
      where: { serviceId, ratingFrom: 'USER_TO_PROVIDER', isVisible: true },
      include: { fromUser: { select: { firstName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.toPublicList(ratings, (row) => row.fromUser?.firstName);
  }

  async getForCustomer(userId: string): Promise<PublicRatingDto[]> {
    const ratings = await this.prisma.rating.findMany({
      where: { toUserId: userId, ratingFrom: 'PROVIDER_TO_USER', isVisible: true },
      include: { fromProvider: { select: { firstName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.toPublicList(ratings, (row) => row.fromProvider?.firstName);
  }

  private async toPublicList(
    ratings: Array<{
      id: string;
      score: number;
      comment: string | null;
      createdAt: Date;
      serviceId: string | null;
      fromUser?: { firstName: string } | null;
      fromProvider?: { firstName: string } | null;
    }>,
    reviewerName: (row: { fromUser?: { firstName: string } | null; fromProvider?: { firstName: string } | null }) => string | null | undefined,
  ): Promise<PublicRatingDto[]> {
    const serviceNames = await this.loadServiceNames(ratings.map((row) => row.serviceId));
    return ratings.map((row) =>
      toPublicRatingDto({
        id: row.id,
        score: row.score,
        comment: row.comment,
        createdAt: row.createdAt,
        serviceId: row.serviceId,
        serviceName: row.serviceId ? serviceNames.get(row.serviceId) ?? null : null,
        reviewerFirstName: reviewerName(row),
      }),
    );
  }

  private async loadServiceNames(serviceIds: Array<string | null>): Promise<Map<string, string>> {
    const ids = [...new Set(serviceIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const services = await this.prisma.service.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(services.map((service) => [service.id, service.name]));
  }
}
