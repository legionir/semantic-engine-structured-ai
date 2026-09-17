# Structured AI audit — supplemental review

## Scope, snapshot, and accounting

- Repository: `legionir/semantic-engine-structured-ai`
- Ref: `main`
- Audited snapshot: `3a20f3192e43c5cf2723cd524e08e013f941a4ed`
- Scope: `structured-ai/` only. Security is intentionally out of scope.
- Complete tree was obtained first: **357 blob files**, **70 directories**, `truncated=false`.
- The prior audit marked 47 paths reviewed. This supplement directly reviewed/targeted **102 additional paths**, for **149 reviewed paths total**.
- Current accounting: **149 reviewed / 208 not directly reviewed** (357 total).
- Of the 237 remaining paths, **207 were present in the local repository mirror but not directly read** and **30 were tree-only** at the end of this pass. “Fetched” is not counted as “reviewed”; targeted line reads count as reviewed for this accounting.
- No repository source files were modified. The full inventory is `/tasklet/threads/a_pjgnxp3j2201gp81brsm/work/structured-ai-tree.txt`; the local mirror is `/tasklet/threads/a_pjgnxp3j2201gp81brsm/work/repo/structured-ai`.

Coverage added in this pass included the remaining web support/controllers/services/serializers that were fetched, the browser app modules that were available, runtime/config/project migration modules, registry/tooling (including filesystem read/path/directory, planning, search, git, archive/memory, skills, code-index/LSP), archive/context/persistence modules, MCP transport modules, deployment/config files, and targeted test sections. The previously reviewed 47 paths and findings F-001–F-008 were not repeated.

## Findings (new; non-security; not duplicates of F-001–F-008)

### F-009 — `fs_read_many` drops the active project context

- **Classification:** CONFIRMED
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Impact:** In a run for a registered project whose workspace root differs from the process workspace, `fs_read_many` resolves every item through the global/default workspace. It can report project files as missing or read a same-named file from the wrong root, while single-file `fs_read` remains correctly scoped.
- **Execution path:** `ToolRuntime.executeTool()` passes the normalized `ToolContext` to the implementation (`ToolRuntime.js:248-260`) → `fsReadMany(args, context)` derives the project-bound `ctx` → each `fsRead()` call omits the second `context` argument → `fsRead` invokes `PathBoundary.bound(undefined)` and falls back to the process workspace.
- **Evidence (verbatim):** `agent/tools/ToolRuntime.js:248-260`
  ```js
  const implementation =
      IMPLEMENTATIONS[name];

  const result =
      implementation
          ? await implementation(
              {
                  ...(args || {}),

                  _agent: context.agent
              },
              toolContext
          )
          : await mcp._executeDiscovered(
              name,
              args || {}
          );
  ```
  `agent/tools/filesystem/ReadTools.js:14-25`
  ```js
  async function fsRead(args, context) {

      const ctx = PathBoundary.bound(context);


      const target =
          ctx.resolvePath(
              args.path,
              {
                  mustExist: true
              }
          );
  ```
  `agent/tools/filesystem/ReadTools.js:133-166`
  ```js
  async function fsReadMany(args, context) {

      const ctx = PathBoundary.bound(context);
  ...
                      const result =
                          await fsRead({
                              path: item,

                              offset:
                                  args.offset,

                              limit:
                                  args.limit
                          });
  ```
  The local direct reproduction created only `<project-root>/p.txt`, then called `fs_read_many({paths:['p.txt']}, {projectContext:{projectId:'p',workspaceRoot:<project-root>}})`. Actual result:
  ```json
  {"requested":1,"succeeded":0,"files":[{"path":"p.txt","success":false,"error":"Path does not exist: p.txt"}]}
  ```
  This is a correctness/multi-project defect, not a boundary/security report.
- **Test gap:** Existing `fs_read_many` tests exercise the legacy workspace context and per-file failure/total-output behavior, but no project-rooted `ToolContext` case was found in the reviewed test sections.

### F-010 — graduated context compression has no immutable original payload

- **Classification:** CONFIRMED
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Impact:** When a conversation requires more than one compression level, the later medium/heavy pass operates on the already-light-trimmed text. Metadata such as `original_chars` then describes the light fragment, and later summaries/excerpts cannot recover the original tool result. This silently loses detail before the context is sent to the model.
- **Execution path:** `compactConversation()` iterates `ORDER` (`ContextCompactor.js:229-295`) → light compression mutates `message.content` (`:140-155`) → a later medium/heavy call computes `original` from `message.original_content || message.content` (`:131-135`) → no immutable original is assigned by this compactor, so the truncated content becomes the source for the next level.
- **Evidence (verbatim):** `agent/context/ContextCompactor.js:131-155`
  ```js
  const original =
      message.original_content || message.content;

  const parsed =
      parseResult(message);

  const before =
      message.content.length;
  ...
      message.content =
          `${original.slice(0, limit)}\n... [older result trimmed to ${
              limit
          } of ${original.length} characters]`;
  ```
  `agent/context/ContextCompactor.js:157-187`
  ```js
  } else if (level === LEVELS.MEDIUM) {
  ...
      const summary =
          describeResult(parsed, original);

      message.content =
          JSON.stringify({
              ...summary,

              excerpt:
                  original.slice(0, limit),
  ...
  message.compression = level;
  ```
  `agent/context/ContextCompactor.js:229-295`
  ```js
  for (const level of ORDER) {
  ...
                      compressToolMessage(
                          messages[index],
                          level
                      )
  ...
      if (conversationSize(messages) <= budget) {
          break;
      }
  }
  ```
