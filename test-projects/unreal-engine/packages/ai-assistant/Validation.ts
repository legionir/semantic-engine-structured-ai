import { Operation } from './StructuredOperations';

export class Validator {
  static validateOperation(operation: Operation): boolean {
    return operation.validate();
  }

  static validateScene(sceneData: any): boolean {
    // Basic scene validation logic
    if (!sceneData || typeof sceneData !== 'object') {
      return false;
    }
    
    // Check for required properties
    if (!sceneData.entities || !Array.isArray(sceneData.entities)) {
      return false;
    }
    
    // Additional validation rules can be added here
    return true;
  }

  static validateBlueprint(blueprintData: any): boolean {
    // Basic blueprint validation logic
    if (!blueprintData || typeof blueprintData !== 'object') {
      return false;
    }
    
    // Check for required properties
    if (!blueprintData.nodes || !Array.isArray(blueprintData.nodes)) {
      return false;
    }
    
    // Additional validation rules can be added here
    return true;
  }
}
