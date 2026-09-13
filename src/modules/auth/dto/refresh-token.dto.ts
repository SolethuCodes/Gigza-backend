import { IsString, IsOptional, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  userId: string;

  @ApiProperty()
  @IsString()
  refreshToken: string;

  @ApiProperty({ enum: ['user', 'provider', 'admin'], default: 'user', required: false })
  @IsOptional()
  @IsIn(['user', 'provider', 'admin'])
  type?: 'user' | 'provider' | 'admin';
}
