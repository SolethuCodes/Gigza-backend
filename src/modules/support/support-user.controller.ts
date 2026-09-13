import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

class CreateSupportRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(140)
  subject?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;
}

@ApiTags('support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'support', version: '1' })
export class SupportUserController {
  constructor(private readonly support: SupportService) {}

  @Post('requests')
  @ApiOperation({ summary: 'Open a support request describing a problem' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateSupportRequestDto) {
    return this.support.createUserTicket(
      { id: user.id, type: user.type, email: user.email },
      body,
    );
  }

  @Get('requests/mine')
  @ApiOperation({ summary: 'List my support requests with replies' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.support.getUserTickets({ id: user.id, type: user.type });
  }
}
