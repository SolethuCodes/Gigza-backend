import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({ enum: ['DELETE'], description: 'Must be the literal string "DELETE".' })
  @IsString()
  @IsIn(['DELETE'])
  confirmation: string;
}
