export { ScannerConfig, DEFAULT_SCANNER_CONFIG, createScannerConfig } from './ScannerConfig';
export {
  DEFAULT_IGNORE_DIRECTORIES,
  DEFAULT_IGNORE_FILE_PATTERNS,
  SKIP_HIDDEN_DIRECTORIES,
} from './defaultIgnorePatterns';
export {
  PROJECT_OUTPUT_DIR,
  LEGACY_PROJECT_OUTPUT_DIR,
  LEGACY_FLAT_OUTPUT_DIR,
  PROJECT_INDEX_FILE,
  PROJECTS_DIR_NAME,
  BLUEPRINT_FILE,
  SQLITE_FILE,
  PROJECT_ARTIFACTS_MANIFEST_FILE,
  LOCKS_DIR,
  LOGS_DIR,
  EVENTS_DIR,
  SNAPSHOTS_DIR,
  artifactRootFor,
  canonicalIndexPath,
  indexPathCandidates,
  normalizeWorkspaceRoot,
  resolveProjectIndexPath,
  resolveProjectPaths,
  workspaceRootFromIndexPath,
  workspaceRootFromIndex,
} from './ProjectPaths';
export type { ProjectPaths, ResolveProjectPathsOptions } from './ProjectPaths';
export {
  ARTIFACT_LOCATIONS,
  DATA_DIR_CONFIG_KEY,
  DATA_DIR_ENV_VAR,
  DATA_DIR_NAME_POSIX,
  DATA_DIR_NAME_WINDOWS,
  DEFAULT_ARTIFACT_LOCATION,
  ARTIFACT_LOCATION_CONFIG_KEY,
  artifactLocationOrDefault,
  ensureDataRoot,
  isArtifactLocation,
  platformDataRoot,
  resolveDataRoot,
} from './DataRootResolver';
export type { ArtifactLocation, DataRootOptions } from './DataRootResolver';
export {
  PROJECT_ID_MAX_LENGTH,
  PROJECT_ID_PATTERN,
  PROJECT_ID_PREFIX,
  assertProjectId,
  assertProjectRoot,
  canonicalizeRoot,
  isValidProjectId,
  projectIdFor,
  projectHash,
  slugify,
} from './ProjectIdentity';
