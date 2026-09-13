import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsDateString, IsNumber, IsPositive } from 'class-validator';

export class CreateServiceRequestDto {
  @ApiProperty({ example: 'category-id' })
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({ example: 'Home cleaning' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Need a deep cleaning for my apartment' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: '2026-07-05T10:00:00.000Z' })
  @IsDateString()
  preferredDate: string;

  @ApiProperty({ example: '10:00-12:00', required: false })
  @IsOptional()
  @IsString()
  preferredTimeSlot?: string;

  @ApiProperty({ example: '123 Main Street, Cape Town' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ example: -33.9258, required: false })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiProperty({ example: 18.4232, required: false })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiProperty({ example: 250.0, required: false })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  estimatedBudget?: number;
}

export class UpdateServiceRequestDto extends PartialType(CreateServiceRequestDto) {}

export class ServiceRequestDetailsResponseDto {
  @ApiProperty({ example: 'request-id' })
  id: string;

  @ApiProperty({ example: 'category-id' })
  categoryId: string;

  @ApiProperty({ example: 'Home cleaning' })
  title: string;

  @ApiProperty({ example: 'Need a deep cleaning for my apartment' })
  description: string;

  @ApiProperty({ example: '2026-07-05T10:00:00.000Z' })
  preferredDate: string;

  @ApiProperty({ example: '10:00-12:00', required: false })
  preferredTimeSlot?: string;

  @ApiProperty({ example: '123 Main Street, Cape Town' })
  address: string;

  @ApiProperty({ example: -33.9258, required: false })
  latitude?: number;

  @ApiProperty({ example: 18.4232, required: false })
  longitude?: number;

  @ApiProperty({ example: 250.0, required: false })
  estimatedBudget?: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2026-06-30T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-06-30T12:00:00.000Z' })
  updatedAt: string;
}
