import { Entity, Component } from '@core/entity';

export interface Operation {
  execute(): void;
  validate(): boolean;
}

export class EntityCreateOperation implements Operation {
  constructor(private entityData: any) {}

  execute(): void {
    // Create entity based on entityData
    console.log('Creating entity:', this.entityData);
  }

  validate(): boolean {
    // Validate entity creation parameters
    return !!this.entityData;
  }
}

export class EntityUpdateOperation implements Operation {
  constructor(private entity: Entity, private component: Component) {}

  execute(): void {
    // Update entity with component
    console.log('Updating entity:', this.entity.id);
  }

  validate(): boolean {
    // Validate update parameters
    return !!this.entity && !!this.component;
  }
}

export class SceneGenerationOperation implements Operation {
  constructor(private sceneDefinition: any) {}

  execute(): void {
    // Generate scene based on definition
    console.log('Generating scene:', this.sceneDefinition);
  }

  validate(): boolean {
    // Validate scene generation parameters
    return !!this.sceneDefinition;
  }
}
