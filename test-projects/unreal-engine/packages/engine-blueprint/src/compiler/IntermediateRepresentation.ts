// Intermediate Representation for Blueprint Compiler

// Represents a compiled node in the intermediate representation
export interface IRNode {
  id: string;
  operation: string; // The operation this node performs
  inputs: IRPort[];
  outputs: IRPort[];
  properties: Record<string, any>;
}

// Represents a connection port in the IR
export interface IRPort {
  id: string;
  name: string;
  type: string; // Data type of the port
  direction: 'input' | 'output';
}

// Represents a connection between IR nodes
export interface IRConnection {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

// Main IR graph container
export class IRGraph {
  id: string;
  name: string;
  nodes: Map<string, IRNode> = new Map();
  connections: Map<string, IRConnection> = new Map();
  
  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }
  
  addNode(node: IRNode): void {
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
  
  addConnection(connection: IRConnection): void {
    this.connections.set(connection.id, connection);
  }
  
  removeConnection(connectionId: string): void {
    this.connections.delete(connectionId);
  }
  
  getNode(nodeId: string): IRNode | undefined {
    return this.nodes.get(nodeId);
  }
  
  getConnection(connectionId: string): IRConnection | undefined {
    return this.connections.get(connectionId);
  }
}
