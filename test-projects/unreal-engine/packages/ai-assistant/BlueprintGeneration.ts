import { GraphModel } from '@engine-blueprint/core';

export class BlueprintGenerator {
  static generateBlueprint(definition: any): GraphModel {
    // Create a new blueprint based on the definition
    const graphModel = new GraphModel();
    
    // Process nodes from definition
    if (definition.nodes && Array.isArray(definition.nodes)) {
      definition.nodes.forEach((nodeDef: any) => {
        // Create node and add to graph
        const node = graphModel.addNode(nodeDef.type, nodeDef.id);
        
        // Set node properties
        if (nodeDef.properties) {
          Object.entries(nodeDef.properties).forEach(([key, value]) => {
            node.setProperty(key, value);
          });
        }
        
        // Process connections
        if (nodeDef.connections) {
          nodeDef.connections.forEach((connectionDef: any) => {
            graphModel.addConnection(
              node.getId(),
              connectionDef.output,
              connectionDef.targetNodeId,
              connectionDef.input
            );
          });
        }
      });
    }
    
    return graphModel;
  }
}
