// Serialization for Blueprint Graph
import { Graph, INode, IConnection } from './GraphModel';

// Serializer class to convert graphs to/from JSON
export class GraphSerializer {
  
  // Serialize a graph instance to JSON string
  static serialize(graph: Graph): string {
    const graphData = {
      id: graph.id,
      name: graph.name,
      nodes: Array.from(graph.nodes.values()),
      connections: Array.from(graph.connections.values())
    };
    return JSON.stringify(graphData, null, 2);
  }
  
  // Deserialize a JSON string to a graph instance
  static deserialize(jsonStr: string): Graph {
    const graphData = JSON.parse(jsonStr);
    const graph = new Graph(graphData.id, graphData.name);
    
    // Add nodes
    for (const node of graphData.nodes) {
      graph.addNode(node);
    }
    
    // Add connections
    for (const connection of graphData.connections) {
      graph.addConnection(connection);
    }
    
    return graph;
  }
}
