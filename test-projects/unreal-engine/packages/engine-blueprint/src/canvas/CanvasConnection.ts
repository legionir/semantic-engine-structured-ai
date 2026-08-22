// Canvas Connection Drawing for Blueprint Editor
import { IConnection } from '../GraphModel';

export class CanvasConnection {
  connection: IConnection;
  
  constructor(connection: IConnection) {
    this.connection = connection;
  }
  
  draw(ctx: CanvasRenderingContext2D, nodesMap: Map<string, any>): void {
    const sourceNode = nodesMap.get(this.connection.sourceNodeId);
    const targetNode = nodesMap.get(this.connection.targetNodeId);
    
    if (!sourceNode || !targetNode) {
      console.warn(`Nodes for connection ${this.connection.id} not found.`);
      return;
    }
    
    const sourcePort = sourceNode.node.outputs.find((p: any) => p.id === this.connection.sourcePortId);
    const targetPort = targetNode.node.inputs.find((p: any) => p.id === this.connection.targetPortId);
    
    if (!sourcePort || !targetPort) {
      console.warn(`Ports for connection ${this.connection.id} not found.`);
      return;
    }
    
    // Calculate port positions
    const sourceX = sourceNode.node.position.x + 200; // Right side of source node
    const sourceY = sourceNode.node.position.y + 30 + sourceNode.node.outputs.indexOf(sourcePort) * 30;
    const targetX = targetNode.node.position.x; // Left side of target node
    const targetY = targetNode.node.position.y + 30 + targetNode.node.inputs.indexOf(targetPort) * 30;
    
    // Draw the connection line
    ctx.beginPath();
    ctx.moveTo(sourceX, sourceY);
    
    // Create a curved line
    const cpx1 = sourceX + Math.abs(targetX - sourceX) / 2;
    const cpy1 = sourceY;
    const cpx2 = targetX - Math.abs(targetX - sourceX) / 2;
    const cpy2 = targetY;
    
    ctx.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, targetX, targetY);
    
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}