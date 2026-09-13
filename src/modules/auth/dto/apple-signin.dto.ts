import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
} from 'class-validator';

class AppleFullNameDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  givenName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  familyName?: string | null;
}

export class AppleSignInDto {
  @ApiProperty({ description: 'Apple identity token (JWT) from ASAuthorization' })
  @IsString()
  @IsNotEmpty()
  identityToken: string;

  @ApiPropertyOptional({
    description: 'Single-use authorization code (kept for token revocation on account deletion)',
  })
  @IsOptional()
  @IsString()
  authorizationCode?: string;

  @ApiProperty({
    description: 'Raw nonce. The identity token `nonce` claim must equal sha256hex(rawNonce).',
  })
  @IsString()
  @IsNotEmpty()
  rawNonce: string;

  @ApiPropertyOptional({
    type: AppleFullNameDto,
    nullable: true,
    description: 'Only sent on the user’s first authorization for this Apple ID.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AppleFullNameDto)
  fullName?: AppleFullNameDto | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Only sent on the first authorization; the token also carries it.',
  })
  @IsOptional()
  @IsString()
  email?: string | null;
}
