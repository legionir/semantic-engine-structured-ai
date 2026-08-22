import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Asset } from '../entities/asset.entity';
import { S3Service } from './s3.service';

@Injectable()
export class AssetService {
  constructor(
    @InjectRepository(Asset)
    private assetRepository: Repository<Asset>,
    private s3Service: S3Service,
  ) {}

  async create(assetData: Partial<Asset>, file?: Express.Multer.File): Promise<Asset> {
    let assetUrl = '';
    
    if (file) {
      // Upload file to S3/MinIO
      assetUrl = await this.s3Service.uploadFile(
        file.buffer,
        `assets/${Date.now()}-${file.originalname}`,
        file.mimetype
      );
    }
    
    const asset = new Asset();
    Object.assign(asset, assetData);
    asset.url = assetUrl;
    
    return await this.assetRepository.save(asset);
  }

  async findAll(): Promise<Asset[]> {
    return await this.assetRepository.find();
  }

  async findOne(id: string): Promise<Asset> {
    return await this.assetRepository.findOne({ where: { id } });
  }

  async update(id: string, updateData: Partial<Asset>): Promise<Asset> {
    const asset = await this.findOne(id);
    if (!asset) {
      throw new Error(`Asset with id ${id} not found`);
    }
    Object.assign(asset, updateData);
    return await this.assetRepository.save(asset);
  }

  async remove(id: string): Promise<void> {
    const asset = await this.findOne(id);
    if (!asset) {
      throw new Error(`Asset with id ${id} not found`);
    }
    
    // Remove file from S3/MinIO
    if (asset.url) {
      const fileName = asset.url.split('/').pop();
      if (fileName) {
        await this.s3Service.deleteFile(`assets/${fileName}`);
      }
    }
    
    await this.assetRepository.remove(asset);
  }
}