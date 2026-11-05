import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength, IsIn } from 'class-validator';
import { TALENT_TYPES, type TalentType } from '../../../common/constants/talent-types';

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

  @ApiProperty({ enum: TALENT_TYPES, example: 'DJ', required: false, description: "Defaults to the provider's own talent type" })
  @IsOptional()
  @IsIn(TALENT_TYPES)
  talentType?: TalentType;
}
