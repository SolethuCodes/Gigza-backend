import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService) {
    cloudinary.config({ cloud_name: config.get('CLOUDINARY_CLOUD_NAME'), api_key: config.get('CLOUDINARY_API_KEY'), api_secret: config.get('CLOUDINARY_API_SECRET') });
  }
  async upload(file: Express.Multer.File, folder: string) {
    return new Promise<{ url: string; publicId: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder: `e-rrands/${folder}`, resource_type: 'auto', transformation: [{ quality: 'auto', fetch_format: 'auto' }] }, (error, result) => {
        if (error || !result) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      });
      stream.end(file.buffer);
    });
  }
}
