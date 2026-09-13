import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min, Max, IsOptional, IsString } from 'class-validator';

export class UpdateCurrentLocationDto {
  @ApiProperty({ example: -33.9258 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ example: 18.4232 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({ example: 5, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @ApiProperty({ example: '123 Rivonia Rd, Sandton, Gauteng', required: false })
  @IsOptional()
  @IsString()
  address?: string;
}
