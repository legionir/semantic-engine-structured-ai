// Conditions Node Implementation for Blueprint System

import { INode } from '../GraphModel';

// Node for conditional execution (if/else)
export interface ConditionNode extends INode {
  type: 'Condition';
  properties: {
    conditionExpression: string;
  };
}

// Node for boolean logic operations
export interface LogicOperationNode extends INode {
  type: 'LogicOperation';
  properties: {
    operation: 'AND' | 'OR' | 'NOT' | 'XOR';
  };
}

// Factory function to create a Condition node
export function createConditionNode(id: string, name: string, conditionExpression: string = 'true'): ConditionNode {
  return {
    id,
    type: 'Condition',
    position: { x: 0, y: 0 },
    inputs: [
      { id: `${id}-in-condition`, name: 'condition', type: 'bool', direction: 'input' },
      { id: `${id}-in-input`, name: 'input', type: 'any', direction: 'input' }
    ],
    outputs: [
      { id: `${id}-out-true`, name: 'true', type: 'any', direction: 'output' },
      { id: `${id}-out-false`, name: 'false', type: 'any', direction: 'output' },
      { id: `${id}-out-exec-true`, name: 'execTrue', type: 'exec', direction: 'output' },
      { id: `${id}-out-exec-false`, name: 'execFalse', type: 'exec', direction: 'output' }
    ],
    properties: {
      conditionExpression
    }
  };
}

// Factory function to create a LogicOperation node
export function createLogicOperationNode(id: string, name: string, operation: 'AND' | 'OR' | 'NOT' | 'XOR'): LogicOperationNode {
  const inputs = operation === 'NOT' ? [
    { id: `${id}-in-a`, name: 'a', type: 'bool', direction: 'input' }
  ] : [
    { id: `${id}-in-a`, name: 'a', type: 'bool', direction: 'input' },
    { id: `${id}-in-b`, name: 'b', type: 'bool', direction: 'input' }
  ];
  
  return {
    id,
    type: 'LogicOperation',
    position: { x: 0, y: 0 },
    inputs,
    outputs: [
      { id: `${id}-out-result`, name: 'result', type: 'bool', direction: 'output' }
    ],
    properties: {
      operation
    }
  };
}