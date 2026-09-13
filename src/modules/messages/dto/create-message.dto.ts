import { IsString, IsEnum, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum MessageTypeDto {
  TEXT = 'TEXT',
  PHOTO = 'PHOTO',
  SYSTEM = 'SYSTEM',
}

export class CreateMessageDto {
  @ApiProperty({ example: 'Hello, is this service available?' })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({ enum: MessageTypeDto, default: MessageTypeDto.TEXT, required: false })
  @IsEnum(MessageTypeDto)
  @IsOptional()
  type?: MessageTypeDto = MessageTypeDto.TEXT;

  @ApiProperty({ type: 'object', required: false, example: { attachmentUrl: 'https://...' } })
  @IsOptional()
  metadata?: Record<string, any>;
}
