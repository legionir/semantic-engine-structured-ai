// Loops Node Implementation for Blueprint System

import { INode } from '../GraphModel';

// Node for a for loop
export interface ForLoopNode extends INode {
  type: 'ForLoop';
  properties: {
    startIndex: number;
    endIndex: number;
  };
}

// Node for a while loop
export interface WhileLoopNode extends INode {
  type: 'WhileLoop';
  properties: {
    conditionExpression: string;
  };
}

// Node for breaking out of a loop
export interface LoopBreakNode extends INode {
  type: 'LoopBreak';
  properties: {};
}

// Factory function to create a ForLoop node
export function createForLoopNode(id: string, name: string, startIndex: number = 0, endIndex: number = 10): ForLoopNode {
  return {
    id,
    type: 'ForLoop',
    position: { x: 0, y: 0 },
    inputs: [
      { id: `${id}-in-start`, name: 'start', type: 'int', direction: 'input' },
      { id: `${id}-in-end`, name: 'end', type: 'int', direction: 'input' },
      { id: `${id}-in-execute`, name: 'execute', type: 'exec', direction: 'input' }
    ],
    outputs: [
      { id: `${id}-out-body`, name: 'body', type: 'exec', direction: 'output' },
      { id: `${id}-out-completed`, name: 'completed', type: 'exec', direction: 'output' },
      { id: `${id}-out-index`, name: 'index', type: 'int', direction: 'output' }
    ],
    properties: {
      startIndex,
      endIndex
    }
  };
}

// Factory function to create a WhileLoop node
export function createWhileLoopNode(id: string, name: string, conditionExpression: string = 'true'): WhileLoopNode {
  return {
    id,
    type: 'WhileLoop',
    position: { x: 0, y: 0 },
    inputs: [
      { id: `${id}-in-condition`, name: 'condition', type: 'bool', direction: 'input' },
      { id: `${id}-in-execute`, name: 'execute', type: 'exec', direction: 'input' }
    ],
    outputs: [
      { id: `${id}-out-body`, name: 'body', type: 'exec', direction: 'output' },
      { id: `${id}-out-completed`, name: 'completed', type: 'exec', direction: 'output' }
    ],
    properties: {
      conditionExpression
    }
  };
}

// Factory function to create a LoopBreak node
export function createLoopBreakNode(id: string, name: string): LoopBreakNode {
  return {
    id,
    type: 'LoopBreak',
    position: { x: 0, y: 0 },
    inputs: [
      { id: `${id}-in-break`, name: 'break', type: 'exec', direction: 'input' }
    ],
    outputs: [],
    properties: {}
  };
}
