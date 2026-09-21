import type { TextRange } from './codeintel';

export interface FileMetadata {
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly isSymlink: boolean;
  readonly isBinary: boolean;
}

/** Read-only filesystem boundary; implementations must enforce root confinement. */
export interface FileProvider {
  readonly readOnly: true;
  list(relativeDirectory: string): Promise<readonly FileMetadata[]>;
  read(relativePath: string, maxBytes: number): Promise<Uint8Array>;
  exists(relativePath: string): Promise<boolean>;
}

export interface TokenCounter {
  count(text: string): number;
  countRange(text: string, range: TextRange): number;
}

export function deterministicPaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}
