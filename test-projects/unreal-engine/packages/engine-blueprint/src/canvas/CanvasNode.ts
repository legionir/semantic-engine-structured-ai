// Canvas Node Rendering for Blueprint Editor
import { INode } from '../GraphModel';

export class CanvasNode {
  node: INode;
  isSelected: boolean = false;
  
  constructor(node: INode) {
    this.node = node;
  }
  
  draw(ctx: CanvasRenderingContext2D): void {
    // Draw node rectangle
    ctx.fillStyle = this.isSelected ? '#007bff' : '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.fillRect(this.node.position.x, this.node.position.y, 200, 100);
    ctx.strokeRect(this.node.position.x, this.node.position.y, 200, 100);
    
    // Draw node header
    ctx.fillStyle = '#007bff';
    ctx.fillRect(this.node.position.x, this.node.position.y, 200, 20);
    
    // Draw node title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(this.node.type, this.node.position.x + 100, this.node.position.y + 14);
    ctx.textAlign = 'left';
    
    // Draw input ports
    this.node.inputs.forEach((port, index) => {
      const portY = this.node.position.y + 30 + index * 30;
      // Draw port circle
      ctx.beginPath();
      ctx.arc(this.node.position.x, portY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#0f0';
      ctx.fill();
      
      // Draw port label
      ctx.fillStyle = '#000';
      ctx.font = '12px Arial';
      ctx.fillText(port.name, this.node.position.x + 10, portY + 4);
    });
    
    // Draw output ports
    this.node.outputs.forEach((port, index) => {
      const portY = this.node.position.y + 30 + index * 30;
      // Draw port circle
      ctx.beginPath();
      ctx.arc(this.node.position.x + 200, portY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#f00';
      ctx.fill();
      
      // Draw port label aligned right
      ctx.textAlign = 'right';
      ctx.fillStyle = '#000';
      ctx.font = '12px Arial';
      ctx.fillText(port.name, this.node.position.x + 190, portY + 4);
      ctx.textAlign = 'left'; // Reset alignment
    });
  }
  
  isPointInside(x: number, y: number): boolean {
    return (
      x >= this.node.position.x && 
      x <= this.node.position.x + 200 && 
      y >= this.node.position.y && 
      y <= this.node.position.y + 100
    );
  }
}