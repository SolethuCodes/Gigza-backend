/**
 * TEMPORARY — delete this file after the first Super Admin is in Azure Postgres.
 * Also remove the import from auth.module.ts.
 */
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ALL_PERMISSIONS } from '../admin/permissions.catalog';

class TempFirstAdminDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  firstName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  lastName: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\+?[0-9]{8,15}$/, { message: 'Enter a valid phone number' })
  phone: string;
}

@ApiTags('TEMP first admin — delete after use')
@Controller({ path: 'auth/temp', version: '1' })
export class TempFirstAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('first-admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'TEMPORARY: create the first Super Admin, then delete this controller' })
  async create(@Body() dto: TempFirstAdminDto) {
    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone.trim();
    const rounds = this.config.get<number>('auth.bcryptRounds', 12);
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    try {
      await this.prisma.$transaction(async (tx) => {
        const count = await tx.admin.count();
        if (count > 0) {
          throw new ForbiddenException('An administrator already exists. Delete this temp endpoint.');
        }

        const role =
          (await tx.adminRole.findUnique({ where: { slug: 'super-admin' } })) ??
          (await tx.adminRole.create({
            data: {
              name: 'Super Admin',
              slug: 'super-admin',
              description: 'Full control of the administrator console',
              permissions: [...ALL_PERMISSIONS],
              isSystem: true,
            },
          }));

        await tx.admin.create({
          data: {
            email,
            phone,
            passwordHash,
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            role: 'ADMIN',
            roleId: role.id,
            inviteStatus: 'ACTIVE',
            mustChangePassword: false,
            isEmailVerified: true,
            isPhoneVerified: true,
            isActive: true,
          },
        });
      });
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email or phone already in use');
      }
      throw error;
    }

    return { created: true, email };
  }
}
