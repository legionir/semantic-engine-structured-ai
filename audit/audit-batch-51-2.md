# گزارش ممیزی batch 51-2

## دامنه و روش

دقیقاً ۱۷ ورودی بعدیِ `درانتظار` از `AUDIT_FILE_STATUS.md` انتخاب و کامل خوانده شدند؛ از `SqliteDriver.ts` شروع و تا `CallGraphBuilder.ts` ادامه یافتند. امنیت عمداً خارج از scope بود؛ اشاره‌های امنیتی صرفاً به قرارداد/رفتار فنی فایل محدود است. برای هر نتیجه، شواهد مستقیم با path و line آمده است؛ استنباط‌هایی که از wiring بیرونی یا اجرای واقعی به دست نیامدند `POTENTIAL` یا `UNVERIFIED` علامت خورده‌اند.

## فهرست دقیق batch

1. `src/export/sqlite/SqliteDriver.ts`
2. `src/facts/FactStore.test.ts`
3. `src/facts/FactStore.ts`
4. `src/facts/index.ts`
5. `src/gateway/GatewayProxy.ts`
6. `src/gateway/ProjectLock.test.ts`
7. `src/gateway/WorkerConfigSchema.test.ts`
8. `src/gateway/WorkerHealthMonitor.ts`
9. `src/gateway/WorkerSupervisor.test.ts`
10. `src/gateway/gatewayConsole.test.ts`
11. `src/gateway/lspIsolation.test.ts`
12. `src/gateway/metrics.test.ts`
13. `src/gateway/metrics.ts`
14. `src/gateway/webSocketProxy.test.ts`
15. `src/gateway/workerArgv.test.ts`
16. `src/gateway/wsProtocol.test.ts`
17. `src/graphs/CallGraphBuilder.ts`

---

## 1) `semantic-engine/src/export/sqlite/SqliteDriver.ts`

- **نقش:** abstraction باریک و async روی دو backend SQLite. قراردادهای `SqliteStatement` و `SqliteDriver` در lines 23–36؛ `openSqlite()` در lines 168–174، native را ترجیح می‌دهد و به `sqlite3` fallback می‌کند.
- **Call path:** `openSqlite(filePath)` → `hasNativeSqlite()` → `openNodeSqlite()` (lines 39–105) یا `openSqlite3()` (lines 108–163). فراخوان مصرف‌کننده در `SQLiteExporter` است (طبق import/export طراحی‌شده در همان شاخه)، اما اجرای end-to-end این batch ممکن نشد.
- **وابستگی:** `node:sqlite` با `require` در line 44؛ native API `DatabaseSync` در lines 48–52. fallback `require('sqlite3')` در line 116 و callback API آن در lines 109–163. `bindable()` در lines 19–21، `undefined→null` و `boolean→0/1` را یکسان می‌کند.
- **خطاها/رفتار:** native constructor/exec/prepare/all/close خطا را reject نمی‌کنند مگر exception synchronous از Promise بیرون بیاید؛ fallback خطاهای callback را reject می‌کند (مثلاً lines 129–160). `finalize` در native عمداً no-op است (lines 70–75). `hasNativeSqlite` هر خطای require را به نبودن native تعبیر می‌کند (lines 39–46)؛ `POTENTIAL` این می‌تواند خطای واقعی load را پنهان کند.
- **multi-project scope:** هر invocation یک path جدا می‌گیرد؛ خود فایل هیچ global connection یا project registry ندارد (`openSqlite`, lines 168–174). جداسازی path و lifecycle در مصرف‌کننده `SQLiteExporter` باید بررسی شود؛ اینجا `UNVERIFIED`.
- **تست مرتبط:** `src/export/SQLiteExporter.test.ts` و `SQLiteExporter.phase24.test.ts` در status قبلی `کامل` هستند؛ برای این فایل test مستقیم در batch وجود ندارد. قرارداد driver از interface lines 23–36 قابل مشاهده است.
- **محدودیت:** Node <22.5 به native دسترسی ندارد و نیازمند نصب optional/native `sqlite3` است (comment lines 1–20). تست واقعی backendها در این اجرا ممکن نبود؛ `UNVERIFIED`.