- **Reproduction:** Using the repository's `buildConversation(20, 5000)` shape and `compactConversation(messages, {maxChars: 40000, keepRecentExchanges: 2})` produced `light:18, medium:7`. A tool message that started with a 5,068-character JSON result ended at medium with `original_chars:2054` and a 643-character summary excerpt; the 2,054 value is the prior light result, not the original payload. Existing tests check age/size/levels but do not assert that a medium/heavy pass preserves the original result metadata/content.

### F-011 — archive compaction rewrites fully-dead segments to empty files

- **Classification:** CONFIRMED
- **Severity:** LOW
- **Confidence:** HIGH
- **Impact:** `compactSegments()` is intended to remove a segment when all of its records are dead, but a `keep` ID in any other segment prevents the removal branch globally. The dead segment is then rewritten as a one-newline empty file and persists indefinitely. This leaks stale archive segment files and makes compaction statistics/operational cleanup inaccurate; it does not discard a live body in the minimal reproduction.
- **Execution path:** `maintain()` calls `compactSegments()` (`ArchiveRepository.js:973-983`) → `compactSegments` builds one global `keep` set from every record’s `merged_ids` (`:893-906`) → for a segment with no live records, removal is allowed only when that global set is empty (`:920-929`) → filtering and rewrite use the same global set (`:937-966`).
- **Evidence (verbatim):** `agent/persistence/ArchiveRepository.js:887-906`
  ```js
  const live = new Map();
  ...
  const keep = new Set();
  ...
  for (const record of index.records) {
  ...
      live.get(record.segment).add(record.id);

      for (const id of record.merged_ids || []) {
          keep.add(id);
      }
  }
  ```
  `agent/persistence/ArchiveRepository.js:920-929`
  ```js
  const alive =
      live.get(name) || new Set();

  if (alive.size === 0 && keep.size === 0) {

      fs.unlinkSync(segmentPath(name, root));

      removed++;

      continue;
  }
  ```
  `agent/persistence/ArchiveRepository.js:937-966`
  ```js
  const kept =
      lines.filter(line => {
  ...
          return alive.has(id) || keep.has(id);
  ...
      });
  ...
  fs.writeFileSync(
      segmentPath(name, root),
      `${kept.join("\n")}\n`,
      "utf8"
  );

  compacted++;
  ```
- **Reproduction:** A temporary archive containing `a.jsonl={"id":"liveB"}` and `b.jsonl={"id":"deadB"}`, with index records only for `a.jsonl` and `merged_ids:['oldA']`, returned `{ compacted: 1, removed: 0 }`; `b.jsonl` remained with content `"\n"`. A later pass sees an empty file and leaves it in place.

### F-012 — `code_rename` does not apply edits by their designated range

- **Classification:** CONFIRMED
- **Severity:** MEDIUM
- **Confidence:** MEDIUM-HIGH
- **Impact:** Apply-mode rename can silently skip a valid range-based text edit (because `oldText` is required even though range/newText is sufficient), or replace the first matching `oldText` occurrence rather than the occurrence returned by the semantic engine. Repeated identifiers can therefore be changed at the wrong location; a successful response may report `applied: true` despite no edit being applied in the range-only case.
- **Execution path:** `codeRename()` calls the semantic engine and receives `raw.changes` (`LiveLspTools.js:158-176`) → apply mode sorts by range line (`:178-190`) → each edit is accepted only if both `newText` and `oldText` exist, then `String.replace` is used without the edit range (`:191-196`) → response reports `applied: !dryRun` regardless of whether any edit matched.
- **Evidence (verbatim):** `agent/tools/code/LiveLspTools.js:178-196`
  ```js
  if (!dryRun) {
      /* Apply edits to disk within workspace boundary */
      for (const [filePath, fileEdits] of Object.entries(changes)) {
          const fullPath = ctx.resolvePath(filePath);
          if (fs.existsSync(fullPath)) {
              let content = fs.readFileSync(fullPath, "utf8");
              /* Apply sorted in reverse line order */
              const sortedEdits = [...fileEdits].sort((a, b) => {
                  const lineA = a.range ? a.range.start.line : a.line || 0;
                  const lineB = b.range ? b.range.start.line : b.line || 0;
                  return lineB - lineA;
              });

              for (const edit of sortedEdits) {
                  if (edit.newText !== undefined && edit.oldText !== undefined) {
                      content = content.replace(edit.oldText, edit.newText);
                  }
              }
              fs.writeFileSync(fullPath, content, "utf8");
          }
      }
  }
  ```
  `agent/tools/code/LiveLspTools.js:201-217`
  ```js
  return {
      symbol: args.symbol || null,
      new_name: args.new_name,
      dry_run: dryRun,
      applied: !dryRun,
      files_affected: changedFiles.length,
  ...
  };
  ```
  The checked-in schema advertises a “safe, compiler-backed symbol rename” and exposes line/character inputs (`agent/registry/tool-schemas/code.json:392-428`), while the reviewed test mock supplies only one oldText occurrence (`test/mcp/semantic.test.js:259-270`) and the apply assertion checks only that one occurrence (`:577-588`). No reviewed test exercises repeated occurrences, a range/newText-only edit, or a mismatch where `oldText` is not found.

