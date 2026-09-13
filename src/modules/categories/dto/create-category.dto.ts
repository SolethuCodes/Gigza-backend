import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, Min } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Garden Maintenance' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'garden-maintenance' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiProperty({ example: 'Lawn care, hedge trimming, and garden cleanup services', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'https://example.com/icons/garden.svg', required: false })
  @IsOptional()
  @IsString()
  iconUrl?: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ example: 100, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;
}
