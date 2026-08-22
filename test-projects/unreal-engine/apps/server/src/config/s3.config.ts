import { ConfigModule, ConfigService } from '@nestjs/config';

export const s3Config = {
  imports: [ConfigModule],
  useFactory: (configService: ConfigService) => ({
    accessKeyId: configService.get<string>('AWS_ACCESS_KEY_ID'),
    secretAccessKey: configService.get<string>('AWS_SECRET_ACCESS_KEY'),
    region: configService.get<string>('AWS_REGION'),
    bucket: configService.get<string>('AWS_S3_BUCKET'),
    endpoint: configService.get<string>('AWS_S3_ENDPOINT'),
  }),
  inject: [ConfigService],
};