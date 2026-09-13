import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SelectOAuthAccountDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  selectionToken: string;

  @ApiProperty({ enum: ['user', 'provider'] })
  @IsIn(['user', 'provider'])
  accountType: 'user' | 'provider';
}
