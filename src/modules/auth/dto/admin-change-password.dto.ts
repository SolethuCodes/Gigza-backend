import { IsString, Length, Matches, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminChangePasswordVerifyDto {
  @ApiProperty({ example: '123456', description: 'The 6-digit code emailed to the admin' })
  @IsString()
  @Length(6, 6)
  code: string;
}

export class AdminChangePasswordSetDto {
  @ApiProperty({ description: 'New password (min 8, with upper, lower, number and special character)' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'Password must contain uppercase, lowercase, a number and a special character (@$!%*?&)',
  })
  newPassword: string;
}
