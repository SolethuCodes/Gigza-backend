import { ApiProperty } from '@nestjs/swagger';

export class ServiceRequestProviderMatchDto {
  @ApiProperty({ example: 'provider-id' })
  providerId: string;

  @ApiProperty({ example: 'Provider Name' })
  name: string;

  @ApiProperty({ example: 'Cleaning' })
  category: string;

  @ApiProperty({ example: 4.2 })
  distanceKm: number;

  @ApiProperty({ example: 4.8 })
  rating: number;

  @ApiProperty({ example: true })
  isAvailable: boolean;

  @ApiProperty({ example: true })
  isVerified: boolean;

  @ApiProperty({ example: '15 minutes' })
  estimatedArrivalTime: string;
}

export class ServiceRequestMatchesResponseDto {
  @ApiProperty({ example: 'request-id' })
  serviceRequestId: string;

  @ApiProperty({ type: [ServiceRequestProviderMatchDto] })
  matches: ServiceRequestProviderMatchDto[];

  @ApiProperty({ required: false, example: 'No matching providers found for this request.' })
  message?: string;
}
