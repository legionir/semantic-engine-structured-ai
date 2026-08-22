// Main Canvas Component for Blueprint Editor
import { Graph } from '../GraphModel';

export class CanvasMain {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  graph: Graph;
  
  constructor(containerId: string, graph: Graph) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element with id '${containerId}' not found.`);
    }
    
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.width = this.canvas.offsetWidth;
    this.canvas.height = this.canvas.offsetHeight;
    
    container.appendChild(this.canvas);
    
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get 2D context');
    }
    this.ctx = ctx;
    
    this.graph = graph;
    
    this.setupEventListeners();
  }
  
  private setupEventListeners(): void {
    // Setup mouse/touch event listeners for drag & drop functionality
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    
    // Touch events for mobile support
    this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this));
    this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this));
    this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this));
  }
  
  private handleMouseDown(event: MouseEvent): void {
    // Handle mouse down on canvas
  }
  
  private handleMouseMove(event: MouseEvent): void {
    // Handle mouse movement on canvas
  }
  
  private handleMouseUp(event: MouseEvent): void {
    // Handle mouse up on canvas
  }
  
  private handleTouchStart(event: TouchEvent): void {
    // Handle touch start on canvas
  }
  
  private handleTouchMove(event: TouchEvent): void {
    // Handle touch movement on canvas
  }
  
  private handleTouchEnd(event: TouchEvent): void {
    // Handle touch end on canvas
  }
  
  render(): void {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Render grid
    this.renderGrid();
    
    // Render connections
    this.renderConnections();
    
    // Render nodes
    this.renderNodes();
  }
  
  private renderGrid(): void {
    // Render grid pattern on canvas
    const gridSize = 20;
    this.ctx.strokeStyle = '#e0e0e0';
    this.ctx.lineWidth = 0.5;
    
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    // Vertical lines
    for (let x = 0; x <= width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
      this.ctx.stroke();
    }
    
    // Horizontal lines
    for (let y = 0; y <= height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(width, y);
      this.ctx.stroke();
    }
  }
  
  private renderConnections(): void {
    // Render all connections in the graph
    for (const connection of this.graph.connections.values()) {
      const sourceNode = this.graph.getNode(connection.sourceNodeId);
      const targetNode = this.graph.getNode(connection.targetNodeId);
      
      if (sourceNode && targetNode) {
        const sourcePort = sourceNode.outputs.find(p => p.id === connection.sourcePortId);
        const targetPort = targetNode.inputs.find(p => p.id === connection.targetPortId);
        
        if (sourcePort && targetPort) {
          this.drawConnection(
            sourceNode.position.x + 200, 
            sourceNode.position.y + 40 + sourceNode.outputs.indexOf(sourcePort) * 30,
            targetNode.position.x,
            targetNode.position.y + 40 + targetNode.inputs.indexOf(targetPort) * 30
          );
        }
      }
    }
  }
  
  private drawConnection(startX: number, startY: number, endX: number, endY: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(startX, startY);
    
    // Calculate control points for bezier curve
    const cpx1 = startX + (endX - startX) / 2;
    const cpy1 = startY;
    const cpx2 = startX + (endX - startX) / 2;
    const cpy2 = endY;
    
    this.ctx.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, endX, endY);
    
    this.ctx.strokeStyle = '#666';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
  }
  
  private renderNodes(): void {
    // Render all nodes in the graph
    for (const node of this.graph.nodes.values()) {
      this.renderNode(node);
    }
  }
  
  private renderNode(node: any): void {
    // Draw node rectangle
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(node.position.x, node.position.y, 200, 100);
    
    // Draw node border
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(node.position.x, node.position.y, 200, 100);
    
    // Draw node title
    this.ctx.fillStyle = '#000';
    this.ctx.font = 'bold 14px Arial';
    this.ctx.fillText(node.type, node.position.x + 10, node.position.y + 20);
    
    // Draw input ports
    node.inputs.forEach((port: any, index: number) => {
      const portY = node.position.y + 40 + index * 30;
      this.ctx.fillStyle = '#0f0';
      this.ctx.fillRect(node.position.x - 5, portY - 5, 10, 10);
      
      // Draw port label
      this.ctx.fillStyle = '#000';
      this.ctx.font = '12px Arial';
      this.ctx.fillText(port.name, node.position.x + 5, portY + 4);
    });
    
    // Draw output ports
    node.outputs.forEach((port: any, index: number) => {
      const portY = node.position.y + 40 + index * 30;
      this.ctx.fillStyle = '#f00';
      this.ctx.fillRect(node.position.x + 195, portY - 5, 10, 10);
      
      // Draw port label aligned right
      this.ctx.textAlign = 'right';
      this.ctx.fillStyle = '#000';
      this.ctx.font = '12px Arial';
      this.ctx.fillText(port.name, node.position.x + 195, portY + 4);
      this.ctx.textAlign = 'left'; // Reset alignment
    });
  }
}