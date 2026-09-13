import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateBookingDto {
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
}
