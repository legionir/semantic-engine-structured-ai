// Math Operation Nodes for Blueprint System

import { INode } from '../GraphModel';

// Node for performing basic math operations
export interface MathOperationNode extends INode {
  type: 'MathOperation';
  properties: {
    operation: 'Add' | 'Subtract' | 'Multiply' | 'Divide' | 'Power' | 'Modulo' | 'Min' | 'Max';
  };
}

// Node for performing advanced math operations
export interface AdvancedMathNode extends INode {
  type: 'AdvancedMath';
  properties: {
    operation: 'Sin' | 'Cos' | 'Tan' | 'ASin' | 'ACos' | 'ATan' | 'Log' | 'Exp' | 'Sqrt' | 'Abs' | 'Floor' | 'Ceil' | 'Round';
  };
}

// Node for generating random numbers
export interface RandomNumberNode extends INode {
  type: 'RandomNumber';
  properties: {
    min: number;
    max: number;
  };
}

// Factory function to create a MathOperation node
export function createMathOperationNode(id: string, name: string, operation: 'Add' | 'Subtract' | 'Multiply' | 'Divide' | 'Power' | 'Modulo' | 'Min' | 'Max'): MathOperationNode {
  const inputs = operation === 'Power' ? [
    { id: `${id}-in-a`, name: 'A', type: 'float', direction: 'input' },
    { id: `${id}-in-b`, name: 'B', type: 'float', direction: 'input' }
  ] : [
    { id: `${id}-in-a`, name: 'A', type: 'float', direction: 'input' },
    { id: `${id}-in-b`, name: 'B', type: 'float', direction: 'input' }
  ];
  
  return {
    id,
    type: 'MathOperation',
    position: { x: 0, y: 0 },
    inputs,
    outputs: [
      { id: `${id}-out-result`, name: 'Result', type: 'float', direction: 'output' }
    ],
    properties: {
      operation
    }
  };
}

// Factory function to create an AdvancedMath node
export function createAdvancedMathNode(id: string, name: string, operation: 'Sin' | 'Cos' | 'Tan' | 'ASin' | 'ACos' | 'ATan' | 'Log' | 'Exp' | 'Sqrt' | 'Abs' | 'Floor' | 'Ceil' | 'Round'): AdvancedMathNode {
  return {
    id,
    type: 'AdvancedMath',
    position: { x: 0, y: 0 },
    inputs: [
      { id: `${id}-in-value`, name: 'Value', type: 'float', direction: 'input' }
    ],
    outputs: [
      { id: `${id}-out-result`, name: 'Result', type: 'float', direction: 'output' }
    ],
    properties: {
      operation
    }
  };
}

// Factory function to create a RandomNumber node
export function createRandomNumberNode(id: string, name: string, min: number = 0, max: number = 1): RandomNumberNode {
  return {
    id,
    type: 'RandomNumber',
    position: { x: 0, y: 0 },
    inputs: [
      { id: `${id}-in-min`, name: 'Min', type: 'float', direction: 'input' },
      { id: `${id}-in-max`, name: 'Max', type: 'float', direction: 'input' }
    ],
    outputs: [
      { id: `${id}-out-result`, name: 'Result', type: 'float', direction: 'output' }
    ],
    properties: {
      min,
      max
    }
  };
}