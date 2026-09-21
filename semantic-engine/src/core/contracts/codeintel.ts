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

/** A single source of truth for UTF-16 offsets and all supported EOL forms. */
export class LineIndex {
  /** The indexed text is decoded and has one leading BOM removed. */
  readonly text: string;
  private readonly starts: readonly number[];
  private readonly ends: readonly number[];

  constructor(input: string) {
    this.text = input.startsWith("\uFEFF") ? input.slice(1) : input;
    const starts: number[] = [0];
    const ends: number[] = [];
    let i = 0;
    while (i < this.text.length) {
      if (this.text[i] === "\r") {
        ends.push(i);
        i += this.text[i + 1] === "\n" ? 2 : 1;
        starts.push(i);
      } else if (this.text[i] === "\n") {
        ends.push(i);
        i += 1;
        starts.push(i);
      } else {
        i += 1;
      }
    }
    ends.push(this.text.length);
    this.starts = starts;
    this.ends = ends;
  }

  get lineCount(): number { return this.starts.length; }

  offsetAt(position: Position): number {
    this.assertPosition(position);
    return Math.min(this.starts[position.line] + position.character, this.ends[position.line]);
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
    return { line, character: Math.min(offset, this.ends[line]) - this.starts[line] };
  }

  toOffsets(range: TextRange): { start: number; end: number } {
    const start = this.offsetAt(range.start);
    const end = this.offsetAt(range.end);
    if (end < start) throw new RangeError("range end precedes range start");
    return { start, end };
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

export interface SymbolIdentity {
  readonly symbolKey: SymbolKey;
  readonly signatureHash?: string;
}

export type SymbolKey = string & { readonly __symbolKey: unique symbol };
export function makeSymbolKey(
  relativePath: string,
  qualifiedName: string,
  kind: string,
  ordinal?: number,
): SymbolKey {
  if (!relativePath || !qualifiedName || !kind) throw new TypeError("symbol key parts must be non-empty");
  if (ordinal !== undefined && (!Number.isInteger(ordinal) || ordinal < 0)) {
    throw new TypeError("symbol ordinal must be a non-negative integer");
  }
  const suffix = ordinal === undefined ? "" : `#${ordinal}`;
  return `${relativePath}::${qualifiedName}::${kind}${suffix}` as SymbolKey;
}

export type Handle = string & { readonly __handle: unique symbol };
export function makeHandle(relativePath: string, start: number, end: number, hash8: string): Handle {
  if (!relativePath || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new TypeError("invalid handle range");
  }
  if (!/^[a-f0-9]{8}$/u.test(hash8)) throw new TypeError("handle hash must be eight lowercase hex characters");
  return `${relativePath}:${start}-${end}#${hash8}` as Handle;
}

export type TrustLevel = "untrusted-source-content";
export interface EnvelopeStats {
  readonly durationMs?: number;
  readonly resultCount?: number;
  readonly truncated?: boolean;
}

export interface Envelope<T> {
  readonly ok: boolean;
  readonly requestId: string;
  readonly schemaVersion: "1";
  readonly snapshotId: string;
  readonly trust: TrustLevel;
  readonly stats: EnvelopeStats;
  readonly warnings: readonly string[];
  readonly sessionId?: string;
  readonly data?: T;
  readonly error?: CodeIntelError;
}

export interface CodeIntelError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function ok<T>(requestId: string, snapshotId: string, data: T, options: Partial<Pick<Envelope<T>, "stats" | "warnings" | "sessionId">> = {}): Envelope<T> {
  return { ok: true, requestId, schemaVersion: "1", snapshotId, trust: "untrusted-source-content", stats: options.stats ?? {}, warnings: options.warnings ?? [], ...(options.sessionId ? { sessionId: options.sessionId } : {}), data };
}

export function fail<T = never>(requestId: string, snapshotId: string, error: CodeIntelError, options: Partial<Pick<Envelope<T>, "stats" | "warnings" | "sessionId">> = {}): Envelope<T> {
  return { ok: false, requestId, schemaVersion: "1", snapshotId, trust: "untrusted-source-content", stats: options.stats ?? {}, warnings: options.warnings ?? [], ...(options.sessionId ? { sessionId: options.sessionId } : {}), error };
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
