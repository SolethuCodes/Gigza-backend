import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminLoginVerifyDto {
  @ApiProperty({ description: 'The admin id returned by POST /auth/admin/login' })
  @IsString()
  userId: string;

  @ApiProperty({ example: '123456', description: 'The 6-digit code delivered by SMS (or email fallback)' })
  @IsString()
  @Length(6, 6)
  code: string;
}
