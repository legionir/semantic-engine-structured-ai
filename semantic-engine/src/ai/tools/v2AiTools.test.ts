import { ProjectIndexReader } from '../ProjectIndexReader';
import { SimulateMutationTool } from './SimulateMutationTool';
import { DetectArchitectureViolationsTool } from './DetectArchitectureViolationsTool';
import { GetGitHotspotsTool } from './GetGitHotspotsTool';
import { ProjectIndex } from '../../core/types/project-index.types';

describe('V2 AI Tools (Simulate Mutation, Architecture Violations, Git Hotspots)', () => {
  const sampleIndex = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    files: [
      { id: 'f1', path: 'src/auth.service.ts', hash: 'h1', size: 100, language: 'typescript' },
      { id: 'f2', path: 'src/user.repo.ts', hash: 'h2', size: 80, language: 'typescript' },
    ],
    symbols: [
      { id: 's1', fileId: 'f1', parentId: null, kind: 'class', name: 'AuthService', line: 1, endLine: 20 },
      { id: 's2', fileId: 'f2', parentId: null, kind: 'class', name: 'UserRepo', line: 1, endLine: 15 },
    ],
    graphs: {
      dependencyGraph: [
        { from: 's1', to: 's2', kind: 'import', provenance: { confidence: 100, basis: 'resolved', extractor: 'tree-sitter' } },
      ],
      callGraph: [],
      typeGraph: [],
    },
  } as unknown as ProjectIndex;

  const reader = new ProjectIndexReader(sampleIndex);

  it('simulate_mutation detects broken references on symbol deletion', async () => {
    const tool = new SimulateMutationTool(reader);
    const result = await tool.execute({
      actionType: 'delete_symbol',
      targetSymbolId: 's2',
    });

    expect(result.success).toBe(true);
    expect(result.items.length).toBe(1);
    expect(result.items[0]?.name).toBe('s1');
  });

  it('detect_architecture_violations analyzes project rules', async () => {
    const tool = new DetectArchitectureViolationsTool(reader);
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    expect(result.context).toContain('Found');
  });

  it('get_git_hotspots identifies hotspots from repository files', async () => {
    const tool = new GetGitHotspotsTool(reader);
    const result = await tool.execute({ limit: 5 });

    expect(result.success).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });
});
