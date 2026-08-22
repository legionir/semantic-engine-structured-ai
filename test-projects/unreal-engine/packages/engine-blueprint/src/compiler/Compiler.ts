// Blueprint Compiler: Graph → IR → Runtime Graph

import { Graph, INode, IConnection } from '../GraphModel';
import { IRGraph, IRNode, IRPort, IRConnection } from './IntermediateRepresentation';
import { RuntimeGraph, RuntimeNode, RuntimePort, RuntimeConnection } from './RuntimeGraph';

export class BlueprintCompiler {
  
  // Compile a graph to intermediate representation
  compileToIR(graph: Graph): IRGraph {
    const irGraph = new IRGraph(graph.id, graph.name);
    
    // Convert nodes
    for (const [nodeId, node] of graph.nodes) {
      const irNode: IRNode = {
        id: node.id,
        operation: node.type,
        inputs: node.inputs.map(port => ({
          id: port.id,
          name: port.name,
          type: port.type,
          direction: port.direction
        })),
        outputs: node.outputs.map(port => ({
          id: port.id,
          name: port.name,
          type: port.type,
          direction: port.direction
        })),
        properties: node.properties
      };
      irGraph.addNode(irNode);
    }
    
    // Convert connections
    for (const [connId, connection] of graph.connections) {
      const irConnection: IRConnection = {
        id: connection.id,
        sourceNodeId: connection.sourceNodeId,
        sourcePortId: connection.sourcePortId,
        targetNodeId: connection.targetNodeId,
        targetPortId: connection.targetPortId
      };
      irGraph.addConnection(irConnection);
    }
    
    return irGraph;
  }
  
  // Compile intermediate representation to runtime graph
  compileToRuntime(irGraph: IRGraph): RuntimeGraph {
    const runtimeGraph = new RuntimeGraph(irGraph.id, irGraph.name);
    
    // Convert nodes with default execution functions
    for (const [nodeId, node] of irGraph.nodes) {
      const runtimeNode: RuntimeNode = {
        id: node.id,
        execute: this.createExecutionFunction(node.operation),
        inputs: node.inputs.map(port => ({
          id: port.id,
          name: port.name,
          type: port.type,
          direction: port.direction
        })),
        outputs: node.outputs.map(port => ({
          id: port.id,
          name: port.name,
          type: port.type,
          direction: port.direction
        })),
        properties: node.properties
      };
      runtimeGraph.addNode(runtimeNode);
    }
    
    // Convert connections
    for (const [connId, connection] of irGraph.connections) {
      const runtimeConnection: RuntimeConnection = {
        id: connection.id,
        sourceNodeId: connection.sourceNodeId,
        sourcePortId: connection.sourcePortId,
        targetNodeId: connection.targetNodeId,
        targetPortId: connection.targetPortId
      };
      runtimeGraph.addConnection(runtimeConnection);
    }
    
    return runtimeGraph;
  }
  
  // Compile graph directly to runtime graph (convenience method)
  compile(graph: Graph): RuntimeGraph {
    const irGraph = this.compileToIR(graph);
    return this.compileToRuntime(irGraph);
  }
  
  // Create execution function based on operation type
  private createExecutionFunction(operation: string): (inputs: any) => any {
    switch (operation) {
      case 'MathAdd':
        return (inputs: any) => {
          const a = inputs.a !== undefined ? inputs.a : 0;
          const b = inputs.b !== undefined ? inputs.b : 0;
          return a + b;
        };
      case 'MathSubtract':
        return (inputs: any) => {
          const a = inputs.a !== undefined ? inputs.a : 0;
          const b = inputs.b !== undefined ? inputs.b : 0;
          return a - b;
        };
      case 'MathMultiply':
        return (inputs: any) => {
          const a = inputs.a !== undefined ? inputs.a : 0;
          const b = inputs.b !== undefined ? inputs.b : 0;
          return a * b;
        };
      case 'MathDivide':
        return (inputs: any) => {
          const a = inputs.a !== undefined ? inputs.a : 0;
          const b = inputs.b !== undefined ? inputs.b : 0;
          return b !== 0 ? a / b : 0;
        };
      case 'VariableGet':
        return (inputs: any) => {
          // Retrieve the variable value from execution state
          return inputs.variableName ? inputs.scope?.getVariable(inputs.variableName) : inputs.defaultValue;
        };
      case 'VariableSet':
        return (inputs: any) => {
          // Set the variable value in execution state
          if (inputs.variableName && inputs.scope) {
            inputs.scope.setVariable(inputs.variableName, inputs.value);
          }
          return inputs.value;
        };
      case 'VariableDeclaration':
        return (inputs: any) => {
          // Declare a variable in execution state
          if (inputs.variableName && inputs.scope) {
            inputs.scope.declareVariable(inputs.variableName, inputs.variableType, inputs.initialValue);
          }
          return inputs.initialValue;
        };
      case 'EventTrigger':
        return (inputs: any) => {
          // Trigger an event in execution state
          if (inputs.eventName && inputs.scope) {
            inputs.scope.triggerEvent(inputs.eventName, inputs.data);
          }
          return null;
        };
      case 'EventListener':
        return (inputs: any) => {
          // Register event listener in execution state
          if (inputs.eventName && inputs.scope) {
            inputs.scope.addEventListener(inputs.eventName, inputs.handler);
          }
          return null;
        };
      case 'FunctionDefinition':
        return (inputs: any) => {
          // Define a function in execution state
          if (inputs.functionName && inputs.scope) {
            inputs.scope.defineFunction(inputs.functionName, inputs.funcBody);
          }
          return null;
        };
      case 'FunctionCall':
        return (inputs: any) => {
          // Call a function in execution state
          if (inputs.functionName && inputs.scope) {
            return inputs.scope.callFunction(inputs.functionName, inputs.params);
          }
          return null;
        };
      case 'Condition':
        return (inputs: any) => {
          // Evaluate condition and return appropriate result
          const conditionResult = inputs.condition !== undefined ? !!inputs.condition : true;
          if (conditionResult) {
            return { result: inputs.input, execTrue: true, execFalse: false };
          } else {
            return { result: null, execTrue: false, execFalse: true };
          }
        };
      case 'LogicOperation':
        return (inputs: any) => {
          const a = inputs.a !== undefined ? !!inputs.a : false;
          const b = inputs.b !== undefined ? !!inputs.b : false;
          
          switch (inputs.operation) {
            case 'AND':
              return a && b;
            case 'OR':
              return a || b;
            case 'NOT':
              return !a;
            case 'XOR':
              return a !== b;
            default:
              return false;
          }
        };
      case 'ForLoop':
        return (inputs: any) => {
          const start = inputs.start !== undefined ? inputs.start : inputs.startIndex;
          const end = inputs.end !== undefined ? inputs.end : inputs.endIndex;
          
          // Execute loop body for each iteration
          for (let i = start; i < end; i++) {
            // In a real implementation, we would execute the body connection for each iteration
            // Here we just return the final index
          }
          return { index: end - 1, completed: true };
        };
      case 'WhileLoop':
        return (inputs: any) => {
          const condition = inputs.condition !== undefined ? inputs.condition : true;
          
          // Execute loop body while condition is true
          let iterations = 0;
          while (condition && iterations < 1000) { // Prevent infinite loops
            // In a real implementation, we would execute the body connection
            iterations++;
          }
          
          return { completed: true };
        };
      case 'LoopBreak':
        return (inputs: any) => {
          // Break out of the current loop
          return null;
        };
      default:
        return (inputs: any) => {
          // Default execution function that just passes through inputs
          return inputs;
        };
    }
  }
}
