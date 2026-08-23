/**
 * Canonical locations for project artifacts.
 *
 * The CLI writes indexes to `<workspace>/.semantic-engine`. Older versions
 * of the Structured AI integration used `<workspace>/.agent/semantic`; those
 * locations are read as compatibility fallbacks, but are never selected for
 * new output. Keeping the rules here prevents `serve`, `query`, `watch`, the
 * platform registry, and the standalone MCP entry point from inventing
 * slightly different roots.
 */

import * as path from 'path';
import * as fs from 'fs';

export const PROJECT_OUTPUT_DIR = '.semantic-engine';
export const LEGACY_PROJECT_OUTPUT_DIR = path.join('.agent', 'semantic');
export const LEGACY_FLAT_OUTPUT_DIR = 'semantic';
export const PROJECT_INDEX_FILE = 'project-index.json';

/**
 * Convert a project-ish path to the actual workspace root.
 *
 * `--root` is occasionally supplied by an integration with the runtime
 * directory (`.agent`) or one of the artifact directories. Treat those as
 * aliases for their parent workspace instead of appending another output
 * directory to them (`.agent/.semantic-engine` or `.semantic-engine/...`).
 */
export function normalizeWorkspaceRoot(input: string): string {
  let resolved = path.resolve(input);
  const base = path.basename(resolved).toLowerCase();
  const parent = path.basename(path.dirname(resolved)).toLowerCase();

  if (base === PROJECT_OUTPUT_DIR.toLowerCase()) {
    return path.dirname(resolved);
  }

  if (
    base === path.basename(LEGACY_PROJECT_OUTPUT_DIR).toLowerCase() &&
    parent === path.basename(path.dirname(LEGACY_PROJECT_OUTPUT_DIR)).toLowerCase()
  ) {
    return path.dirname(path.dirname(resolved));
  }

  /* A pre-canonical build also used `<workspace>/semantic`. Only treat it as
     an artifact directory when it actually contains an index; a real source
     directory named `semantic` must remain a valid workspace root. */
  if (
    base === LEGACY_FLAT_OUTPUT_DIR &&
    fs.existsSync(path.join(resolved, PROJECT_INDEX_FILE))
  ) {
    return path.dirname(resolved);
  }

  /* `.agent` is the Structured AI runtime directory, not the project root. */
  if (base === '.agent') {
    return path.dirname(resolved);
  }

  return resolved;
}

/** Canonical path where a new index for `workspaceRoot` is written. */
export function canonicalIndexPath(workspaceRoot: string): string {
  return path.join(
    normalizeWorkspaceRoot(workspaceRoot),
    PROJECT_OUTPUT_DIR,
    PROJECT_INDEX_FILE
  );
}

/**
 * Candidate index locations, ordered from current to legacy. The canonical
 * candidate is returned even when it does not exist so callers have a stable
 * path to report in an error.
 */
export function indexPathCandidates(workspaceRoot: string): string[] {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  return [
    path.join(root, PROJECT_OUTPUT_DIR, PROJECT_INDEX_FILE),
    path.join(root, LEGACY_PROJECT_OUTPUT_DIR, PROJECT_INDEX_FILE),
    path.join(root, LEGACY_FLAT_OUTPUT_DIR, PROJECT_INDEX_FILE),
  ];
}

/** Resolve an explicit file, or the first existing/default index for a root. */
export function resolveProjectIndexPath(
  workspaceRoot: string,
  explicitPath?: string
): string {
  if (explicitPath && explicitPath.trim() !== '') {
    return path.resolve(explicitPath);
  }

  const candidates = indexPathCandidates(workspaceRoot);
  return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0]!;
}

/**
 * Recover a workspace root from an index file when `rootPath` is absent (old
 * indexes only had the display-name `root` field).
 */
export function workspaceRootFromIndexPath(indexPath: string): string {
  const resolved = path.resolve(indexPath);
  const outputDir = path.basename(path.dirname(resolved)).toLowerCase();
  const outputParent = path.basename(path.dirname(path.dirname(resolved))).toLowerCase();

  if (outputDir === PROJECT_OUTPUT_DIR.toLowerCase()) {
    return path.dirname(path.dirname(resolved));
  }

  if (
    outputDir === path.basename(LEGACY_PROJECT_OUTPUT_DIR).toLowerCase() &&
    outputParent === path.basename(path.dirname(LEGACY_PROJECT_OUTPUT_DIR)).toLowerCase()
  ) {
    return path.dirname(path.dirname(path.dirname(resolved)));
  }

  if (outputDir === LEGACY_FLAT_OUTPUT_DIR) {
    return path.dirname(path.dirname(resolved));
  }

  return path.dirname(path.dirname(resolved));
}

/** Normalize an index's persisted root path, including old `.agent` values. */
export function workspaceRootFromIndex(
  index: { readonly rootPath?: string },
  indexPath: string
): string {
  /* `rootPath` can point to the machine that produced a committed index.
     Use it only while it still exists; otherwise the index location is the
     portable source of truth. An explicit CLI --root is handled by callers
     before this function and remains authoritative. */
  const persistedRoot =
    index.rootPath &&
    path.isAbsolute(index.rootPath) &&
    fs.existsSync(index.rootPath)
      ? index.rootPath
      : workspaceRootFromIndexPath(indexPath);

  return normalizeWorkspaceRoot(persistedRoot);
}
