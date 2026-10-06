import { ArchitectureRuleEngine } from './ArchitectureRuleEngine';
import { AnalysisGraph } from './AnalysisGraph';

describe('ArchitectureRuleEngine (V2 Cycles & Layer Violations)', () => {
  it('detects circular dependencies using Tarjan SCC algorithm', () => {
    const graph = new AnalysisGraph();

    // Setup cycle: A -> B -> C -> A
    graph.addNode({ id: 'modA', type: 'module', label: 'modA' });
    graph.addNode({ id: 'modB', type: 'module', label: 'modB' });
    graph.addNode({ id: 'modC', type: 'module', label: 'modC' });

    graph.addEdge({ id: 'e1', source: 'modA', target: 'modB', relation: 'imports' });
    graph.addEdge({ id: 'e2', source: 'modB', target: 'modC', relation: 'imports' });
    graph.addEdge({ id: 'e3', source: 'modC', target: 'modA', relation: 'imports' });

    const engine = new ArchitectureRuleEngine();
    const cycles = engine.findCircularDependencies(graph);

    expect(cycles.length).toBe(1);
    expect(cycles[0]?.cycleLength).toBe(3);
  });

  it('detects architectural layer bypassing violations', () => {
    const graph = new AnalysisGraph();

    // Violation: Controller directly invokes Repository
    graph.addNode({ id: 'PaymentController', type: 'class', label: 'PaymentController' });
    graph.addNode({ id: 'PaymentRepository', type: 'class', label: 'PaymentRepository' });

    graph.addEdge({ id: 'e1', source: 'PaymentController', target: 'PaymentRepository', relation: 'calls' });

    const engine = new ArchitectureRuleEngine();
    const violations = engine.detectLayerViolations(graph);

    expect(violations.length).toBe(1);
    expect(violations[0]?.ruleId).toBe('ARCH-001');
    expect(violations[0]?.severity).toBe('error');
  });

  // F-0017 regression: in the real index node ids are opaque hex; the readable
  // path lives in metadata.path. Layer rules must match on the path, not the id.
  it('detects layer violations when node ids are opaque hex (real buildIndexGraph shape)', () => {
    const graph = new AnalysisGraph();

    graph.addNode({ id: 'a1b2c3d4e5f60718', type: 'file', label: 'src/web/payment.controller.ts', metadata: { path: 'src/web/payment.controller.ts' } });
    graph.addNode({ id: '1122334455667788', type: 'file', label: 'src/data/payment.repository.ts', metadata: { path: 'src/data/payment.repository.ts' } });

    graph.addEdge({ id: 'e1', source: 'a1b2c3d4e5f60718', target: '1122334455667788', relation: 'imports' });

    const engine = new ArchitectureRuleEngine();
    const violations = engine.detectLayerViolations(graph);

    expect(violations.length).toBe(1);
    expect(violations[0]?.ruleId).toBe('ARCH-001');
  });
});