## 2) `semantic-engine/src/facts/FactStore.test.ts`

- **نقش:** suite رفتاری GAP-08 برای conflict resolution، superseded evidence، duplicates، query و stats؛ helper `fact()` lines 20–35.
- **Call path:** test → `FactStore.add()`/`resolve()`/`resolveFor()`/`stats()`؛ import مستقیم در line 17. موارد strongest-wins lines 39–79، superseded/contested lines 82–121، duplicate lines 124–154، query/stats lines 157–207.
- **وابستگی:** `provenanceFor` و `EdgeBasis` از `../graphs/EdgeProvenance` و `ExtractionSource` از core (line 18)، بدون I/O.
- **خطاها:** assertionها رفتار مورد انتظار را تثبیت می‌کنند: strength مستقل از insertion order، tie بر مبنای basis، exact tie first-wins، duplicate count و contested. نقص اجرایی مستقیمی در test دیده نشد (`POTENTIAL` فقط پوشش محدود به مدل FactStore است).
- **multi-project scope:** داده‌ها شناسه‌ای و در-memory هستند؛ تستی برای دو workspace/project یا persistence ندارد؛ `UNVERIFIED`.
- **تست مرتبط/محدودیت:** تست کامل خوانده شد اما اجرا نشد چون Jest با `Preset ts-jest not found` شکست خورد. ضمن اینکه `npm test` قبل از تست، `gen-fixture.js` اجرا می‌کند؛ نتیجه runtime مستقل حاصل نشد.

## 3) `semantic-engine/src/facts/FactStore.ts`

- **نقش:** store میانی بین extractor و graph consumer؛ مدل‌های `Fact`, `ResolvedFact`, provenance و stats در lines 39–117؛ resolution policy در lines 119–159؛ class در lines 174–262.
- **Call path:** `new FactStore()` → `add/addAll` (lines 185–231) → `resolve/resolveFor/stats` (lines 237–262) → `finish` (lines 264–273). `confidenceOf` در lines 276–278 به `EDGE_CONFIDENCE` وصل است.
- **وابستگی:** `EdgeBasis`, `EdgeLocation`, `EDGE_CONFIDENCE` از `../graphs/EdgeProvenance` و `ExtractionSource` از core (lines 30–31). بدون filesystem/network.
- **خطاها:** bucket key فقط subject/predicate/object است (lines 150–152)، attributes عمداً نادیده گرفته می‌شود. winner با confidence سپس basis rank انتخاب می‌شود (lines 124–137). `superseded` فقط با confidence sort می‌شود نه basis/تساوی پایدار (line 270)؛ در مساوی confidence و basis، order insertion باقی می‌ماند. `resolveFor` نیز فقط confidence sort می‌کند (lines 250–255)، پس tie خروجی implementation-order است؛ `POTENTIAL` برای مصرف‌کننده‌ای که tie determinism می‌خواهد. `ClaimSource='derived'` است ولی `BASIS_RANK` فقط EdgeBasis دارد؛ basis ناشناخته rank صفر می‌گیرد (lines 119–123, 139–141).
- **multi-project scope:** store درون process و instance-local است؛ هیچ projectId/workspace key ندارد (lines 174–183). جداسازی باید توسط caller برقرار شود؛ `UNVERIFIED`.
- **تست مرتبط:** `FactStore.test.ts` خطوط فوق همه API اصلی، duplicate/contested و ordering را می‌پوشاند. تست runtime به علت ts-jest اجرا نشد.
- **محدودیت:** no persistence، no concurrency/async؛ این‌ها از interface و بدنه مشخص‌اند (`UNVERIFIED` برای production use با چند writer).

## 4) `semantic-engine/src/facts/index.ts`

- **نقش:** barrel export برای FactStore و همه typeهای public (lines 1–9).
- **Call path:** import از `./FactStore` و re-export مستقیم؛ logic/runtime ندارد.
- **وابستگی:** تنها `./FactStore`.
- **خطا/محدوده:** export type/value در یک syntax واحد انجام شده؛ با compiler option پروژه سازگار بودن در این اجرا `UNVERIFIED` چون build timeout شد.
- **multi-project:** بی‌حالت و project-neutral.
- **تست/محدودیت:** test مستقیم ندارد؛ پوشش غیرمستقیم FactStore.test است. هیچ خطای منطقی از ۹ خط فایل مشاهده نشد.

