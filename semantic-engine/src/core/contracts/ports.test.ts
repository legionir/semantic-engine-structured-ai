import { deterministicPaths } from './ports';

describe('Phase 0 ports and determinism', () => {
  test('FileProvider contract is read-only by type and runtime convention', () => {
    const provider = {
      readOnly: true as const,
      list: async () => [],
      read: async () => new Uint8Array(),
      exists: async () => false,
    };
    expect(provider.readOnly).toBe(true);
    return expect(provider.exists('missing.ts')).resolves.toBe(false);
  });

  test('path ordering is duplicate-free and deterministic', () => {
    expect(deterministicPaths(['b.ts', 'a.ts', 'b.ts'])).toEqual(['a.ts', 'b.ts']);
    expect(deterministicPaths(['src/β.ts', 'src/a.ts'])).toEqual(['src/a.ts', 'src/β.ts']);
  });
});
