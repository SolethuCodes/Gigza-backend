import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminLoginResendDto {
  @ApiProperty({ description: 'The admin id returned by POST /auth/admin/login' })
  @IsString()
  userId: string;
}
