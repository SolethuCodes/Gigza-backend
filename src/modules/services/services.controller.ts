import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServicesService } from './services.service';

@ApiTags('services')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: '', version: '1' })
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get('services')
  @ApiOperation({ summary: 'List services' })
  @ApiQuery({ name: 'providerId', required: false, type: String, description: 'Optional provider filter. Providers can omit this to list their own services.' })
  @ApiQuery({ name: 'categoryId', required: false, type: String, description: 'Optional category filter. Omit this to get all services.' })
  findAll(@CurrentUser() user: AuthenticatedUser | undefined, @Query('providerId') providerId?: string, @Query('categoryId') categoryId?: string) {
    const effectiveProviderId = providerId ?? (user?.type === 'provider' ? user.id : undefined);
    const isOwnServices = user?.type === 'provider' && effectiveProviderId === user.id;
    return this.services.findAll(effectiveProviderId, categoryId, isOwnServices);
  }

  @Public()
  @Get('services/:id')
  @ApiOperation({ summary: 'Get service details' })
  async findOne(@Param('id') id: string) {
    const service = await this.services.findOne(id);
    if (!service) {
      throw new NotFoundException(`Service ${id} not found`);
    }
    return service;
  }

  @Post('providers/:providerId/services')
  @Roles('PROVIDER')
  @ApiOperation({ summary: 'Create a service as a provider' })
  @ApiBody({ type: CreateServiceDto })
  createForProvider(@CurrentUser() user: AuthenticatedUser, @Param('providerId') providerId: string, @Body() body: CreateServiceDto) {
    return this.services.createForProvider(providerId, body, user.id);
  }

  @Patch('providers/:providerId/services/:id')
  @Roles('PROVIDER')
  @ApiOperation({ summary: 'Update a provider service' })
  updateForProvider(@CurrentUser() user: AuthenticatedUser, @Param('providerId') providerId: string, @Param('id') id: string, @Body() body: UpdateServiceDto) {
    return this.services.updateForProvider(providerId, id, body, user.id);
  }

  @Delete('providers/:providerId/services/:id')
  @Roles('PROVIDER')
  @ApiOperation({ summary: 'Delete a provider service' })
  deleteForProvider(@CurrentUser() user: AuthenticatedUser, @Param('providerId') providerId: string, @Param('id') id: string) {
    return this.services.deleteForProvider(providerId, id, user.id);
  }

  @Post('providers/:providerId/services/:id/image')
  @Roles('PROVIDER')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(null, false);
  } }))
  @ApiOperation({ summary: 'Upload an image for a provider service' })
  uploadImage(@CurrentUser() user: AuthenticatedUser, @Param('providerId') providerId: string, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.services.uploadImage(providerId, id, file, user.id);
  }
}
