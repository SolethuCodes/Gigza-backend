import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';
import { MAX_CART_ITEMS } from '../payments.service';

export class PaystackCheckoutDto {
  @ApiProperty({ type: [String], description: 'AWAITING_PAYMENT bookings to pay for in one transaction' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CART_ITEMS)
  @IsString({ each: true })
  bookingIds: string[];
}
