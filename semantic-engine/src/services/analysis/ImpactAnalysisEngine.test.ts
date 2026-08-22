import { ImpactAnalysisEngine } from './ImpactAnalysisEngine';
import { AnalysisGraph } from './AnalysisGraph';

describe('ImpactAnalysisEngine (V2 Blast Radius & Risk Estimation)', () => {
  it('computes 3-tier impact and risk score for a modified symbol', () => {
    const graph = new AnalysisGraph();

    // Setup dependency chain: Controller -> Service -> Repo
    graph.addNode({ id: 'AuthController', type: 'class', label: 'AuthController', metadata: { path: 'src/auth.controller.ts' } });
    graph.addNode({ id: 'AuthService', type: 'class', label: 'AuthService', metadata: { path: 'src/auth.service.ts' } });
    graph.addNode({ id: 'UserRepo', type: 'class', label: 'UserRepo', metadata: { path: 'src/user.repo.ts' } });
    graph.addNode({ id: 'AuthTest', type: 'test', label: 'AuthTest', metadata: { path: 'src/auth.test.ts' } });

    graph.addEdge({ id: 'e1', source: 'AuthController', target: 'AuthService', relation: 'calls', metadata: { confidence: 100 } });
    graph.addEdge({ id: 'e2', source: 'AuthService', target: 'UserRepo', relation: 'calls', metadata: { confidence: 100 } });
    graph.addEdge({ id: 'e3', source: 'AuthTest', target: 'AuthService', relation: 'references', metadata: { confidence: 100 } });

    const engine = new ImpactAnalysisEngine();
    const result = engine.analyzeImpact(graph, 'UserRepo', 3);

    expect(result.rootSymbolId).toBe('UserRepo');
    expect(result.blastRadius.directDependentsCount).toBe(1); // AuthService
    expect(result.blastRadius.transitiveDependentsCount).toBe(2); // AuthController, AuthTest
    expect(result.blastRadius.affectedApisCount).toBe(1); // AuthController
    expect(result.blastRadius.affectedTestsCount).toBe(1); // AuthTest
    expect(result.riskScore).toBeGreaterThan(0);
  });
});