## 5) `semantic-engine/src/gateway/GatewayProxy.ts`

- **نقش:** proxy streaming از Gateway به worker روی Unix socket؛ interfaceها lines 37–48 و `proxyRequest` lines 77–137.
- **Call path:** caller `proxyRequest(target, req, res, options)` → `buildHeaders` lines 55–71 → `http.request` روی `socketPath` lines 85–92 → upstream response pipe lines 93–113 یا error→502 lines 117–127؛ client close upstream را destroy می‌کند lines 130–135.
- **وابستگی:** Node `http` فقط (line 22)، socketPath/token از caller. body با `req.pipe(upstream)` و response با `upstreamRes.pipe(res)` منتقل می‌شود.
- **خطاها:** hop-by-hop و origin/host/authorization ورودی حذف می‌شوند lines 58–63؛ authorization داخلی و forwarded headers ساخته می‌شوند lines 65–68. upstream headerهای hop-by-hop حذف می‌شوند lines 94–99. خطای upstream به 502 تبدیل می‌شود. `upstreamRes` error فقط `res.end()` می‌کند و status قبلی ممکن است already sent باشد (lines 108–113؛ `POTENTIAL`). `req` error/aborted و backpressure-specific handling صریح ندارد (`POTENTIAL`). `x-forwarded-proto` همیشه `http` است حتی اگر Gateway در TLS termination باشد (`POTENTIAL/contract-dependent`).
- **multi-project scope:** project id فقط response header/telemetry است (lines 99, 102, 119, 123, 126)؛ mapping target/socket باید قبل از call انجام شود و این فایل خودش project authorization ندارد؛ `UNVERIFIED`.
- **تست مرتبط:** هیچ `GatewayProxy.test.ts` در وضعیت جاری/این batch نبود؛ gateway integration tests (`webSocketProxy`, `GatewayServer`) wiring را غیرمستقیم می‌پوشانند. تست مستقیم header/body/error کامل موجود نیست.
- **محدودیت:** HTTP/1 فقط، socket target فقط؛ no timeout و no explicit request abort handler (`POTENTIAL`).

## 6) `semantic-engine/src/gateway/ProjectLock.test.ts`

- **نقش:** tests برای exclusive lock، holder reporting، dead/stale takeover، heartbeat، metadata و half-written recovery؛ imports lines 1–4 و cases lines 13–130.
- **Call path:** test → `acquireLock/readLock` از `./ProjectLock`; `release/heartbeat` روی result. filesystem temp dir در before/after.
- **وابستگی:** Node fs/os/path و implementation `ProjectLock`; process liveness/clock به option injection.
- **خطا/coverage:** cases خطوط 20–41 held/release، 43–61 dead owner، 63–91 heartbeat/stale، 93–110 metadata و 112–130 malformed JSON. شکست/permission/rename race و multi-process واقعی تست نشده (`UNVERIFIED`).
- **multi-project:** projectId در lock metadata و path شامل project ID است (lines 16–18, 93–110)، اما cases عمدتاً یک project دارند؛ cross-project simultaneous acquisition `UNVERIFIED`.
- **تست اجرا:** به دلیل نبود `ts-jest` اجرا نشد.
- **محدودیت:** PID liveness با callback fake است، نه process واقعی؛ stale threshold با fake clock آزموده می‌شود.

## 7) `semantic-engine/src/gateway/WorkerConfigSchema.test.ts`

