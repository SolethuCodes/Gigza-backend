import { Controller, Post, UseInterceptors, UploadedFile, Query, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { UploadsService } from './uploads.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
@ApiTags('uploads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'uploads', version: '1' })
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}
  @Post() @ApiConsumes('multipart/form-data') @ApiOperation({ summary: 'Upload a file to Cloudinary' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  uploadFile(@UploadedFile() file: any, @Query('folder') folder = 'general') { return this.uploads.upload(file, folder); }
}
