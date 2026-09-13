import { IsString, Length, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestKycApprovalDto {
  @ApiProperty({ description: "The signed-in admin's password — re-authenticates this sensitive action" })
  @IsString()
  @MinLength(1)
  password: string;

  @ApiProperty({ description: 'Why the provider is being approved. Stored on the provider record and the audit log.' })
  @IsString()
  @MinLength(3, { message: 'Add a short note explaining the approval' })
  @MaxLength(1000)
  notes: string;
}

export class ConfirmKycApprovalDto {
  @ApiProperty({ example: '123456', description: 'The 6-digit code emailed to the admin' })
  @IsString()
  @Length(6, 6)
  code: string;
}