- **نقش:** contract suite برای defaults، filesystem/path validation، duplicate root، dataDir، debounce، transport/ports، managed worker config، secret exclusion، embedding و JSON schema؛ helperها lines 1–34.
- **Call path:** test → `createWorkerConfig`, `validateWorkerConfig`, `redactWorkerConfig` و schema constants از `./WorkerConfigSchema`; cases lines 37–299.
- **وابستگی:** fs/os/path و `ProjectWorkerConfig` type. temp workspace در before/after.
- **خطا/coverage:** defaults lines 48–59؛ path/root/data rules lines 61–127؛ ranges/transport/socket lines 129–180؛ managed/secret/embedding lines 182–269؛ schema sync lines 271–299. `POTENTIAL`: tests mostly validate errors by regex and do not assert every canonicalized field or unknown nested field behavior.
- **multi-project:** duplicate root callback و projectId validation covered (lines 94–105)؛ simultaneous projects/registry race `UNVERIFIED`.
- **تست اجرا:** unavailable due `ts-jest` missing.
- **محدودیت:** filesystem-dependent tests use synthetic temp dirs; no Windows path matrix.

## 8) `semantic-engine/src/gateway/WorkerHealthMonitor.ts`

- **نقش:** تصمیم‌گیر crash detection/restart/degraded؛ supervisor action را اجرا می‌کند (comments lines 1–16، interfaces lines 18–67).
- **Call path:** supervisor calls `track/untrack` lines 87–96 و periodic/direct `check(worker)` lines 117–197. `check` → worker PID/exit check → `worker.health()` lines 137–140 → healthy reset lines 142–153، یا crash increment/degraded lines 155–169 → emit/sleep/restart lines 171–197.
- **وابستگی:** `WorkerEvent`, `WorkerProcess` از `./WorkerProcess`; injected clock, restart, sleep, event callback. `defaultSleep` lines 200–203.
- **خطاها:** restart policy delays `[1000,3000,10000]`, max 5 lines 27–30. `healthyResetMs` فقط در healthy check counter را صفر می‌کند lines 143–148. `worker.health()` throw مستقیماً از check خارج می‌شود؛ `POTENTIAL` health exception به crash result تبدیل نمی‌شود. restart failure emit crash می‌کند ولی counter را دوباره increment نمی‌کند (lines 182–194؛ comment ادعا می‌کند crash حساب می‌شود، implementation فقط فعلی را نگه می‌دارد)؛ `POTENTIAL` policy mismatch. Concurrent `check()` calls برای یک project lock ندارد؛ `POTENTIAL` double restart.
- **multi-project:** state map key projectId lines 70–78 و هر check state جدا دارد؛ event projectId-scoped lines 99–101. هم‌زمانی cross-project بدون test این فایل `UNVERIFIED`.
- **تست مرتبط:** `WorkerSupervisor.test.ts`، که در batch است، integration policy را indirectly exercises؛ unit test مستقیم برای monitor در فهرست status دیده نشد.
- **محدودیت:** health semantics وابسته به WorkerProcess؛ restart actual supervisor خارج این فایل است.

## 9) `semantic-engine/src/gateway/WorkerSupervisor.test.ts`

- **نقش:** integration suite با process واقعی برای one-worker-per-project، lock، capacity، restart isolation، degraded، stop/cleanup، diagnostics و artifact/log location؛ `describeIfBuilt` lines 18–20.
- **Call path:** tests → `WorkerSupervisor.start/checkAll/stopAll/health/list/get/diagnostics`; worker config via `createWorkerConfig`; lock via `acquireLock`.
- **وابستگی:** child worker build artifact `dist/cli/main.js` gate line 18؛ temp fs/process signals/timers؛ `WorkerSupervisor`, `WorkerConfigSchema`, `ProjectLock` imports lines 8–11.
- **خطا/coverage:** cases lines 57–242. Strong coverage for race same project, lock held, maxWorkers, SIGKILL neighbor isolation, crash limit, stop cleanup, diagnostics and dataRoot. Failure modes startup timeout, malformed worker health, concurrent stop/start not covered (`UNVERIFIED`).
- **multi-project:** explicit A/B cases lines 106–130, 197–219; neighbor isolation and separate artifacts/logs tested. IDs are distinct.
- **تست اجرا:** suite is skipped when dist missing (`describeIfBuilt`); additionally Jest cannot load ts-jest (`Preset ts-jest not found`). Therefore no runtime evidence here.
- **محدودیت:** long real-process tests depend on compiled dist and timing sleeps; not executable in current sandbox.