## Validation and limitations

- The complete tree request succeeded at the snapshot above. Content fetching created a fuller local mirror, but it still did not include every tree file; directly read/targeted files are counted separately from fetched-but-unread files.
- Focused test attempts were not successful validations: `timeout 20s node test/context/context.test.js`, `test/context/archive.test.js`, `test/tools/tools.test.js`, and `test/mcp/semantic.test.js` each exited **124** with no output. A prior package-level attempt (`npm test -- --runInBand test/tools/tools.test.js`) also timed out with exit **124** after only the initial normalize suite reported `6/6 passed`; `timeout 60s node test/tools/tools.test.js` exited **124** with no output. No full test/build pass is claimed.
- A broad static scan timed out and `rg` was unavailable in the sandbox (`sh: 1: rg: not found`); grep/Python targeted scans were used instead.
- The deployment/Docker/CI layout discrepancy was inspected but **not** reported as a new finding because it overlaps the prior F-006 deployment/CI coverage. No security findings are included.

### F-013 — request JSON decoding corrupts UTF-8 split across incoming chunks

- **Classification:** CONFIRMED
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Impact:** `readBody` decodes every `data` chunk independently with `chunk.toString("utf8")`. Node streams may split a multi-byte UTF-8 code point across chunks; each partial sequence is replaced before concatenation, so otherwise-valid JSON containing non-ASCII text can be rejected or persisted with corrupted text. The byte limit accounting remains correct, but parsing is not stream-safe.
- **Evidence (verbatim):** `web/server/RequestBody.js:37-50`
  ```js
        req.on("data", chunk => {

            if (rejected) {
                return;
            }

            size += chunk.length;

            if (size > maxBytes) {
                rejectTooLarge();
                return;
            }

            body += chunk.toString("utf8");
        });
  ```
  `web/server/RequestBody.js:64-67`
  ```js
            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error("request body is not valid JSON"));
            }
  ```
- **Test gap:** No reviewed test covered a valid JSON body whose UTF-8 encoding is split between two `data` events.

### F-014 — visualizer fabricates successful test coverage for every node

- **Classification:** CONFIRMED
- **Severity:** LOW
- **Confidence:** HIGH
- **Impact:** The visualizer inspector claims every selected symbol is covered by a generated `<title>.test.ts` filename, even though the node model has no coverage field and no test lookup occurs. This presents invented coverage as fact and misleads users about test intelligence. The defect exists in both the modular inspector and the legacy renderer.
- **Evidence (verbatim):** `web/public/visualizer/node-details.js:60-63`
  ```js
    elements.tests.replaceChildren();
    const test = document.createElement("li");
    test.textContent = `✓ Covered by ${details.title.toLowerCase()}.test.ts`;
    elements.tests.appendChild(test);
  ```
  `web/public/visualizer/renderer.js:405-406` (same behavior in the legacy renderer)
  ```js
    // Covering tests
    inspTests.innerHTML = `<li>✓ Covered by ${node.label.toLowerCase()}.test.ts</li>`;
  ```
- **Test gap:** No reviewed test verifies coverage metadata or checks the no-coverage case; the implementation unconditionally emits the positive claim.

## Feedback for future passes

1. **Mismatches:** The prior audit’s 47-file accounting was accurate for its snapshot, but its “not reviewed” classification became stale after this pass; the current exact accounting is 120/237. Some web files were fetched/read individually but are not present in the local mirror, so mirror presence must not be used as the review count.
2. **Tools to preload:** GitHub `github_get_tree` and `github_get_file_content` are sufficient for this task; preloading those read-only tools avoids the initial fetch-token retry. `github_download_file` would help persist large source files for local analysis when available.
3. **Context files to add:** Keep `/tasklet/threads/a_pjgnxp3j2201gp81brsm/work/structured-ai-tree.txt` and the prior audit available on every continuation. A machine-readable reviewed-path manifest would make exact accounting reproducible.
4. **Errors/other:** Test scripts in this repository can hang without output, so use per-file timeouts and record exit codes. The local mirror omitted tree-only files after fetch-token limits; targeted direct reads were used where possible. Findings F-009–F-012 are correctness/reliability/persistence/integration issues only; F-001–F-008 and security were intentionally excluded.


## Coverage update — 2026-09-17

The directly reviewed paths completed in this pass are recorded one per line in `structured-completed-paths.txt`. These manifests are the authoritative increment for this pass; all other paths remain at their prior status in `AUDIT_FILE_STATUS.md`. No security review was performed.
