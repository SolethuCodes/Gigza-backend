import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class CompleteOAuthSignupDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  creationToken: string;

  @ApiProperty({ enum: ['user', 'provider'] })
  @IsIn(['user', 'provider'])
  role: 'user' | 'provider';
}
