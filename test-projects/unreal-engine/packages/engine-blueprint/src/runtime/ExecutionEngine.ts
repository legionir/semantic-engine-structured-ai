// Execution Engine for Blueprint Runtime
import { RuntimeGraph, RuntimeNode, RuntimeConnection } from '../compiler/RuntimeGraph';

// Represents the execution state of a blueprint
interface ExecutionState {
  variables: Map<string, any>;
  events: Map<string, Function[]>;
  currentNodeId: string | null;
  executionStack: string[];
  completedNodes: Set<string>;
}

export class ExecutionEngine {
  private state: ExecutionState;
  private eventQueue: { eventId: string; data: any }[] = [];
  
  constructor() {
    this.state = {
      variables: new Map(),
      events: new Map(),
      currentNodeId: null,
      executionStack: [],
      completedNodes: new Set()
    };
  }
  
  // Execute a runtime graph
  execute(graph: RuntimeGraph, initialInputs?: Record<string, any>): any {
    // Initialize execution state
    this.state.variables.clear();
    this.state.currentNodeId = null;
    this.state.executionStack = [];
    this.state.completedNodes.clear();
    
    // Set initial inputs if provided
    if (initialInputs) {
      Object.entries(initialInputs).forEach(([key, value]) => {
        this.state.variables.set(key, value);
      });
    }
    
    // Find start nodes (nodes with no incoming connections)
    const startNodes = this.findStartNodes(graph);
    
    // Execute all start nodes
    let result: any = undefined;
    for (const nodeId of startNodes) {
      result = this.executeNodeRecursive(graph, nodeId);
    }
    
    return result;
  }
  
  // Recursively execute a node and its connected downstream nodes
  private executeNodeRecursive(graph: RuntimeGraph, nodeId: string): any {
    // Skip if node already executed
    if (this.state.completedNodes.has(nodeId)) {
      return;
    }
    
    // Mark node as being processed
    this.state.currentNodeId = nodeId;
    this.state.executionStack.push(nodeId);
    
    // Get the node
    const node = graph.getNode(nodeId);
    if (!node) {
      console.warn(`Node ${nodeId} not found in graph`);
      this.state.executionStack.pop();
      return;
    }
    
    // Prepare inputs for the node
    const inputs = this.collectNodeInputs(graph, node);
    
    // Execute the node
    const output = node.execute(inputs);
    
    // Process outputs
    this.processNodeOutputs(graph, node, output);
    
    // Mark node as completed
    this.state.completedNodes.add(nodeId);
    this.state.executionStack.pop();
    
    // Execute connected downstream nodes
    const downstreamNodes = this.findDownstreamNodes(graph, nodeId);
    for (const downstreamNodeId of downstreamNodes) {
      this.executeNodeRecursive(graph, downstreamNodeId);
    }
    
    return output;
  }
  
  // Collect input values for a node based on its connections
  private collectNodeInputs(graph: RuntimeGraph, node: RuntimeNode): any {
    const inputs: any = {};
    
    // Process each input port of the node
    for (const inputPort of node.inputs) {
      // Find connections that feed into this input port
      for (const [_, connection] of graph.connections) {
        if (connection.targetNodeId === node.id && connection.targetPortId === inputPort.id) {
          // Find the source node and its output
          const sourceNode = graph.getNode(connection.sourceNodeId);
          if (sourceNode) {
            // In a real implementation, we'd need to track the output values of nodes
            // For now, we'll simulate by looking for the value in our state
            const outputValue = this.state.variables.get(`${connection.sourceNodeId}_${connection.sourcePortId}`);
            if (outputValue !== undefined) {
              inputs[inputPort.name] = outputValue;
            }
          }
        }
      }
    }
    
    // Add any properties as inputs
    Object.assign(inputs, node.properties);
    
    return inputs;
  }
  
  // Process outputs of a node
  private processNodeOutputs(graph: RuntimeGraph, node: RuntimeNode, output: any): void {
    if (typeof output === 'object') {
      // Store output values by port name
      Object.entries(output).forEach(([portName, value]) => {
        this.state.variables.set(`${node.id}_${portName}`, value);
      });
    } else {
      // If output is a single value, store it with a default name
      this.state.variables.set(`${node.id}_output`, output);
    }
    
    // Handle special node types
    if (node.id.startsWith('EventEmitter')) {
      this.handleEventEmitted(node.id, output);
    }
    
    // Handle variable updates
    if (node.id.startsWith('VariableSet')) {
      const varName = (node as any).properties?.variableName;
      if (varName) {
        this.state.variables.set(varName, output);
      }
    }
    
    // Handle event triggers
    if (node.id.startsWith('EventTrigger')) {
      const eventName = (node as any).properties?.eventName;
      if (eventName) {
        this.handleEventEmitted(eventName, output);
      }
    }
  }
  
  // Find nodes that have no incoming connections (starting points)
  private findStartNodes(graph: RuntimeGraph): string[] {
    const startNodes: string[] = [];
    
    for (const [nodeId, _] of graph.nodes) {
      let hasIncomingConnection = false;
      
      for (const [_, connection] of graph.connections) {
        if (connection.targetNodeId === nodeId) {
          hasIncomingConnection = true;
          break;
        }
      }
      
      if (!hasIncomingConnection) {
        startNodes.push(nodeId);
      }
    }
    
    return startNodes;
  }
  
  // Find nodes that are connected downstream from the specified node
  private findDownstreamNodes(graph: RuntimeGraph, nodeId: string): string[] {
    const downstreamNodes: string[] = [];
    
    // Look for connections where this node is the source
    for (const [_, connection] of graph.connections) {
      if (connection.sourceNodeId === nodeId) {
        const targetNode = graph.getNode(connection.targetNodeId);
        if (targetNode && !downstreamNodes.includes(connection.targetNodeId)) {
          downstreamNodes.push(connection.targetNodeId);
        }
      }
    }
    
    return downstreamNodes;
  }
  
  // Register an event handler
  public registerEventHandler(eventId: string, handler: Function): void {
    if (!this.state.events.has(eventId)) {
      this.state.events.set(eventId, []);
    }
    this.state.events.get(eventId)?.push(handler);
  }
  
  // Handle an event being emitted
  private handleEventEmitted(eventId: string, eventData: any): void {
    const handlers = this.state.events.get(eventId) || [];
    for (const handler of handlers) {
      handler(eventData);
    }
    
    // Add to event queue for potential processing during execution
    this.eventQueue.push({ eventId, data: eventData });
  }
  
  // Process pending events
  public processEvents(): void {
    while (this.eventQueue.length > 0) {
      const event = this.eventQueue.shift();
      if (event) {
        const handlers = this.state.events.get(event.eventId) || [];
        for (const handler of handlers) {
          handler(event.data);
        }
      }
    }
  }
  
  // Get the current execution state
  public getExecutionState(): ExecutionState {
    return { ...this.state };
  }
  
  // Reset the execution state
  public reset(): void {
    this.state.variables.clear();
    this.state.currentNodeId = null;
    this.state.executionStack = [];
    this.state.completedNodes.clear();
    this.eventQueue = [];
  }
}
