// Graph Model for Blueprint System

// Represents a single node in the blueprint graph
export interface INode {
  id: string;
  type: string; // e.g., 'MathOperation', 'VariableGet', 'FunctionCall'
  position: { x: number; y: number };
  inputs: IPort[];
  outputs: IPort[];
  properties: Record<string, any>;
}

// Represents a connection port on a node
export interface IPort {
  id: string;
  name: string;
  type: string; // e.g., 'float', 'int', 'bool', 'Vector3', 'EntityRef'
  direction: 'input' | 'output';
}

// Represents a connection between two ports
export interface IConnection {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

// Main graph container
export class Graph {
  id: string;
  name: string;
  nodes: Map<string, INode> = new Map();
  connections: Map<string, IConnection> = new Map();
  
  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }
  
  addNode(node: INode): void {
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
  
  addConnection(connection: IConnection): void {
    this.connections.set(connection.id, connection);
  }
  
  removeConnection(connectionId: string): void {
    this.connections.delete(connectionId);
  }
  
  getNode(nodeId: string): INode | undefined {
    return this.nodes.get(nodeId);
  }
  
  getConnection(connectionId: string): IConnection | undefined {
    return this.connections.get(connectionId);
  }
}
