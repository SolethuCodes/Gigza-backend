import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

export class ServiceResponseDto {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  priceUnit: string | null;
  yearsExperience: number | null;
  imageUrl: string | null;
  isAvailable: boolean;
  provider: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    avgRating: number;
    totalRatings: number;
    isAvailable: boolean;
  };
  category: {
    id: string;
    name: string;
    slug: string;
    iconUrl: string | null;
  };
}

export class ServiceQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true'))
  available?: boolean;
}
