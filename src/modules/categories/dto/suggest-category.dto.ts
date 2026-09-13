import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class SuggestCategoryDto {
  @ApiProperty({ example: 'Pool Maintenance' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @ApiProperty({ example: 'Cleaning and servicing swimming pools', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}
