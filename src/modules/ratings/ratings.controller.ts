import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { RatingsService } from './ratings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateRatingDto } from './dto/create-rating.dto';

@ApiTags('ratings')
@Controller({ path: 'ratings', version: '1' })
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiBody({ type: CreateRatingDto })
  @Post()
  @ApiOperation({ summary: 'Submit post-service rating (1–5) after QR completion' })
  create(@CurrentUser() u: AuthenticatedUser, @Body() body: CreateRatingDto) {
    return this.ratings.create(u.id, body);
  }

  @Get('provider/:providerId')
  @ApiOperation({ summary: 'Get anonymized buyer→provider ratings, including service name' })
  getProviderRatings(@Param('providerId') providerId: string) {
    return this.ratings.getForProvider(providerId);
  }

  @Get('service/:serviceId')
  @ApiOperation({ summary: 'Get anonymized ratings for a single service listing' })
  getServiceRatings(@Param('serviceId') serviceId: string) {
    return this.ratings.getForService(serviceId);
  }

  @Get('customer/:userId')
  @ApiOperation({ summary: 'Get anonymized provider→customer ratings for a user' })
  getCustomerRatings(@Param('userId') userId: string) {
    return this.ratings.getForCustomer(userId);
  }
}