## 10) `semantic-engine/src/gateway/gatewayConsole.test.ts`

- **نقش:** HTTP console/UI assets and project deep link; helper GET lines 13–44, lifecycle lines 47–67, cases lines 69–124.
- **Call path:** `GatewayServer.start()` → HTTP GET `/gateway`, `/gateway.js`, `/gateway.css`, `/visualizer`, `/visualizer.js`, deep link `/projects/:id`, protected API `/api/v1/gateway/projects`.
- **وابستگی:** Node http/fs/os/path and `GatewayServer`; temp dataRoot.
- **خطا/coverage:** public UI assets, deep-link redirect, traversal-like asset paths, and token-gated data endpoint are asserted. Unknown/malformed content types, cache headers, POST UI flows not covered (`UNVERIFIED`).
- **multi-project:** only deep-link project id is checked; no two-project console rendering/isolation (`UNVERIFIED`).
- **تست اجرا:** unavailable due ts-jest missing.
- **محدودیت:** tests server routes, not browser execution/DOM behavior; security semantics were not audited per scope.

## 11) `semantic-engine/src/gateway/lspIsolation.test.ts`

- **نقش:** Band 8 end-to-end isolation across LSP workers/projects: process PIDs, documents/URI, extraction/diagnostics/rename, crash, idle reap, teardown, parallel pipelines; setup lines 1–111 and groups lines 113–541.
- **Call path:** `LspServerManager.acquire` → injected `LspClient` fake server; then `LspSymbolExtractor`, `DiagnosticsProvider`, `InteractiveOps`, `IndexPipeline`; cleanup `disposeAll` lines 102–109.
- **وابستگی:** fake LSP fixture, registry/spec, temp projects, LSP classes, extractor factory/pipeline. Uses child process `process.execPath` and fake server.
- **خطا/coverage:** all seven groups are explicit. Crash test expects manager degradation after repeated crashes (lines ~286–357); idle reap lines ~360–404; teardown lines ~406–449; concurrent pipelines lines ~451–541. `POTENTIAL`: tests rely on fake server behavior and do not exercise a real language server or Windows URI semantics.
- **multi-project:** strongest file in batch for cross-project separation: distinct roots/specs/managers, no cross-document symbols and project A failure leaves B healthy.
- **تست اجرا:** unavailable because ts-jest missing; even with Jest, child-process prerequisites and long polling require compiled-compatible setup.
- **محدودیت:** no real VS Code/LSP binary; fake protocol coverage only.

## 12) `semantic-engine/src/gateway/metrics.test.ts`

- **نقش:** tests `DurationSummary`, `cpuPercent`, metric vocabulary and Gateway project health/metrics endpoints; helper GET/POST lines 1–82.
- **Call path:** pure functions/classes lines 84–138; `GatewayServer.start` and API POST project registration lines 153–180; GET `/metrics`, per-project health, unknown/forbidden/allowed and `/health` lines 182–229.
- **وابستگی:** Node http/fs/os/path, `metrics.ts`, `GatewayServer`.
- **خطا/coverage:** bounded window, invalid samples, CPU math, exact metric keys and per-project health isolation. Endpoint JSON parse in POST helper throws on non-JSON response (`POTENTIAL` test-helper limitation). No concurrent request/load or worker-active metrics values (`UNVERIFIED`).
- **multi-project:** two projects A/B, scoped token visibility and one project 403 while other works lines ~153–229.
- **تست اجرا:** unavailable due ts-jest missing.
- **محدودیت:** p95 convention only tested with five samples; empty/large fractional windows not tested.

## 13) `semantic-engine/src/gateway/metrics.ts`

