import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AssetService } from '../services/asset.service';
import { Asset } from '../entities/asset.entity';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async create(@UploadedFile() file: Express.Multer.File, @Body() assetData: Partial<Asset>, @Req() req: Request) {
    return await this.assetService.create(assetData, file);
  }

  @Get()
  async findAll() {
    return await this.assetService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.assetService.findOne(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateData: Partial<Asset>) {
    return await this.assetService.update(id, updateData);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.assetService.remove(id);
  }
}
