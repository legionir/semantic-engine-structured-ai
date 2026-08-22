import { Controller, Get, Post, Put, Body, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { BuildService } from '../services/build.service';
import { Build } from '../entities/build.entity';

@Controller('builds')
@UseGuards(JwtAuthGuard)
export class BuildController {
  constructor(private readonly buildService: BuildService) {}

  @Post()
  async create(
    @Body() body: {
      projectId: string;
      buildType?: string;
      targetPlatform?: string;
      config?: Build['config'];
    },
    @Req() req: Request & { user: { id: string } },
  ) {
    return await this.buildService.create(
      body.projectId,
      req.user.id,
      {
        buildType: body.buildType,
        targetPlatform: body.targetPlatform,
        config: body.config,
      },
    );
  }

  @Get('project/:projectId')
  async findAll(@Param('projectId') projectId: string) {
    return await this.buildService.findAll(projectId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.buildService.findOne(id);
  }

  @Post(':id/start')
  async startBuild(@Param('id') id: string) {
    return await this.buildService.startBuild(id);
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; log?: string },
  ) {
    return await this.buildService.updateStatus(id, body.status, body.log);
  }
}
