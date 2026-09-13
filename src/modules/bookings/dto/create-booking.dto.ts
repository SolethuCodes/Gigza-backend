import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: 'service-id' })
  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @ApiProperty({ example: 'provider-id' })
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @ApiProperty({ example: 250.0 })
  @IsNumber()
  quotedPrice!: number;

  @ApiProperty({ example: 120, required: false })
  @IsOptional()
  @IsNumber()
  estimatedDuration?: number;

  @ApiProperty({ example: 4, required: false, description: 'Item count for per-item priced services' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  quantity?: number;

  @ApiProperty({ example: 'Please bring your own tools', required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ example: '2026-07-25', required: false })
  @IsOptional()
  @IsDateString()
  preferredDate?: string;

  @ApiProperty({ example: '10:00-12:00', required: false })
  @IsOptional()
  @IsString()
  preferredTimeSlot?: string;

  @ApiProperty({ example: '123 Main Road, Cape Town', required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ example: -33.9249, required: false })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiProperty({ example: 18.4241, required: false })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiProperty({ example: 'online', enum: ['online', 'cash'], required: false, description: 'Chosen settlement method for this booking' })
  @IsOptional()
  @IsIn(['online', 'cash'])
  paymentCategory?: 'online' | 'cash';

  @ApiProperty({
    example: 'pay_now',
    required: false,
    enum: ['pay_now', 'wait_approval'],
    description: '"pay_now" (with paymentCategory "online") holds the booking as AWAITING_PAYMENT until payment settles',
  })
  @IsOptional()
  @IsIn(['pay_now', 'wait_approval'])
  paymentTiming?: 'pay_now' | 'wait_approval';
}
