import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DiditService } from '../didit/didit.service';
import { AddProviderCategoryDto } from './dto/add-provider-category.dto';
import { UpdateCurrentLocationDto } from './dto/update-current-location.dto';

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly didit: DiditService,
  ) {}

  async getProfile(providerId: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      include: {
        serviceCategories: { include: { category: true } },
        wallet: true,
        currentLocation: true,
        _count: { select: { bookingsAsProvider: { where: { status: 'COMPLETED' } } } },
      },
    });
    if (!provider) return null;

    const { _count, ...rest } = provider;
    return { ...rest, completedJobsCount: _count.bookingsAsProvider };
  }

  async updateProfile(providerId: string, data: { firstName?: string; lastName?: string; avatarUrl?: string; bio?: string; isAvailable?: boolean; serviceRadius?: number }) {
    if (data.isAvailable === true) {
      const provider = await this.prisma.provider.findUnique({
        where: { id: providerId },
        select: { kycStatus: true },
      });
      if (provider?.kycStatus !== 'APPROVED') {
        throw new BadRequestException('Complete identity verification before going live.');
      }
    }
    return this.prisma.provider.update({ where: { id: providerId }, data });
  }

  async updateCurrentLocation(providerId: string, data: UpdateCurrentLocationDto) {
    return this.prisma.providerCurrentLocation.upsert({
      where: { providerId },
      update: {
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy: data.accuracy ?? undefined,
        address: data.address ?? undefined,
      },
      create: {
        providerId,
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy: data.accuracy ?? undefined,
        address: data.address ?? undefined,
      },
    });
  }

  async addCategory(providerId: string, data: AddProviderCategoryDto, actorId?: string) {
    if (providerId !== actorId) {
      throw new BadRequestException('You can only manage your own categories');
    }

    const category = await this.prisma.serviceCategory.findUnique({ where: { id: data.categoryId } });
    if (!category) {
      throw new BadRequestException(`Service category not found: ${data.categoryId}`);
    }

    return this.prisma.providerServiceCategory.create({
      data: {
        providerId,
        categoryId: data.categoryId,
        basePrice: data.basePrice,
        priceUnit: data.priceUnit,
        yearsExperience: data.yearsExperience,
      },
      include: { category: true },
    });
  }

  async findAll(search?: string) {
    const providers = await this.prisma.provider.findMany({
      where: {
        isActive: true,
        isAvailable: true,
        isBanned: false,
        kycStatus: 'APPROVED',
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        avgRating: true,
        totalRatings: true,
        isAvailable: true,
        serviceCategories: {
          select: {
            category: { select: { id: true, name: true, slug: true, iconUrl: true } },
          },
        },
        currentLocation: { select: { latitude: true, longitude: true, address: true } },
      },
    });

    return providers.map((provider) => ({
      id: provider.id,
      firstName: provider.firstName,
      lastName: provider.lastName,
      avatarUrl: provider.avatarUrl,
      avgRating: Number(provider.avgRating),
      totalRatings: provider.totalRatings,
      isAvailable: provider.isAvailable,
      servicesCount: provider.serviceCategories.length,
      latitude: provider.currentLocation ? Number(provider.currentLocation.latitude) : null,
      longitude: provider.currentLocation ? Number(provider.currentLocation.longitude) : null,
      address: provider.currentLocation?.address ?? null,
    }));
  }

  async search(query: string) {
    const [providers, serviceCategories] = await Promise.all([
      this.findAll(query),
      this.prisma.providerServiceCategory.findMany({
        where: {
          category: { name: { contains: query, mode: 'insensitive' } },
          provider: { isActive: true },
        },
        include: {
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatarUrl: true,
              avgRating: true,
              totalRatings: true,
              isAvailable: true,
            },
          },
          category: {
            select: { id: true, name: true, slug: true, iconUrl: true, description: true },
          },
        },
        take: 20,
      }),
    ]);

    return {
      providers,
      services: serviceCategories.map((item) => ({
        id: item.id,
        title: item.category.name,
        description: item.category.description,
        price: item.basePrice !== null ? Number(item.basePrice) : null,
        priceUnit: item.priceUnit,
        imageUrl: item.category.iconUrl,
        isAvailable: item.provider.isAvailable,
        provider: {
          id: item.provider.id,
          firstName: item.provider.firstName,
          lastName: item.provider.lastName,
          avatarUrl: item.provider.avatarUrl,
          avgRating: Number(item.provider.avgRating),
          totalRatings: item.provider.totalRatings,
          isAvailable: item.provider.isAvailable,
        },
        category: {
          id: item.category.id,
          name: item.category.name,
          slug: item.category.slug,
          iconUrl: item.category.iconUrl,
        },
      })),
    };
  }

  /**
   * Creates a Didit verification session for the mobile app to launch the KYC
   * flow. Document capture and liveness happen entirely on-device in Didit's
   * native SDK; kycStatus flips from PENDING to UNDER_REVIEW here
   * optimistically and is finalized later by DiditWebhookController when
   * Didit reviews the submission (there's no separate "submit" call — the
   * applicant uploads straight to Didit through the SDK).
   */
  async getKycAccessToken(providerId: string) {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw new NotFoundException('Provider not found');
    if (provider.kycStatus === 'APPROVED') {
      throw new ConflictException('This account is already KYC-verified');
    }

    const session = await this.didit.createSession({ providerId: provider.id });

    if (provider.kycStatus === 'PENDING' || provider.kycStatus === 'REJECTED') {
      await this.prisma.provider.update({
        where: { id: providerId },
        data: { kycStatus: 'UNDER_REVIEW', kycConsentAt: new Date(), diditSessionId: session.sessionId },
      });
    }

    return { sessionId: session.sessionId, sessionToken: session.sessionToken, url: session.url, userId: provider.id };
  }

  async findAvailableProviders(categoryId: string, latitude?: number, longitude?: number) {
    return this.prisma.provider.findMany({
      where: { kycStatus: 'APPROVED', isAvailable: true, isActive: true, isBanned: false, serviceCategories: { some: { categoryId } } },
      select: {
        id: true, firstName: true, lastName: true, avatarUrl: true, avgRating: true, totalRatings: true,
        serviceCategories: { where: { categoryId }, include: { category: true } },
        currentLocation: true,
      },
      orderBy: { avgRating: 'desc' },
    });
  }
}
