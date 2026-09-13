import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateRatingDto {
  @ApiProperty({ example: 'booking-id', description: 'Booking being rated' })
  @IsString()
  @IsNotEmpty()
  bookingId!: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5, description: 'Rating score from 1 to 5' })
  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;

  @ApiProperty({ example: 'Excellent service and punctuality', required: false })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiProperty({ type: [String], example: ['https://example.com/review-1.jpg'], required: false })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  photoUrls?: string[];
}
