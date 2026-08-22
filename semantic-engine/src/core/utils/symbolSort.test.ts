import { sortSymbolsDeterministically } from './symbolSort';
import { SymbolEntry } from '../types/project-index.types';
import { makeConfidence } from '../types/common.types';

function createSymbol(
  id: string,
  fileId: string,
  kind: SymbolEntry['kind'],
  name: string,
  line: number
): SymbolEntry {
  return {
    id,
    fileId,
    parentId: null,
    kind,
    name,
    line,
    endLine: line,
    signature: name,
    visibility: 'public',
    source: 'lsp',
    confidence: makeConfidence(80),
  } as SymbolEntry;
}

describe('sortSymbolsDeterministically', () => {
  it('should sort by fileId, then line, then kind, then name, then id', () => {
    const symbols: SymbolEntry[] = [
      createSymbol('s3', 'file-b', 'function', 'zFn', 5),
      createSymbol('s1', 'file-a', 'class', 'MyClass', 1),
      createSymbol('s2', 'file-a', 'function', 'aFn', 10),
      createSymbol('s4', 'file-a', 'function', 'aFn', 10), // same line/name, different id
    ];

    const sorted = sortSymbolsDeterministically(symbols);

    expect(sorted.map(s => s.id)).toEqual(['s1', 's2', 's4', 's3']);
  });

  it('should produce the same order on multiple runs', () => {
    const symbols: SymbolEntry[] = [
      createSymbol('s2', 'file-a', 'function', 'b', 2),
      createSymbol('s1', 'file-a', 'class', 'a', 1),
      createSymbol('s3', 'file-a', 'method', 'c', 3),
    ];

    const sorted1 = sortSymbolsDeterministically(symbols);
    const sorted2 = sortSymbolsDeterministically(symbols);

    expect(sorted1.map(s => s.id)).toEqual(sorted2.map(s => s.id));
  });
});
