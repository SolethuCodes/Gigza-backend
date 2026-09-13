import { IsEmail, IsOptional, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: ['user', 'provider', 'admin'], default: 'user', required: false })
  @IsOptional()
  @IsIn(['user', 'provider', 'admin'])
  type?: 'user' | 'provider' | 'admin';
}
