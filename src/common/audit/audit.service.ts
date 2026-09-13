import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type AuditActorType = 'user' | 'provider' | 'admin';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    actorId: string;
    actorType: AuditActorType;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const { actorId, actorType, action, entityType, entityId, metadata } = params;
    const adminMetadata: Prisma.InputJsonValue | undefined = actorType === 'admin'
      ? {
          actorId,
          actorType,
          ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? metadata as Prisma.JsonObject
            : metadata !== undefined
              ? { payload: metadata }
              : {}),
        }
      : metadata;

    await this.prisma.activityLog.create({
      data: {
        userId: actorType === 'user' ? actorId : undefined,
        providerId: actorType === 'provider' ? actorId : undefined,
        adminId: actorType === 'admin' ? actorId : undefined,
        action,
        entityType,
        entityId,
        metadata: adminMetadata,
      },
    });
  }
}
