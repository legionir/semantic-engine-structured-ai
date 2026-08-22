// Entity/Component Access Nodes for Blueprint System

import { INode } from '../GraphModel';

// Node for getting an entity by ID
export interface GetEntityNode extends INode {
  type: 'GetEntity';
  properties: {
    entityId: string;
  };
}

// Node for getting a component from an entity
export interface GetComponentNode extends INode {
  type: 'GetComponent';
  properties: {
    componentName: string;
  };
}

// Node for setting a component on an entity
export interface SetComponentNode extends INode {
  type: 'SetComponent';
  properties: {
    componentName: string;
  };
}

// Node for creating a new entity
export interface CreateEntityNode extends INode {
  type: 'CreateEntity';
  properties: {
    entityType?: string;
  };
}

// Factory function to create a GetEntity node
export function createGetEntityNode(id: string, name: string, entityId: string): GetEntityNode {
  return {
    id,
    type: 'GetEntity',
    position: { x: 0, y: 0 },
    inputs: [
      { id: `${id}-in-entityId`, name: 'entityId', type: 'string', direction: 'input' }
    ],
    outputs: [
      { id: `${id}-out-entity`, name: 'entity', type: 'EntityRef', direction: 'output' }
    ],
    properties: {
      entityId
    }
  };
}

// Factory function to create a GetComponent node
export function createGetComponentNode(id: string, name: string, componentName: string): GetComponentNode {
  return {
    id,
    type: 'GetComponent',
    position: { x: 0, y: 0 },
    inputs: [
      { id: `${id}-in-entity`, name: 'entity', type: 'EntityRef', direction: 'input' }
    ],
    outputs: [
      { id: `${id}-out-component`, name: 'component', type: componentName, direction: 'output' }
    ],
    properties: {
      componentName
    }
  };
}

// Factory function to create a SetComponent node
export function createSetComponentNode(id: string, name: string, componentName: string): SetComponentNode {
  return {
    id,
    type: 'SetComponent',
    position: { x: 0, y: 0 },
    inputs: [
      { id: `${id}-in-entity`, name: 'entity', type: 'EntityRef', direction: 'input' },
      { id: `${id}-in-component`, name: 'component', type: componentName, direction: 'input' }
    ],
    outputs: [
      { id: `${id}-out-entity`, name: 'entity', type: 'EntityRef', direction: 'output' }
    ],
    properties: {
      componentName
    }
  };
}

// Factory function to create a CreateEntity node
export function createCreateEntityNode(id: string, name: string, entityType?: string): CreateEntityNode {
  return {
    id,
    type: 'CreateEntity',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [
      { id: `${id}-out-entity`, name: 'entity', type: 'EntityRef', direction: 'output' }
    ],
    properties: {
      entityType: entityType || 'Default'
    }
  };
}