- **نقش:** metric vocabulary and duration/CPU aggregation. Gateway/worker key contracts lines 8–31; `DurationSummary` lines 33–77؛ `cpuPercent` lines 84–92.
- **Call path:** Gateway metrics endpoint imports/uses `GATEWAY_METRIC_KEYS`; tests import all three public exports. Worker keys are vocabulary only in this file.
- **وابستگی:** `NodeJS.CpuUsage` type, no runtime external dependency.
- **خطاها:** `DurationSummary.window` accepts any number; zero/negative window causes shift behavior (negative still effectively unbounded), `POTENTIAL`. `record` silently drops NaN/negative lines 51–55. p95 uses ceil rank lines 65–66, a defined nearest-rank-like policy but no documentation for interpolation. `cpuPercent` rounds to 2 decimals and allows >100 lines 84–92.
- **multi-project:** aggregation object is instance-local; no project label/dimension. Project isolation belongs to Gateway metrics collector; `UNVERIFIED` here.
- **تست مرتبط:** `metrics.test.ts` covers basic summary/window/invalid/CPU/key uniqueness and HTTP endpoint. No dedicated worker metric emitter in this file.
- **محدودیت:** no histogram, labels, reset API or concurrency primitives by design/comments.

## 14) `semantic-engine/src/gateway/webSocketProxy.test.ts`

- **نقش:** real RFC6455 Gateway integration test: handshake, project routing, per-project message isolation, client close independence, auth/project rejection; helper lines 1–109 and tests lines 111–268.
- **Call path:** raw `net.Socket` → handshake `connectWs` → `GatewayServer`; frame encode/decode via `wsProtocol`; project register via HTTP POST helper lines ~137–170.
- **وابستگی:** Node crypto/http/net/fs/os/path, GatewayServer, FrameDecoder/encodeFrame/OPCODE; requires built worker due `describeIfBuilt` lines 22–24.
- **خطا/coverage:** handshake/greeting lines ~182–196; A/A/B routing and close lines ~198–237; unknown/missing/foreign auth lines ~239–268. Raw helper has socket timeout and `error` reject; no cleanup on failed handshake (`POTENTIAL`). Fragmented control frames, server backpressure, malformed frame and reconnect not covered (`UNVERIFIED`).
- **multi-project:** explicit A/B message isolation and scoped token.
- **تست اجرا:** skipped without `dist/cli/main.js`; Jest setup also fails before collection due ts-jest missing.
- **محدودیت:** custom frame client covers selected RFC behavior, not a browser/client library matrix.

## 15) `semantic-engine/src/gateway/workerArgv.test.ts`

- **نقش:** table-driven contract that every operational config option maps to whitelisted argv and secrets do not; config helper lines 9–28, table lines 45–184, assertions lines 186–241.
- **Call path:** `config()` → `createWorkerConfig` → `workerArgv` / `commandPreview`; flag helpers lines 30–42.
- **وابستگی:** `workerArgv`, `WorkerConfigSchema`, `ProjectWorkerConfig`; pure test except config validation.
- **خطا/coverage:** root/project/data/out, indexing, watch, service, security flags and embedding tested; deterministic/no CLI-only/secret-free/metacharacter/invalid config/preview cases lines ~187–241. `POTENTIAL`: only checks argv flags and not child environment propagation; tokenEnvVar intentionally absent.
- **multi-project:** one config/project only; no simultaneous argv generation or collision test (`UNVERIFIED`).
- **تست اجرا:** unavailable due ts-jest missing.
- **محدودیت:** ROOT is POSIX absolute path; platform-specific quoting/path not covered.

## 16) `semantic-engine/src/gateway/wsProtocol.test.ts`

- **نقش:** pure RFC6455 primitives test: accept key, upgrade detection, handshake, masking, frame round trips, chunking, multi-frame, control opcode and max frame limit; helper lines 1–17, cases lines 19–123.
- **Call path:** imports from `./wsProtocol` (lines 1–10); direct calls to `computeAcceptKey`, `isWebSocketUpgrade`, `handshakeResponse`, `maskPayload`, `FrameDecoder.push`, `encodeFrame`.
- **وابستگی:** Node `http` type and wsProtocol implementation; no network/filesystem.
- **خطا/coverage:** RFC example, masked/unmasked, 7/16/64-bit lengths and split chunks tested. Fragmentation/continuation semantics, UTF-8 validation, RSV bits, masking direction enforcement and close code validation are not tested (`UNVERIFIED`).
- **multi-project:** only project header string in handshake; no routing/project isolation (covered by webSocketProxy.test).
- **تست اجرا:** unavailable due ts-jest missing.
- **محدودیت:** tests selected protocol pieces, not actual TCP lifecycle.

