import { Allow, IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateAppConfigDto {
  @IsOptional() @IsString() platformName?: string;
  @IsOptional() @IsString() taglineUser?: string;
  @IsOptional() @IsString() taglineProvider?: string;
  @IsOptional() @IsString() splashTagline?: string;
  @IsOptional() @IsString() poweredBy?: string;
  @IsOptional() @IsString() helpHeroTitle?: string;
  @IsOptional() @IsString() helpHeroBody?: string;
  @IsOptional() @IsString() colorPrimary?: string;
  @IsOptional() @IsString() colorAccent?: string;
  @IsOptional() @IsString() colorTeal?: string;
  @IsOptional() @IsString() supportEmail?: string;
  @IsOptional() @IsString() supportPhone?: string;
  @IsOptional() @IsString() supportHours?: string;
  @IsOptional() @IsBoolean() liveChatEnabled?: boolean;
  @IsOptional() @IsBoolean() maintenanceMode?: boolean;
  @IsOptional() @IsString() maintenanceMessage?: string;
  @IsOptional() @IsString() websiteHeadline?: string;
  @IsOptional() @IsString() websiteSubheadline?: string;
  @IsOptional() @IsString() websiteFooter?: string;
  @IsOptional() @Allow() faqs?: unknown;
  @IsOptional() @Allow() legalTerms?: unknown;
  @IsOptional() @Allow() legalPrivacy?: unknown;
  @IsOptional() @Allow() onboardingSlides?: unknown;
  @IsOptional() @Allow() contentFlags?: unknown;
  @IsOptional() @IsString() snapshotLabel?: string;
  @IsOptional() @IsString() reason?: string;
}

export class RestoreConfigDto {
  @IsOptional() @IsString() reason?: string;
}

export class CreateSnapshotDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() reason?: string;
}
