// Runtime Graph for Blueprint Execution

// Represents a node in the runtime graph
export interface RuntimeNode {
  id: string;
  execute: (inputs: any) => any; // Function to execute the node
  inputs: RuntimePort[];
  outputs: RuntimePort[];
  properties: Record<string, any>;
}

// Represents a connection port in the runtime graph
export interface RuntimePort {
  id: string;
  name: string;
  type: string; // Data type of the port
  direction: 'input' | 'output';
}

// Represents a connection between runtime nodes
export interface RuntimeConnection {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

// Main runtime graph container
export class RuntimeGraph {
  id: string;
  name: string;
  nodes: Map<string, RuntimeNode> = new Map();
  connections: Map<string, RuntimeConnection> = new Map();
  
  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }
  
  addNode(node: RuntimeNode): void {
    this.nodes.set(node.id, node);
  }
  
  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    
    // Remove any connections associated with this node
    for (const [connId, conn] of this.connections) {
      if (conn.sourceNodeId === nodeId || conn.targetNodeId === nodeId) {
        this.connections.delete(connId);
      }
    }
  }
  
  addConnection(connection: RuntimeConnection): void {
    this.connections.set(connection.id, connection);
  }
  
  removeConnection(connectionId: string): void {
    this.connections.delete(connectionId);
  }
  
  getNode(nodeId: string): RuntimeNode | undefined {
    return this.nodes.get(nodeId);
  }
  
  getConnection(connectionId: string): RuntimeConnection | undefined {
    return this.connections.get(connectionId);
  }
}
