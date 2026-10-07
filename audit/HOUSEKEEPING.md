# Housekeeping record (filing only — no product code)  ·  2026-10-07

## fragile — `AssembleContextTool` SE-AI-18 timing budget
The SE-AI-18 case (line 352, "بودجهٔ بیشتر هرگز باعث ناپدیدشدن تغییرات اخیر
نمی‌شود") sits on the default 5 s Jest edge when the runner is loaded. It is a
pure in-memory assertion (no I/O), so the cost is CPU contention from other
suites sharing the process, not real slowness. Follow-up (not done here, to
avoid changing test semantics without owner review): give the case an explicit
generous timeout (`it(..., 10_000)`) or split the fixture-heavy suite. Left as a
recorded observation, not a silent bump.

## prune — orphan project data directories
`fcc08d5f`, `prj-base-*`, `prj-se-b4` were noted as orphan dirs on the owner's
machine. **They do not exist in this sandbox** — `SEMANTIC_ENGINE_DATA_DIR`,
`~/.semantic-engine` and `~/.local/share/semantic-engine` are all absent here
(verified with a direct `fs` probe during the remediation run). Deleting user
data must happen on the owner's host, not blind from a container, so this is a
handed-back action, not executed. No test writes to those ids in this checkout.

## lspeperm — `lspIsolation` EPERM temp cleanup
The `lspIsolation` gate's temp-directory teardown can raise EPERM on some
Windows/sandbox hosts (a file still held by a spawned LSP child when `rmSync`
runs). This is **environmental**, not a product defect: the isolation logic
itself is correct. Policy (already encoded in the suite): skip the gate honestly
when the environment cannot execute it, rather than force a false green — same
rule as the orphan-reaper probe in `lspTesting.test.ts`. Recorded so an EPERM
red on a given host is never re-triaged as a regression.
