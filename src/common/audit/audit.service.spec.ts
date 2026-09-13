/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;

  const prismaMock = {
    activityLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('stores admin actor details in metadata without setting user or provider foreign keys', async () => {
    await service.log({
      actorId: 'admin-1',
      actorType: 'admin',
      action: 'SETTINGS_UPDATED',
      entityType: 'AdminSettings',
      entityId: 'singleton',
      metadata: { section: 'commission' },
    });

    expect(prismaMock.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: undefined,
        providerId: undefined,
        action: 'SETTINGS_UPDATED',
        entityType: 'AdminSettings',
        entityId: 'singleton',
        metadata: {
          actorId: 'admin-1',
          actorType: 'admin',
          section: 'commission',
        },
      },
    });
  });
});