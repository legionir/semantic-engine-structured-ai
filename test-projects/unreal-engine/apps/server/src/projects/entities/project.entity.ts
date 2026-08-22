import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Build } from '../../builds/entities/build.entity';
import { Asset } from '../../assets/entities/asset.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: 'active' })
  status: string;

  @Column({ type: 'jsonb', default: {} })
  config: any;

  @Column({ type: 'jsonb', default: [] })
  scenes: any[];

  @ManyToOne(() => User, user => user.projects)
  owner: User;

  @Column()
  ownerId: string;

  @OneToMany(() => Build, build => build.project)
  builds: Build[];

  @OneToMany(() => Asset, asset => asset.project)
  assets: Asset[];

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
