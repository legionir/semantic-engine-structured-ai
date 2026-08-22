import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Project } from '../../projects/entities/project.entity';

@Entity('builds')
export class Build {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, project => project.builds)
  project: Project;

  @Column()
  projectId: string;

  @Column({ type: 'int', default: 1 })
  buildNumber: number;

  @Column({ default: 'development' })
  buildType: string; // 'development' | 'production' | 'debug'

  @Column({ default: 'web' })
  targetPlatform: string; // 'web' | 'desktop' | 'mobile'

  @Column({ default: 'queued' })
  status: string; // 'queued' | 'building' | 'completed' | 'failed'

  @Column({ type: 'text', nullable: true })
  buildPath: string;

  @Column({ type: 'text', nullable: true })
  outputUrl: string;

  @Column({ type: 'jsonb', default: {} })
  config: {
    minify?: boolean;
    sourceMaps?: boolean;
    optimizeAssets?: boolean;
    pwaEnabled?: boolean;
    inlineRuntime?: boolean;
  };

  @Column({ type: 'jsonb', default: { files: [] } })
  output: {
    files: Array<{ path: string; size: number; type: string }>;
    totalSize?: number;
  };

  @Column({ type: 'text', nullable: true })
  logs: string;

  @Column({ type: 'text', nullable: true })
  error: string;

  @Column({ nullable: true })
  createdById: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
