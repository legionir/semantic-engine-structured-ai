// Functions Node Implementation for Blueprint System

import { INode } from '../GraphModel';

// Node for defining a function
export interface FunctionDefinitionNode extends INode {
  type: 'FunctionDefinition';
  properties: {
    functionName: string;
    returnType: string;
    parameters: Array<{ name: string; type: string }>;
  };
}

// Node for calling a function
export interface FunctionCallNode extends INode {
  type: 'FunctionCall';
  properties: {
    functionName: string;
  };
}

// Factory function to create a FunctionDefinition node
export function createFunctionDefinitionNode(id: string, name: string, functionName: string, returnType: string, parameters: Array<{ name: string; type: string }> = []): FunctionDefinitionNode {
  const inputs = parameters.map((param, index) => ({
    id: `${id}-in-${param.name}`,
    name: param.name,
    type: param.type,
    direction: 'input' as const
  }));
  
  return {
    id,
    type: 'FunctionDefinition',
    position: { x: 0, y: 0 },
    inputs,
    outputs: [
      { id: `${id}-out-return`, name: 'return', type: returnType, direction: 'output' }
    ],
    properties: {
      functionName,
      returnType,
      parameters
    }
  };
}

// Factory function to create a FunctionCall node
export function createFunctionCallNode(id: string, name: string, functionName: string, parameters: Array<{ name: string; type: string }> = []): FunctionCallNode {
  const inputs = parameters.map((param, index) => ({
    id: `${id}-in-${param.name}`,
    name: param.name,
    type: param.type,
    direction: 'input' as const
  }));
  
  inputs.push({
    id: `${id}-in-execute`,
    name: 'execute',
    type: 'exec',
    direction: 'input'
  });
  
  return {
    id,
    type: 'FunctionCall',
    position: { x: 0, y: 0 },
    inputs,
    outputs: [
      { id: `${id}-out-return`, name: 'return', type: 'any', direction: 'output' },
      { id: `${id}-out-completed`, name: 'completed', type: 'exec', direction: 'output' }
    ],
    properties: {
      functionName
    }
  };
}