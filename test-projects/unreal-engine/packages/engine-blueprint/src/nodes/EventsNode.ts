// Events Node Implementation for Blueprint System

import { INode } from '../GraphModel';

// Node for triggering an event
export interface EventTriggerNode extends INode {
  type: 'EventTrigger';
  properties: {
    eventName: string;
    eventData: any;
  };
}

// Node for listening to an event
export interface EventListenerNode extends INode {
  type: 'EventListener';
  properties: {
    eventName: string;
  };
}

// Factory function to create an EventTrigger node
export function createEventTriggerNode(id: string, name: string, eventName: string, eventData: any = null): EventTriggerNode {
  return {
    id,
    type: 'EventTrigger',
    position: { x: 0, y: 0 },
    inputs: [
      { id: `${id}-in-data`, name: 'data', type: 'any', direction: 'input' }
    ],
    outputs: [],
    properties: {
      eventName,
      eventData
    }
  };
}

// Factory function to create an EventListener node
export function createEventListenerNode(id: string, name: string, eventName: string): EventListenerNode {
  return {
    id,
    type: 'EventListener',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [
      { id: `${id}-out-data`, name: 'data', type: 'any', direction: 'output' }
    ],
    properties: {
      eventName
    }
  };
}
