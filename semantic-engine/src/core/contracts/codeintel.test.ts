import {
  DEFAULT_CODEINTEL_CONFIG,
  LineIndex,
  canonicalJson,
  fail,
  makeHandle,
  makeSymbolKey,
  ok,
} from './codeintel';

describe('LineIndex — UTF-16 and line endings', () => {
  test.each([
    ['ascii LF', 'alpha\nbeta'],
    ['CRLF', 'alpha\r\nbeta'],
    ['BOM and Unicode', '\uFEFF🙂\nλ'],
    ['empty', ''],
    ['trailing newline', 'a\n'],
  ])('%s round-trips every UTF-16 offset', (_name, text) => {
    const index = new LineIndex(text);
    for (let offset = 0; offset <= text.length; offset += 1) {
      expect(index.offsetAt(index.positionAt(offset))).toBe(offset);
    }
  });

  test('emoji character width is two UTF-16 code units', () => {
    const index = new LineIndex('a🙂b');
    expect(index.positionAt(1)).toEqual({ line: 0, character: 1 });
    expect(index.positionAt(3)).toEqual({ line: 0, character: 3 });
    expect(index.offsetAt({ line: 0, character: 3 })).toBe(3);
  });

  test('CRLF is excluded from the logical line range', () => {
    const index = new LineIndex('ab\r\ncd');
    expect(index.offsetAt({ line: 0, character: 2 })).toBe(2);
    expect(index.offsetAt({ line: 0, character: 99 })).toBe(2);
    expect(index.positionAt(4)).toEqual({ line: 1, character: 0 });
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
  test('symbol keys and handles are deterministic', () => {
    expect(makeSymbolKey('f1', 'A.run', 'method')).toBe('f1::method::A.run');
    expect(makeSymbolKey('f1', 'A.run', 'method')).toBe(makeSymbolKey('f1', 'A.run', 'method'));
    expect(makeHandle('project', 'p1')).toBe('h_project_p1');
    expect(() => makeHandle('Bad Namespace', 'x')).toThrow(TypeError);
  });

  test('success and failure are explicit and mutually exclusive', () => {
    const success = ok('r1', { value: 1 });
    const failure = fail('r2', { code: 'TIMEOUT', message: 'deadline', retryable: true });
    expect(success).toMatchObject({ ok: true, requestId: 'r1', schemaVersion: '1', data: { value: 1 } });
    expect(success.error).toBeUndefined();
    expect(failure).toMatchObject({ ok: false, requestId: 'r2', schemaVersion: '1', error: { code: 'TIMEOUT' } });
    expect(failure.data).toBeUndefined();
  });

  test('read-only disabled defaults are safe', () => {
    expect(DEFAULT_CODEINTEL_CONFIG).toEqual({
      enabled: false,
      readOnly: true,
      maxFiles: 10_000,
      maxFileBytes: 2_000_000,
      timeoutMs: 30_000,
    });
  });

  test('canonicalJson is independent from object insertion order', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(canonicalJson({ a: { x: 3, y: 2 }, z: 1 })).toBe('{"a":{"x":3,"y":2},"z":1}');
  });
});
