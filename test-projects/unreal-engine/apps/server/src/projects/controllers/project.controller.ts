import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProjectService } from '../services/project.service';
import { Project } from '../entities/project.entity';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  async create(@Body() projectData: Partial<Project>, @Req() req: Request & { user: { id: string } }) {
    return await this.projectService.create(req.user.id, projectData);
  }

  @Get()
  async findAll(@Req() req: Request & { user: { id: string } }) {
    return await this.projectService.findAll(req.user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: Request & { user: { id: string } }) {
    return await this.projectService.findOne(id, req.user.id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateData: Partial<Project>, @Req() req: Request & { user: { id: string } }) {
    return await this.projectService.update(id, req.user.id, updateData);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request & { user: { id: string } }) {
    return await this.projectService.remove(id, req.user.id);
  }
}