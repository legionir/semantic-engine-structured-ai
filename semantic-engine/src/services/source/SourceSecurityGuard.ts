/**
 * SourceSecurityGuard — Enforces file-system and source integrity guards.
 * Protects against Path Traversal, Symlink Loops, Zip Bombs, and Disallowed Executables.
 */

import * as path from 'path';
import * as fs from 'fs';

export interface SecurityPolicy {
  readonly allowedExtensions?: readonly string[];
  readonly blockedExtensions?: readonly string[];
  readonly maxFileSizeBytes?: number;
  readonly maxTotalSizeBytes?: number;
  readonly maxSymlinkDepth?: number;
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  blockedExtensions: ['.exe', '.dll', '.so', '.dylib', '.bin', '.iso', '.dmg'],
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
  maxTotalSizeBytes: 200 * 1024 * 1024, // 200MB
  maxSymlinkDepth: 3,
};

export class SourceSecurityGuard {
  constructor(private readonly policy: SecurityPolicy = DEFAULT_SECURITY_POLICY) {}

  validateRelativePath(baseRoot: string, relativePath: string): { ok: boolean; reason?: string; resolvedPath?: string } {
    if (!relativePath || relativePath.trim() === '') {
      return { ok: false, reason: 'Path cannot be empty' };
    }

    // Reject null byte injection
    if (relativePath.includes('\0')) {
      return { ok: false, reason: 'Null byte injection detected' };
    }

    const resolved = path.resolve(baseRoot, relativePath);
    const lexicalRoot = path.resolve(baseRoot);
    let normalizedRoot: string;

    try {
      normalizedRoot = fs.realpathSync(lexicalRoot);
    } catch {
      return { ok: false, reason: `Root does not exist: '${baseRoot}'` };
    }

    if (!resolved.startsWith(lexicalRoot + path.sep) && resolved !== lexicalRoot) {
      return { ok: false, reason: `Path traversal detected: '${relativePath}' escapes root '${baseRoot}'` };
    }

    /*
    | The lexical check above is not enough for a write: an existing
    | ancestor may be a symlink to another tree. Resolve the deepest
    | existing ancestor and check its canonical location before the caller
    | creates missing directories or opens the destination.
    */
    let existing = resolved;
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }

    try {
      const realExisting = fs.realpathSync(existing);
      if (!realExisting.startsWith(normalizedRoot + path.sep) && realExisting !== normalizedRoot) {
        return { ok: false, reason: `Symlink traversal detected for '${relativePath}'` };
      }
    } catch {
      return { ok: false, reason: `Unable to resolve path safely: '${relativePath}'` };
    }

    const ext = path.extname(relativePath).toLowerCase();
    if (this.policy.blockedExtensions?.includes(ext)) {
      return { ok: false, reason: `Disallowed binary/executable file extension: ${ext}` };
    }

    return { ok: true, resolvedPath: resolved };
  }

  validateFileSize(bytes: number): { ok: boolean; reason?: string } {
    const limit = this.policy.maxFileSizeBytes || 10 * 1024 * 1024;
    if (bytes > limit) {
      return { ok: false, reason: `File size (${bytes} bytes) exceeds limit of ${limit} bytes` };
    }
    return { ok: true };
  }

  validateTotalSize(bytes: number): { ok: boolean; reason?: string } {
    const limit = this.policy.maxTotalSizeBytes || 200 * 1024 * 1024;
    if (bytes > limit) {
      return { ok: false, reason: `Bundle size (${bytes} bytes) exceeds limit of ${limit} bytes` };
    }
    return { ok: true };
  }

  validateSymlink(targetPath: string, visited: Set<string> = new Set()): { ok: boolean; reason?: string } {
    try {
      if (!fs.existsSync(targetPath)) return { ok: true };
      const stat = fs.lstatSync(targetPath);
      if (!stat.isSymbolicLink()) return { ok: true };

      const real = fs.realpathSync(targetPath);
      if (visited.has(real)) {
        return { ok: false, reason: `Cyclic symlink loop detected at: ${targetPath}` };
      }
      visited.add(real);

      if (visited.size > (this.policy.maxSymlinkDepth || 3)) {
        return { ok: false, reason: `Symlink traversal depth exceeded limit of ${this.policy.maxSymlinkDepth}` };
      }

      return this.validateSymlink(real, visited);
    } catch (err) {
      return { ok: false, reason: `Symlink resolution error: ${(err as Error).message}` };
    }
  }
}
