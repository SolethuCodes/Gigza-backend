import { Controller, Get, Patch, Body, UseGuards, Param, Post, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody, ApiQuery } from '@nestjs/swagger';
import { ProvidersService } from './providers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Public } from '../../common/decorators/public.decorator';
import { AddProviderCategoryDto } from './dto/add-provider-category.dto';
import { UpdateCurrentLocationDto } from './dto/update-current-location.dto';

@ApiTags('providers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'providers', version: '1' })
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get('me')
  @Roles('PROVIDER')
  @ApiOperation({ summary: 'Get current provider profile' })
  getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.providers.getProfile(user.id);
  }

  @Patch('me')
  @Roles('PROVIDER')
  @ApiOperation({ summary: 'Update provider profile' })
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { firstName?: string; lastName?: string; avatarUrl?: string; bio?: string; isAvailable?: boolean; serviceRadius?: number },
  ) {
    return this.providers.updateProfile(user.id, body);
  }

  @Patch('me/availability')
  @Roles('PROVIDER')
  @ApiOperation({ summary: 'Update provider availability visibility' })
  @ApiBody({ schema: { type: 'object', properties: { isAvailable: { type: 'boolean' } }, required: ['isAvailable'] } })
  updateAvailability(@CurrentUser() user: AuthenticatedUser, @Body() body: { isAvailable: boolean }) {
    return this.providers.updateProfile(user.id, { isAvailable: body.isAvailable });
  }

  @Patch('me/location')
  @Roles('PROVIDER')
  @ApiOperation({ summary: 'Update current provider location' })
  @ApiBody({ type: UpdateCurrentLocationDto })
  updateCurrentLocation(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateCurrentLocationDto) {
    return this.providers.updateCurrentLocation(user.id, body);
  }

  @Post('me/categories')
  @Roles('PROVIDER')
  @ApiOperation({ summary: 'Add a service category to provider profile' })
  @ApiBody({ type: AddProviderCategoryDto })
  addCategory(@CurrentUser() user: AuthenticatedUser, @Body() body: AddProviderCategoryDto) {
    return this.providers.addCategory(user.id, body, user.id);
  }

  @Post(':providerId/categories')
  @Roles('PROVIDER')
  @ApiOperation({ summary: 'Create or attach a category to a provider account' })
  @ApiBody({ type: AddProviderCategoryDto })
  addCategoryForProvider(@CurrentUser() user: AuthenticatedUser, @Param('providerId') providerId: string, @Body() body: AddProviderCategoryDto) {
    return this.providers.addCategory(providerId, body, user.id);
  }

  @Get('available')
  @ApiOperation({ summary: 'Find available providers for a service category' })
  @ApiQuery({ name: 'categoryId', required: true, type: String })
  findAvailable(@Query('categoryId') categoryId: string) {
    return this.providers.findAvailableProviders(categoryId);
  }

  @Post('me/kyc/token')
  @Roles('PROVIDER')
  @ApiOperation({ summary: 'Create a Didit verification session to launch identity verification on-device' })
  getKycAccessToken(@CurrentUser() user: AuthenticatedUser) {
    return this.providers.getKycAccessToken(user.id);
  }

  @Get('search')
  @Public()
  @ApiOperation({ summary: 'Search providers and services' })
  @ApiQuery({ name: 'query', required: false, type: String })
  search(@Query('query') query: string) {
    if (!query) {
      throw new BadRequestException('query parameter is required');
    }
    return this.providers.search(query);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'List available providers' })
  @ApiQuery({ name: 'search', required: false, type: String })
  findAll(@Query('search') search?: string) {
    return this.providers.findAll(search);
  }

  @Get(':providerId')
  @Public()
  @ApiOperation({ summary: 'Get provider details' })
  getProvider(@Param('providerId') providerId: string) {
    return this.providers.getProfile(providerId);
  }
}
