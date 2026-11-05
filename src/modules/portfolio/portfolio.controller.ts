import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PortfolioService } from './portfolio.service';
import { CreatePortfolioItemDto, UpdatePortfolioItemDto } from './dto/portfolio-item.dto';

@ApiTags('portfolio')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'portfolio', version: '1' })
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get('feed')
  @ApiOperation({ summary: 'Recent portfolio work from bookable talent (Showcase feed)' })
  @ApiQuery({ name: 'talentType', required: false, enum: ['DJ', 'MC', 'PHOTOGRAPHER', 'DANCER'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  feed(@Query('talentType') talentType?: string, @Query('limit') limit?: string) {
    return this.portfolio.feed({ talentType, limit: limit ? Number(limit) : undefined });
  }

  @Get('me')
  @Roles('PROVIDER')
  @ApiOperation({ summary: "The signed-in talent's own portfolio" })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.portfolio.listForProvider(user.id);
  }

  @Post('me')
  @Roles('PROVIDER')
  @ApiOperation({ summary: 'Add a photo or link to your portfolio' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreatePortfolioItemDto) {
    return this.portfolio.create(user.id, body);
  }

  @Patch('me/:id')
  @Roles('PROVIDER')
  @ApiOperation({ summary: 'Edit a portfolio caption or position' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: UpdatePortfolioItemDto) {
    return this.portfolio.update(user.id, id, body);
  }

  @Delete('me/:id')
  @Roles('PROVIDER')
  @ApiOperation({ summary: 'Remove an item from your portfolio' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.portfolio.remove(user.id, id);
  }

  @Get('provider/:providerId')
  @ApiOperation({ summary: "A talent's portfolio, for their public profile" })
  forProvider(@Param('providerId') providerId: string) {
    return this.portfolio.listForProvider(providerId);
  }
}
