# SE-SEC-08 — `fs/browse` "not found" response leaked server root + user home

- **Severity:** MEDIUM (information disclosure)
- **Status:** FIXED-VERIFIED (closed before 2026-10-06; this is the filing the
  `sec08file` backlog item asked for)

## Finding
`GET /api/v1/fs/browse?path=…`, when the requested path did **not** exist,
answered 404 with a body that included the server `cwd` and the OS user `home`.
A single unauthenticated-looking probe (the route is behind auth, but any
authenticated key could do it) revealed the install location and the username —
a reconnaissance leak, not a traversal break.

## Fix
The 404 (and 403) responses no longer serialize `cwd`/`home`. Presence check +
realpath confinement to the workspace subtree are enforced together, so an
out-of-tree path — including one reached through a symlink that escapes the
subtree — is refused without echoing environment paths.

## Evidence
`src/server/gatewayManagedSecurity.test.ts` → `confines fs/browse to the
workspace subtree` asserts `outside`/`viaLink` are 403 and that both the 403 and
the "missing inside" 404 bodies **do not contain** `os.homedir()`. Green in the
2026-10-07 full-suite run. This is adjacent to F-0011 (route least-privilege):
the browse handler's permission is inherited via the route table, unchanged here.
