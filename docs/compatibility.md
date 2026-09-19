# Runtime compatibility matrix

Measured with real Node binaries (Windows x64): 20.18.0, 22.12.0, 24.15.0. CI runs semantic-engine on Node 20 and 22
(Ubuntu) and structured-ai on Node 18 and 20.

## semantic-engine — SQLite export

| Node | Driver used | Requirement |
|---|---|---|
| 20.x | `sqlite3` (native, **optional dependency**, declared in `package.json`) | `npm ci` must be able to install the prebuilt binary; otherwise SQLite export fails with an explicit message |
| 22.5 – 22.12 | `sqlite3` | `node:sqlite` exists only behind `--experimental-sqlite` here (measured on 22.12), so it is not used |
| >= 22.13, 23.4+, 24 | built-in `node:sqlite` | none; `sqlite3` is not needed |

* `engines.node` stays `>=20`.
* `SEMANTIC_ENGINE_SQLITE_DRIVER=sqlite3|node:sqlite` forces a driver (tests use it to run the fallback on Node 24).
  Forcing an unavailable or unknown driver throws; it never falls back silently.
* Both drivers run the same exporter suite (`SQLiteExporter*.test.ts`, `SqliteGraphQuery*.test.ts`) and produce the same rows.
* Note: the plan and the audit said native SQLite starts at Node 22.5. That is the first release that has it *behind a flag*;
  unflagged support starts at 22.13 (decision D-6 in `audit/DECISIONS.md`).

## Test-suite results per Node version (subset: core, server, services, graphs, export, dependencies, incremental)

| Node | Result |
|---|---|
| 20.18.0 | all pass except 3 Windows-only suites: `core/config/DataRootResolver`, `core/config/migration.e2e`, `server/gatewayManagedSecurity` |
| 22.12.0 | same 3 |
| 24.15.0 | same 3 |

The three suites assume POSIX paths, `chmod` modes and Unix-socket paths; they pass on Linux CI.
Running two jest processes at the same time in one checkout makes SQLite/e2e suites collide on shared
`tmp-*` directories (`EBUSY`); run node versions one after another.
