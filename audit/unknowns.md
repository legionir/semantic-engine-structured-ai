# UNKNOWN ledger

## UNKNOWN-0002 — native optional-dependency behaviour (recorded 2026-10-07)

Question: does the engine's *optional* native dependency (`sqlite3`, plus the
tree-sitter native grammars / `usearch`) actually load in the target
environment, or does it silently degrade?

Evidence from this sandbox (Linux, Node v22.23.2, glibc 2.35-0ubuntu3.14):

- `sqlite3` is installed (`node_modules/sqlite3` present, `^6.0.1` as
  `optionalDependencies`), but `require('sqlite3')` **fails**:
  `/lib/x86_64-linux-gnu/libm.so.6: version 'GLIBC_2.38' not found (required by
  node_modules/sqlite3/build/Release/node_sqlite3.node)`.
  The prebuilt native binary needs glibc ≥ 2.38; this image ships 2.35.
- This is exactly the condition the product was designed to absorb
  (SE-BUILD-10): the SQLite exporter probes for `sqlite3` and, on failure,
  falls back to the built-in `node:sqlite` (Node ≥ 22.13) instead of throwing.
  `SQLiteExporter.phase24.test.ts` skips the `sqlite3`-fallback case honestly
  via a `canLoadSqlite3()` probe rather than asserting a load that cannot happen
  here.
- CI (`.github/workflows/semantic-engine-ci.yml`) installs with
  `npm ci || npm install` and documents that optional native deps may fail to
  build on some Node/OS combos, with graceful degradation expected. Both Node
  20.x and 22.x jobs are green, confirming the fallback path works on
  `ubuntu-latest`.

Resolution: **not a product defect.** The engine's contract is
"native-optional, degrade-honestly", and it holds. On a glibc ≥ 2.38 host (or
Node 22 with `node:sqlite`), full SQLite export is exercised. Recorded so the
"sqlite3 missing / fallback used" test skips are never re-read as failures.
