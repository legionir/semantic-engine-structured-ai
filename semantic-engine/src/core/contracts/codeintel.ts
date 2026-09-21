/** Phase 0 additive CodeIntel contracts. No filesystem or network side effects. */

export interface Position {
  readonly line: number;
  /** UTF-16 code units, as required by LSP. */
  readonly character: number;
}

export interface TextRange {
  readonly start: Position;
  readonly end: Position;
}

export class LineIndex {
  private readonly starts: readonly number[];
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
    const starts: number[] = [0];
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === "\n") starts.push(i + 1);
    }
    this.starts = starts;
  }

  get lineCount(): number { return this.starts.length; }

  offsetAt(position: Position): number {
    this.assertPosition(position);
    const lineStart = this.starts[position.line];
    const lineEnd = this.lineEnd(position.line);
    const offset = Math.min(lineStart + position.character, lineEnd);
    return offset;
  }

  positionAt(offset: number): Position {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.text.length) {
      throw new RangeError(`offset out of bounds: ${offset}`);
    }
    let low = 0;
    let high = this.starts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.starts[mid] <= offset) low = mid + 1;
      else high = mid - 1;
    }
    const line = Math.max(0, high);
    return { line, character: offset - this.starts[line] };
  }

  toOffsets(range: TextRange): { start: number; end: number } {
    const start = this.offsetAt(range.start);
    const end = this.offsetAt(range.end);
    if (end < start) throw new RangeError("range end precedes range start");
    return { start, end };
  }

  private lineEnd(line: number): number {
    const next = this.starts[line + 1];
    if (next === undefined) return this.text.length;
    // Exclude LF and a preceding CR from the logical line contents.
    return Math.max(this.starts[line], next - (this.text[next - 2] === "\r" ? 2 : 1));
  }

  private assertPosition(position: Position): void {
    if (!Number.isInteger(position.line) || !Number.isInteger(position.character)) {
      throw new RangeError("position must contain integer line and character");
    }
    if (position.line < 0 || position.line >= this.starts.length || position.character < 0) {
      throw new RangeError(`position out of bounds: ${position.line}:${position.character}`);
    }
  }
}

export type SymbolKey = string & { readonly __symbolKey: unique symbol };
export function makeSymbolKey(fileId: string, qualifiedName: string, kind: string): SymbolKey {
  if (!fileId || !qualifiedName || !kind) throw new TypeError("symbol key parts must be non-empty");
  return `${fileId}::${kind}::${qualifiedName}` as SymbolKey;
}

export type Handle = string & { readonly __handle: unique symbol };
export function makeHandle(namespace: string, id: string): Handle {
  if (!/^[a-z][a-z0-9._-]*$/u.test(namespace) || !id) throw new TypeError("invalid handle");
  return `h_${namespace}_${id}` as Handle;
}

export interface Envelope<T> {
  readonly ok: boolean;
  readonly requestId: string;
  readonly schemaVersion: "1";
  readonly data?: T;
  readonly error?: CodeIntelError;
}

export interface CodeIntelError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function ok<T>(requestId: string, data: T): Envelope<T> {
  return { ok: true, requestId, schemaVersion: "1", data };
}

export function fail<T = never>(requestId: string, error: CodeIntelError): Envelope<T> {
  return { ok: false, requestId, schemaVersion: "1", error };
}

export interface CodeIntelConfig {
  readonly enabled: boolean;
  readonly readOnly: true;
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly timeoutMs: number;
}

export const DEFAULT_CODEINTEL_CONFIG: CodeIntelConfig = Object.freeze({
  enabled: false,
  readOnly: true,
  maxFiles: 10_000,
  maxFileBytes: 2_000_000,
  timeoutMs: 30_000,
});

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, current) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return current;
    return Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  });
}
