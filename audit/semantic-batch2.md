# Forensic batch review — `semantic-engine/`

## Scope and method

Reviewed 30 files marked `درانتظار` in `AUDIT_FILE_STATUS.md`, directly from the local mirror under `work/repo/semantic-engine`. The selected batch covers the CLI launcher, blueprint contract, archived/current public UI assets, build/audit/fixture/pipeline/snapshot/schema-validation scripts, AI metadata and registry tests/implementation, config/test mapping, blueprint/context discovery, and token-cost tests. For each source/implementation file, imports/callers and downstream data shape were traced where present; tests, error paths, and project-root/multi-project implications were checked. Security was out of scope. No repository tests were executed.

## Confirmed finding

### F-18 — `scripts/snapshot.js` normalizer discards all supposedly stable IDs

- **Status:** CONFIRMED
- **Severity:** Medium (test/snapshot correctness)
- **Confidence:** High
- **Area:** regression detection / generated-artifact snapshot gate
- **Trigger path:** run `node scripts/snapshot.js` (or its snapshot comparison in CI) against a generated project index/blueprint containing IDs, then change a stable file/symbol/module/graph ID while keeping the rest of the normalized artifact equal.

The script explicitly says that IDs under selected collections are stable and should be retained:

```js
/* Kept even though the name matches: these are stable identifiers. */
const KEEP_ID_UNDER = new Set([
    "files", "symbols", "nodes", "edges", "callGraph", "typeGraph",
    "dependencyGraph", "reverseDependencyGraph", "vectorChunks",
    "moduleMap", "symbolIndex", "technicalConstraints", "apiMap"
]);
```

Evidence: `scripts/snapshot.js:62-67`.

The volatility decision attempts to preserve those IDs only when the current object’s parent key is one of the set:

```js
const isVolatile =
    VOLATILE.has(name) &&
    !(name === "id" && KEEP_ID_UNDER.has(parentKey));
```

Evidence: `scripts/snapshot.js:80-84`.

However, the recursive call that enters every object overwrites the parent context with the child property name:

```js
out[name] =
    isVolatile
        ? "<volatile>"
        : normalise(value[name], name, name);
```

Evidence: `scripts/snapshot.js:86-89`. For an object inside `files` (or `symbols`, `moduleMap`, etc.), the `id` property is therefore evaluated with `parentKey === "id"`, not `parentKey === "files"`/`"symbols"`/the relevant collection. Since `"id"` is in `VOLATILE` at `snapshot.js:57`, every such ID becomes `"<volatile>"`; `KEEP_ID_UNDER` is effectively unreachable for normal collection items. The same propagation error also means nested collection IDs are not protected.

The result is that the snapshot comparison cannot detect a stable-identity regression: changing a file/symbol/module/graph ID alone normalizes both expected and actual values to the same placeholder. This affects every project passed through the shared `run-pipeline.js`/`snapshot.js` path, including multi-project use when snapshots are generated separately per workspace. It is distinct from intentionally volatile blueprint metadata IDs: those should remain volatile, but generated index entity IDs and graph IDs are explicitly listed as stable.

The reviewed script has no test fixture/assertion for preserving IDs, and the selected tests do not cover this normalizer. No repository tests were run during this audit.

## No additional confirmed findings

The other 29 reviewed files did not yield a separate confirmed defect under the requested evidence standard. In particular, the CLI launcher has explicit not-built and rejected-promise handling; benchmark/snapshot/pipeline scripts clean temporary output in `finally`; schema/index validators report malformed input and referential errors; AI metadata and test-mapping code have targeted regression tests; blueprint loading degrades explicitly when absent/invalid; and context discovery has tests for search, blueprint, graph expansion, limits, tokenization, and multi-project-independent project-index inputs.

## Execution limitations

- No repository tests were executed; no usable `node_modules`/build execution was assumed.
- Security review was intentionally excluded.
- All 30 paths were directly read from the local mirror; the authoritative manifest is `semantic-batch2-completed.txt`.
