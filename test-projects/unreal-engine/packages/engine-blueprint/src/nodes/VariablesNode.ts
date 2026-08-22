// Variables Node Implementation for Blueprint System

import { INode } from '../GraphModel';

// Node for getting a variable value
export interface VariableGetNode extends INode {
  type: 'VariableGet';
  properties: {
    variableName: string;
    defaultValue: any;
  };
}

// Node for setting a variable value
export interface VariableSetNode extends INode {
  type: 'VariableSet';
  properties: {
    variableName: string;
  };
}

// Node for declaring a variable
export interface VariableDeclarationNode extends INode {
  type: 'VariableDeclaration';
  properties: {
    variableName: string;
    variableType: string; // 'float', 'int', 'bool', 'string', 'Vector3', etc.
    initialValue: any;
  };
}

// Factory function to create a VariableGet node
export function createVariableGetNode(id: string, name: string, variableName: string, defaultValue: any = null): VariableGetNode {
  return {
    id,
    type: 'VariableGet',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [
      { id: `${id}-out-value`, name: 'value', type: 'any', direction: 'output' }
    ],
    properties: {
      variableName,
      defaultValue
    }
  };
}

// Factory function to create a VariableSet node
export function createVariableSetNode(id: string, name: string, variableName: string): VariableSetNode {
  return {
    id,
    type: 'VariableSet',
    position: { x: 0, y: 0 },
    inputs: [
      { id: `${id}-in-variable`, name: 'variable', type: 'any', direction: 'input' },
      { id: `${id}-in-value`, name: 'value', type: 'any', direction: 'input' }
    ],
    outputs: [],
    properties: {
      variableName
    }
  };
}

// Factory function to create a VariableDeclaration node
export function createVariableDeclarationNode(id: string, name: string, variableName: string, variableType: string, initialValue: any = null): VariableDeclarationNode {
  return {
    id,
    type: 'VariableDeclaration',
    position: { x: 0, y: 0 },
    inputs: [
      { id: `${id}-in-initialValue`, name: 'initialValue', type: variableType, direction: 'input' }
    ],
    outputs: [
      { id: `${id}-out-declaration`, name: 'declaration', type: variableType, direction: 'output' }
    ],
    properties: {
      variableName,
      variableType,
      initialValue
    }
  };
}
