import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { CategoriesService } from '../categories/categories.service';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import * as path from 'path';

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  async findAll(providerId?: string, categoryId?: string, includeInactive = false) {
    return this.prisma.service.findMany({
      where: {
        ...(providerId ? { providerId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(includeInactive
          ? {}
          : {
              isActive: true,
              category: { isActive: true, status: 'APPROVED' },
              provider: {
                isActive: true,
                isAvailable: true,
                isBanned: false,
                kycStatus: 'APPROVED',
              },
            }),
      },
      include: {
        category: true,
        provider: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            isAvailable: true,
            avgRating: true,
            totalRatings: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.service.findUnique({
      where: { id },
      include: {
        category: true,
        provider: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            isAvailable: true,
            avgRating: true,
            totalRatings: true,
          },
        },
      },
    });
  }

  async createForProvider(providerId: string, data: CreateServiceDto, actorId?: string) {
    if (providerId !== actorId) {
      throw new ForbiddenException('You can only manage your own services');
    }

    if (!data.categoryId && !data.categoryName) {
      throw new BadRequestException('Either categoryId or categoryName is required');
    }

    // Providers pick from the approved list, or propose a new category by name.
    // A proposed category is created PENDING and the listing stays hidden until
    // an admin approves it (see ServicesService.findAll -> category.isActive).
    const { categoryId } = await this.categories.resolveForProvider(providerId, {
      categoryId: data.categoryId,
      categoryName: data.categoryName,
      categoryDescription: data.categoryDescription,
    });

    await this.prisma.providerServiceCategory.upsert({
      where: { providerId_categoryId: { providerId, categoryId } },
      update: {},
      create: { providerId, categoryId },
    });

    return this.prisma.service.create({
      data: {
        providerId,
        categoryId,
        name: data.name,
        description: data.description,
        basePrice: data.basePrice ? new Prisma.Decimal(data.basePrice) : null,
        priceUnit: data.priceUnit,
        pricingType: data.pricingType ?? 'FLAT',
        unitLabel: data.pricingType === 'PER_ITEM' ? (data.unitLabel?.trim() || null) : null,
        isActive: data.isActive ?? true,
        imageUrl: data.imageUrl,
      },
      include: { category: true, provider: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, isAvailable: true } } },
    });
  }

  async updateForProvider(providerId: string, id: string, data: UpdateServiceDto, actorId?: string) {
    if (providerId !== actorId) {
      throw new ForbiddenException('You can only manage your own services');
    }

    const existing = await this.prisma.service.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Service not found');
    }
    if (existing.providerId !== providerId) {
      throw new ForbiddenException('You can only update your own services');
    }

    let categoryId: string | undefined;
    if (data.categoryId || data.categoryName) {
      const resolved = await this.categories.resolveForProvider(providerId, {
        categoryId: data.categoryId,
        categoryName: data.categoryName,
        categoryDescription: data.categoryDescription,
      });
      categoryId = resolved.categoryId;

      await this.prisma.providerServiceCategory.upsert({
        where: { providerId_categoryId: { providerId, categoryId } },
        update: {},
        create: { providerId, categoryId },
      });
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.basePrice !== undefined) updatePayload.basePrice = data.basePrice ? new Prisma.Decimal(data.basePrice) : null;
    if (data.priceUnit !== undefined) updatePayload.priceUnit = data.priceUnit;
    if (data.pricingType !== undefined) {
      updatePayload.pricingType = data.pricingType;
      updatePayload.unitLabel = data.pricingType === 'PER_ITEM' ? (data.unitLabel?.trim() || null) : null;
    } else if (data.unitLabel !== undefined) {
      updatePayload.unitLabel = data.unitLabel?.trim() || null;
    }
    if (data.imageUrl !== undefined) updatePayload.imageUrl = data.imageUrl;
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;
    if (categoryId) updatePayload.categoryId = categoryId;

    return this.prisma.service.update({
      where: { id },
      data: updatePayload,
      include: { category: true, provider: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, isAvailable: true } } },
    });
  }

  async deleteForProvider(providerId: string, id: string, actorId?: string) {
    if (providerId !== actorId) {
      throw new ForbiddenException('You can only manage your own services');
    }

    const existing = await this.prisma.service.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Service not found');
    }
    if (existing.providerId !== providerId) {
      throw new ForbiddenException('You can only delete your own services');
    }

    return this.prisma.service.delete({ where: { id } });
  }

  async uploadImage(providerId: string, id: string, file: Express.Multer.File | undefined, actorId?: string) {
    if (providerId !== actorId) {
      throw new ForbiddenException('You can only manage your own services');
    }
    if (!file) {
      throw new BadRequestException('An image file is required');
    }

    const existing = await this.prisma.service.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Service not found');
    }
    if (existing.providerId !== providerId) {
      throw new ForbiddenException('You can only upload images for your own services');
    }

    const extension = path.extname(file.originalname || '').toLowerCase();
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!allowedExtensions.includes(extension)) {
      throw new BadRequestException('Only JPG, PNG, and WebP images are allowed');
    }

    const uploadDir = path.resolve(process.cwd(), 'uploads', 'services');
    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true });
    }

    const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${extension}`;
    const filePath = path.join(uploadDir, filename);
    writeFileSync(filePath, file.buffer);

    const imageUrl = `/uploads/services/${filename}`;

    return this.prisma.service.update({
      where: { id },
      data: { imageUrl },
      include: { category: true, provider: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, isAvailable: true } } },
    });
  }
}
