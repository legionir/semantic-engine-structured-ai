# Forensic batch review — `semantic-engine/`

## Scope and method

Reviewed 30 files that were marked `درانتظار` in `AUDIT_FILE_STATUS.md`, all directly readable in the local mirror under `work/repo/semantic-engine`. Each selected source/config/test file was opened and its relevant execution path, dependencies, error handling, and test coverage were traced. Security was out of scope. No tests were executed.

## Confirmed findings

### F-16 — IndexPipeline ignores the entire top-level directory when output is nested under a source directory

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Trigger:** Run `IndexPipeline` with `outputPath` inside the workspace at a nested path whose first segment is a real source directory, for example `workspace/src/generated/project-index.json`, while `src` is not otherwise ignored.

The implementation computes the output directory and relative path:

```ts
const outputDir = path.dirname(path.resolve(this.options.outputPath));
const relative = path.relative(workspaceRoot, outputDir).split(path.sep).join('/');
```

Evidence: `src/pipeline/IndexPipeline.ts:502-505`.

After confirming the path is inside the workspace, it extracts only the first path segment and adds that segment to `ignoreDirectories`:

```ts
const existing = base.ignoreDirectories ?? DEFAULT_IGNORE_DIRECTORIES;
const name = relative.split('/')[0]!;
if (existing.includes(name)) return base;

return { ...base, ignoreDirectories: [...existing, name] };
```

Evidence: `src/pipeline/IndexPipeline.ts:510-514`.

`WorkspaceScanner`/`IgnoreMatcher` treat an entry in `ignoreDirectories` as a directory name to skip recursively. Therefore an output directory such as `src/generated` causes `src`—not merely `src/generated`—to be ignored, removing all source files under `src` from the index. The nearby comment claims the fix is to ignore “the path that is actually written” (`IndexPipeline.ts:498-500`), but the actual value passed is only the top-level name. The reviewed `IndexPipeline.test.ts` covers the normal output path under `.semantic-engine` and general indexing, but has no nested-output-under-source test; its output path is `workspace/.semantic-engine/project-index.json`, so the defect is not exercised.

### F-17 — TypeScript dependency extraction collapses multiple exported variables into one invalid export name

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Trigger:** Index a TS/JS file containing a multi-declarator exported variable statement, e.g. `export const first = 1, second = 2;`.

The extractor intentionally advertises one `ExportEntry` per exported name:

```ts
SE-DATA-02 — یک `ExportEntry` به‌ازای هر نام.
```

Evidence: `src/dependencies/typescript/TSDependencyExtractor.ts:269-275`. Named export declarations correctly map each AST element separately (`TSDependencyExtractor.ts:280-287`), but declaration-based exports use `parseExportedDeclaration`, which returns only one `ExportEntry`:

```ts
private parseExportedDeclaration(node: ts.Node): ExportEntry | null {
  const isDefault = this.hasDefaultModifier(node);
  const name = this.getDeclarationName(node);
  ...
  return {
    name,
    kind: isDefault ? 'default' : 'named',
  };
}
```

Evidence: `src/dependencies/typescript/TSDependencyExtractor.ts:313-330`.

For a variable statement, `getDeclarationName` collects every identifier but joins them into one comma-separated string:

```ts
if (ts.isVariableStatement(node)) {
  const names: string[] = [];
  for (const decl of node.declarationList.declarations) {
    if (ts.isIdentifier(decl.name)) {
      names.push(decl.name.text);
    }
  }
  return names.length > 0 ? names.join(', ') : null;
}
```

Evidence: `src/dependencies/typescript/TSDependencyExtractor.ts:357-371`.

The resulting export is `{ name: 'first, second', kind: 'named' }` rather than two entries (`first` and `second`). Downstream symbol/export linking and API metadata cannot resolve either individual exported symbol by name. The reviewed `TSDependencyExtractor.test.ts` tests named imports, packages/builtins, dynamic imports, single declarations, re-exports, and aliases, but does not test multiple declarators; the defect therefore has no coverage in the selected test.

## No additional confirmed findings

The other reviewed paths did not yield a separate confirmed defect under the stated scope and evidence standard. In particular, graph traversal, incremental store synchronization, watch serialization/disposal, output atomicity/schema validation, path resolution, and job cancellation behavior had targeted tests or coherent error handling in the inspected paths.
