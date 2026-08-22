import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions } from 'typeorm';
import { Project } from '../entities/project.entity';
import { User } from '../../auth/entities/user.entity';

@Injectable()
export class ProjectService {
  constructor(
    @InjectRepository(Project)
    private projectRepository: Repository<Project>,
  ) {}

  async create(userId: string, projectData: Partial<Project>): Promise<Project> {
    const project = new Project();
    Object.assign(project, projectData);
    project.ownerId = userId;
    return await this.projectRepository.save(project);
  }

  async findAll(userId: string, options?: FindManyOptions<Project>): Promise<Project[]> {
    return await this.projectRepository.find({
      where: { ownerId: userId },
      ...options,
    });
  }

  async findOne(id: string, userId: string): Promise<Project> {
    return await this.projectRepository.findOne({
      where: { id, ownerId: userId },
    });
  }

  async update(id: string, userId: string, updateData: Partial<Project>): Promise<Project> {
    const project = await this.findOne(id, userId);
    if (!project) {
      throw new Error(`Project with id ${id} not found for user ${userId}`);
    }
    Object.assign(project, updateData);
    return await this.projectRepository.save(project);
  }

  async remove(id: string, userId: string): Promise<void> {
    const project = await this.findOne(id, userId);
    if (!project) {
      throw new Error(`Project with id ${id} not found for user ${userId}`);
    }
    await this.projectRepository.remove(project);
  }
}
