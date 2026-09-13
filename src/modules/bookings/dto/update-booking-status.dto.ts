import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateBookingStatusDto {
  @ApiProperty({ enum: ['pending', 'accepted', 'declined', 'in_progress', 'cancelled', 'paid'] })
  @IsString()
  @IsIn(['pending', 'accepted', 'declined', 'in_progress', 'cancelled', 'paid'])
  status!: string;

  @ApiProperty({ required: false, description: 'Reason for decline' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ required: false, description: 'Cancellation reason if cancelling' })
  @IsOptional()
  @IsString()
  cancellationReason?: string;
}
