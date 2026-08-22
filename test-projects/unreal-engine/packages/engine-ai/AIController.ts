import { Entity } from '../engine-entity/Entity';

export class AIController {
  entity: Entity;
  
  constructor(entity: Entity) {
    this.entity = entity;
  }
  
  update(deltaTime: number): void {
    // Update AI logic here
  }
}
