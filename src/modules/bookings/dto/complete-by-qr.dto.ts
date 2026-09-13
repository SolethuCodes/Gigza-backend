import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CompleteByQrDto {
  @ApiProperty({ description: 'Signed completion QR token issued to the customer' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
