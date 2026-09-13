import { Controller, Get, Param, Patch, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateCategoryDto } from './dto/create-category.dto';
import { SuggestCategoryDto } from './dto/suggest-category.dto';

@ApiTags('categories')
@ApiBearerAuth()
@Controller({ path: 'categories', version: '1' })
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List all approved service categories' })
  findAll() {
    return this.categories.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('pending')
  @ApiOperation({ summary: 'List categories awaiting review (admin only)' })
  listPending() {
    return this.categories.listPending();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a service category by ID' })
  findOne(@Param('id') id: string) {
    return this.categories.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post()
  @ApiOperation({ summary: 'Create a new service category (admin only)' })
  @ApiBody({ type: CreateCategoryDto })
  @ApiResponse({ status: 201, description: 'Created new category' })
  create(@Body() body: CreateCategoryDto) {
    return this.categories.create(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROVIDER')
  @Post('suggest')
  @ApiOperation({ summary: 'Suggest a new category (provider) — needs admin approval' })
  @ApiBody({ type: SuggestCategoryDto })
  suggest(@CurrentUser() user: AuthenticatedUser, @Body() body: SuggestCategoryDto) {
    return this.categories.suggest(user.id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a suggested category (admin only)' })
  approve(@Param('id') id: string) {
    return this.categories.approve(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject a suggested category (admin only)' })
  reject(@Param('id') id: string) {
    return this.categories.reject(id);
  }
}
