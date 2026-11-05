import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min, ValidateIf } from 'class-validator';

export const PORTFOLIO_ITEM_TYPES = ['PHOTO', 'LINK'] as const;
export type PortfolioItemType = (typeof PORTFOLIO_ITEM_TYPES)[number];

const HTTPS_ONLY = { protocols: ['https'], require_protocol: true };

export class CreatePortfolioItemDto {
  @ApiProperty({ enum: PORTFOLIO_ITEM_TYPES, example: 'PHOTO' })
  @IsIn(PORTFOLIO_ITEM_TYPES)
  type: PortfolioItemType;

  @ApiProperty({ required: false, description: 'Photo URL (from /uploads). Required for PHOTO; optional thumbnail for LINK.' })
  @ValidateIf((o: CreatePortfolioItemDto) => o.type === 'PHOTO' || o.imageUrl !== undefined)
  @IsUrl(HTTPS_ONLY)
  @MaxLength(1000)
  imageUrl?: string;

  @ApiProperty({ required: false, example: 'https://www.youtube.com/watch?v=…', description: 'Required for LINK.' })
  @ValidateIf((o: CreatePortfolioItemDto) => o.type === 'LINK')
  @IsUrl(HTTPS_ONLY)
  @MaxLength(1000)
  linkUrl?: string;

  @ApiProperty({ required: false, example: 'Wedding reception, Durban — March' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  caption?: string;
}

export class UpdatePortfolioItemDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  caption?: string;

  @ApiProperty({ required: false, description: 'Lower shows first' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
