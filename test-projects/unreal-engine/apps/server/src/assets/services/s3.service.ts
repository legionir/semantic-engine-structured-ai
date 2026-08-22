import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as AWS from 'aws-sdk';

@Injectable()
export class S3Service {
  private s3: AWS.S3;

  constructor(private configService: ConfigService) {
    this.s3 = new AWS.S3({
      accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
      region: this.configService.get<string>('AWS_REGION'),
      endpoint: this.configService.get<string>('AWS_S3_ENDPOINT'),
    });
  }

  async uploadFile(file: Buffer, fileName: string, mimeType: string): Promise<string> {
    const bucket = this.configService.get<string>('AWS_S3_BUCKET');
    
    const params = {
      Bucket: bucket,
      Key: fileName,
      Body: file,
      ContentType: mimeType,
      ACL: 'public-read',
    };
    
    const result = await this.s3.upload(params).promise();
    return result.Location;
  }

  async deleteFile(fileName: string): Promise<void> {
    const bucket = this.configService.get<string>('AWS_S3_BUCKET');
    
    const params = {
      Bucket: bucket,
      Key: fileName,
    };
    
    await this.s3.deleteObject(params).promise();
  }
}