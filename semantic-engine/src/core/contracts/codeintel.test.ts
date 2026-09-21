import {
  DEFAULT_CODEINTEL_CONFIG,
  LineIndex,
  canonicalJson,
  fail,
  makeHandle,
  makeSymbolKey,
  ok,
} from './codeintel';

describe('LineIndex — UTF-16, BOM and line endings', () => {
  test.each([
    ['ascii LF', 'alpha\nbeta'],
    ['CRLF', 'alpha\r\nbeta'],
    ['lone CR', 'alpha\rbeta'],
    ['BOM and Unicode', '\uFEFF🙂\nλ'],
    ['empty', ''],
    ['trailing newline', 'a\n'],
  ])('%s round-trips every decoded UTF-16 offset', (_name, input) => {
    const index = new LineIndex(input);
    for (let offset = 0; offset <= index.text.length; offset += 1) {
      expect(index.offsetAt(index.positionAt(offset))).toBe(offset);
    }
  });

  test('leading BOM is not part of the source coordinate space', () => {
    const index = new LineIndex('\uFEFF🙂');
    expect(index.text).toBe('🙂');
    expect(index.positionAt(0)).toEqual({ line: 0, character: 0 });
    expect(index.positionAt(2)).toEqual({ line: 0, character: 2 });
  });

  test('emoji character width is two UTF-16 code units', () => {
    const index = new LineIndex('a🙂b');
    expect(index.positionAt(1)).toEqual({ line: 0, character: 1 });
    expect(index.positionAt(3)).toEqual({ line: 0, character: 3 });
  });

  test.each(['\r', '\n', '\r\n'])('line separator %j is excluded from line range', (eol) => {
    const index = new LineIndex(`ab${eol}cd`);
    expect(index.offsetAt({ line: 0, character: 99 })).toBe(2);
    expect(index.positionAt(2 + eol.length)).toEqual({ line: 1, character: 0 });
  });

  test('rejects invalid offsets and positions', () => {
    const index = new LineIndex('x');
    expect(() => index.positionAt(-1)).toThrow(RangeError);
    expect(() => index.positionAt(2)).toThrow(RangeError);
    expect(() => index.offsetAt({ line: -1, character: 0 })).toThrow(RangeError);
    expect(() => index.toOffsets({ start: { line: 0, character: 1 }, end: { line: 0, character: 0 } })).toThrow(RangeError);
  });
});

describe('stable identifiers and envelopes', () => {
  test('SymbolKey follows the canonical path/name/kind format', () => {
    expect(makeSymbolKey('src/a.ts', 'A.run', 'method')).toBe('src/a.ts::A.run::method');
    expect(makeSymbolKey('src/a.ts', 'A.run', 'method', 2)).toBe('src/a.ts::A.run::method#2');
    expect(() => makeSymbolKey('', 'A', 'method')).toThrow(TypeError);
  });

  test('Handle follows the canonical range/hash format', () => {
    expect(makeHandle('src/a.ts', 10, 20, 'deadbeef')).toBe('src/a.ts:10-20#deadbeef');
    expect(() => makeHandle('src/a.ts', 20, 10, 'deadbeef')).toThrow(TypeError);
    expect(() => makeHandle('src/a.ts', 0, 1, 'DEADBEEF')).toThrow(TypeError);
  });

  test('success and failure include snapshot, trust, stats and warnings', () => {
    const success = ok('r1', 'snap-1', { value: 1 }, { stats: { resultCount: 1 }, warnings: ['truncated'] });
    const failure = fail('r2', 'snap-1', { code: 'STALE_HANDLE', message: 'stale', retryable: false });
    expect(success).toMatchObject({ ok: true, requestId: 'r1', snapshotId: 'snap-1', trust: 'untrusted-source-content', data: { value: 1 } });
    expect(success.error).toBeUndefined();
    expect(failure).toMatchObject({ ok: false, requestId: 'r2', snapshotId: 'snap-1', trust: 'untrusted-source-content', error: { code: 'STALE_HANDLE' } });
    expect(failure.data).toBeUndefined();
  });

  test('read-only disabled defaults are safe', () => {
    expect(DEFAULT_CODEINTEL_CONFIG).toEqual({ enabled: false, readOnly: true, maxFiles: 10_000, maxFileBytes: 2_000_000, timeoutMs: 30_000 });
  });

  test('canonicalJson is independent from object insertion order', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(canonicalJson({ a: { x: 3, y: 2 }, z: 1 })).toBe('{"a":{"x":3,"y":2},"z":1}');
  });
});
