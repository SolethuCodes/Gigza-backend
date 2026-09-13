import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsBoolean, IsNumber, Min, IsUrl, IsIn, MaxLength } from 'class-validator';

export class CreateServiceDto {
  @ApiProperty({ example: 'Home Cleaning' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Deep cleaning for homes and offices', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'category-id', required: false })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ example: 'Cleaning', required: false })
  @IsOptional()
  @IsString()
  categoryName?: string;

  @ApiProperty({ example: 'Cleaning services', required: false })
  @IsOptional()
  @IsString()
  categoryDescription?: string;

  @ApiProperty({ example: 50, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  basePrice?: number;

  @ApiProperty({ example: 'hour', required: false })
  @IsOptional()
  @IsString()
  priceUnit?: string;

  @ApiProperty({ example: 'FLAT', enum: ['FLAT', 'PER_ITEM'], required: false })
  @IsOptional()
  @IsIn(['FLAT', 'PER_ITEM'])
  pricingType?: 'FLAT' | 'PER_ITEM';

  @ApiProperty({ example: 'window', required: false, description: 'Singular item name for per-item pricing' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  unitLabel?: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ example: 'https://example.com/service.jpg', required: false })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;
}
