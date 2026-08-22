export enum NodeStatus {
  SUCCESS,
  FAILURE,
  RUNNING
}

class BehaviorTreeNode {
  name: string;
  
  constructor(name: string) {
    this.name = name;
  }
  
  evaluate(): NodeStatus {
    return NodeStatus.FAILURE;
  }
}

export class SequenceNode extends BehaviorTreeNode {
  children: BehaviorTreeNode[] = [];
  
  constructor(name: string) {
    super(name);
  }
  
  addChild(node: BehaviorTreeNode): void {
    this.children.push(node);
  }
  
  evaluate(): NodeStatus {
    for (const child of this.children) {
      const status = child.evaluate();
      if (status === NodeStatus.FAILURE) {
        return NodeStatus.FAILURE;
      }
      if (status === NodeStatus.RUNNING) {
        return NodeStatus.RUNNING;
      }
    }
    return NodeStatus.SUCCESS;
  }
}

export class SelectorNode extends BehaviorTreeNode {
  children: BehaviorTreeNode[] = [];
  
  constructor(name: string) {
    super(name);
  }
  
  addChild(node: BehaviorTreeNode): void {
    this.children.push(node);
  }
  
  evaluate(): NodeStatus {
    for (const child of this.children) {
      const status = child.evaluate();
      if (status === NodeStatus.SUCCESS) {
        return NodeStatus.SUCCESS;
      }
      if (status === NodeStatus.RUNNING) {
        return NodeStatus.RUNNING;
      }
    }
    return NodeStatus.FAILURE;
  }
}

export class BehaviorTree {
  root: BehaviorTreeNode;
  
  constructor(root: BehaviorTreeNode) {
    this.root = root;
  }
  
  tick(): NodeStatus {
    return this.root.evaluate();
  }
}