## 17) `semantic-engine/src/graphs/CallGraphBuilder.ts`

- **نقش:** ساخت CallGraph از AST TS/JS با local/import/global resolution، property/member resolution، edge kind/provenance و async incremental path. Interfaces/constructor lines 13–61؛ build APIs lines 63–111؛ analysis lines 113–194؛ resolution lines 227–459؛ edge-kind logic lines 526–594؛ `ExportIndex` lines 644–683.
- **Call path:** constructor builds `SymbolIndex`, `ImportIndex`, `ExportIndex` and `fileByPath` (lines 48–61). `build/buildForFiles/buildAsync/buildForFilesAsync` → `analyzeOne` → read/parse TS → `analyzeFile` visitor → `processCallExpression` → `findCallerSymbol`, `resolveCallee`, `inferEdgeKind`.
- **وابستگی:** TypeScript parser, Node path/fs via require, project-index types, `SymbolIndex`, `ImportIndex`, `EdgeProvenance`. Files must exist and be recognized TS/JS; binary/unknown language skipped lines 113–133.
- **خطاها:** `buildForFiles` clears shared `edges`/occurrences and is mutable instance state (lines 68–80); concurrent calls on same builder can race (`POTENTIAL`). `yieldEvery=0` causes modulo-zero behavior (condition never yields; `POTENTIAL`). `readFile`/TS parse errors are not caught (lines 120–133). Global same-name fallback is deliberately `name-match` (lines 227–254), but can still produce a semantically wrong edge (`POTENTIAL/known design limitation`). `findMemberSymbol` same-file fallback may select unrelated same-file symbol (lines ~465–508; `POTENTIAL`). `isConditional` returns false at function boundary even if enclosing function is passed as callback; behavior is documented design, not necessarily defect (UNVERIFIED contract). `weaker` only explicitly downgrades name-match; other basis combinations rely on left (lines ~510–524), which may not be total ordering (`POTENTIAL`).
- **multi-project scope:** workspaceRoot is injected and file paths are joined against it (lines 113–122); Symbol/Import/Export indexes derive only from supplied arrays. No project ID/global registry; separate builders are needed for multi-project isolation (`UNVERIFIED` under concurrent shared builder).
- **تست مرتبط:** status lists `GraphBuilders.test.ts`, `GraphFacts.phase49.test.ts` and other graph tests as pending, not part of this batch; therefore no test execution/evidence available for this implementation. Existing `CallGraphBuilder` itself has no direct test in the 17.
- **محدودیت:** only TS/JS and file content from disk; no AST compiler type checker, no dynamic dispatch/type inference. Async API yields only after each N files and remains synchronous per-file (lines 92–110).

## وضعیت تست و اجرا

- دستور targeted Jest برای فایل‌های test این batch اجرا شد اما collection شکست خورد: `Preset ts-jest not found relative to rootDir .../semantic-engine`؛ بنابراین هیچ PASS/FAIL runtime نباید ادعا شود.
- `WorkerSupervisor.test.ts` و `webSocketProxy.test.ts` علاوه بر آن با `describeIfBuilt` به وجود `dist/cli/main.js` وابسته‌اند و در نبود build skip می‌شوند.
- تلاش برای `npm run build` در sandbox به timeout خورد؛ build موفق یا شکست compiler قابل اثبات نیست (`UNVERIFIED`).
- تست‌ها/فایل‌های خارج از ۱۷ مورد اجرا یا status آن‌ها تغییر داده نشدند.

## جمع‌بندی

۱۷ فایل دقیقاً بررسی شدند. یافته‌های قطعی عمدتاً قراردادها و call pathهای قابل مشاهده در source هستند؛ مواردی که به wiring بیرونی، runtime process، platform یا concurrency نیاز دارند با `UNVERIFIED/POTENTIAL` جدا شده‌اند. موردی از ممیزی امنیتی انجام نشده است.
