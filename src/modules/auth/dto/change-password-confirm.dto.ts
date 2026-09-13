import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordConfirmDto {
  @ApiProperty({ description: 'One-time code emailed to the admin to confirm the password change' })
  @IsString()
  @Length(6, 6)
  code: string;
}
