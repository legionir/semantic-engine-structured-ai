// Basic blueprint system tests
import { Graph, BlueprintCompiler, ExecutionEngine } from '../src/index.js';

describe('BlueprintSystem', () => {
  it('should create a graph and execute a simple node', () => {
    const graph = new Graph('test');
    expect(graph).toBeDefined();
    expect(graph.id).toBe('test');
  });

  it('should compile and execute a simple graph', () => {
    const graph = new Graph('simple');
    const compiler = new BlueprintCompiler();
    const runtimeGraph = compiler.compile(graph);
    const engine = new ExecutionEngine();
    engine.load(runtimeGraph);
    expect(engine.isLoaded()).toBe(true);
  });
});
