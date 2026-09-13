import { Controller, Get, Post, Patch, Body, Query, UseGuards, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { ServiceRequestsService } from './service-requests.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ServiceRequestMatchesResponseDto } from './dto/service-request-match.dto';
import {
  CreateServiceRequestDto,
  ServiceRequestDetailsResponseDto,
  UpdateServiceRequestDto,
} from './dto/service-request.dto';

@ApiTags('service-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'service-requests', version: '1' })
export class ServiceRequestsController {
  constructor(private readonly sr: ServiceRequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a service request (FR-B1)' })
  @ApiBody({ type: CreateServiceRequestDto })
  @ApiResponse({ status: 201, type: ServiceRequestDetailsResponseDto })
  create(@CurrentUser() u: AuthenticatedUser, @Body() body: CreateServiceRequestDto) {
    return this.sr.create(u.id, body);
  }

  @Get('open')
  @ApiOperation({ summary: 'Browse open requests for providers (FR-B2)' })
  findOpen(@Query('categoryId') categoryId?: string) {
    return this.sr.findOpen(categoryId);
  }

  @Get('my')
  @ApiOperation({ summary: 'View personal service requests' })
  findMy(@CurrentUser() u: AuthenticatedUser) {
    return this.sr.findMyRequests(u.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one service request by ID' })
  @ApiResponse({ status: 200, type: ServiceRequestDetailsResponseDto })
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    const request = await this.sr.findOne(id, u.id);
    if (!request) {
      throw new NotFoundException(`Service request ${id} not found or unavailable`);
    }
    return request;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a service request before it is accepted' })
  @ApiBody({ type: UpdateServiceRequestDto })
  @ApiResponse({ status: 200, type: ServiceRequestDetailsResponseDto })
  update(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateServiceRequestDto,
  ) {
    return this.sr.updateRequest(u.id, id, body);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a service request before it is accepted' })
  @ApiResponse({ status: 200, type: ServiceRequestDetailsResponseDto })
  cancel(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return this.sr.cancelRequest(u.id, id);
  }

  @Get(':id/matches')
  @ApiOperation({ summary: 'Match providers for a service request (FR-B2)' })
  @ApiResponse({ status: 200, type: ServiceRequestMatchesResponseDto })
  async findMatches(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    const matches = await this.sr.findMatches(id, u.id, u.type);
    if (!matches) {
      throw new NotFoundException(`Service request ${id} not found`);
    }
    return matches;
  }
}
