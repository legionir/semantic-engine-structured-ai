import { Scene } from '@core/scene';

export class SceneGenerator {
  static generateScene(definition: any): Scene {
    // Create a new scene based on the definition
    const scene = new Scene();
    
    // Process entities from definition
    if (definition.entities && Array.isArray(definition.entities)) {
      definition.entities.forEach((entityDef: any) => {
        // Create entity and add to scene
        const entity = scene.createEntity(entityDef.id || undefined);
        
        // Add components based on definition
        if (entityDef.components) {
          Object.entries(entityDef.components).forEach(([componentType, componentData]) => {
            // Add component to entity
            entity.addComponent(componentType, componentData);
          });
        }
      });
    }
    
    return scene;
  }
}
