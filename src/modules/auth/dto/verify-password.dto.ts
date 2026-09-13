import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyPasswordDto {
  @ApiProperty({ description: 'Current administrator password' })
  @IsString()
  @MinLength(1)
  password: string;

  @ApiPropertyOptional({ description: 'Why re-authentication is required (audit trail)' })
  @IsOptional()
  @IsString()
  purpose?: string;
}
