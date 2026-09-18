# گزارش نهایی batch 2

تاریخ بررسی: 2026-09-17. دامنه: نقش فایل، call path، وابستگی‌ها، خطاهای قابل اثبات، multi-project scope، تست مرتبط و محدودیت. امنیت خارج از scope است؛ بنابراین موارد امنیتی صرفاً به‌عنوان context معماری ثبت شده‌اند و finding امنیتی محسوب نمی‌شوند. همه شواهد زیر از خود فایل‌ها و با line number استخراج شده‌اند.

## نتیجه اجرای تست

- دستور اجراشده: `npx jest src/server/SecurityPipeline.test.ts src/server/gatewayManagedSecurity.test.ts src/server/requestPathBlocking.test.ts src/server/runtimeArtifacts.test.ts src/services/LodService.test.ts src/services/analysis/ArchitectureRuleEngine.test.ts src/services/analysis/ImpactAnalysisEngine.test.ts --runInBand`
- نتیجه: اجرا نشد؛ Jest خطای قطعی `Preset ts-jest not found relative to rootDir .../semantic-engine` داد.
- `npm run build` نیز اجرا نشد: `sh: 1: tsc: not found`.
- `npm run check:audit` اجرا نشد: فایل `semantic-engine/AUDIT-2026-08.md` وجود ندارد (`ENOENT`). این خطاها در وضعیت/یافته‌های زیر به‌عنوان issue محیط اجرا ثبت شده‌اند، نه failure کد.

## بررسی فایل‌ها

### 1. `src/server/SecurityPipeline.test.ts`
- نقش: unit/integration tests برای `SecurityPipeline.maskSecrets` و `checkOrigin`؛ شواهد: import در خطوط 8–9 و suiteهای خطوط 20 و 133.
- call path: تست‌ها مستقیماً `pipeline()` (خطوط 11–18) را ساخته و `maskSecrets`/`checkOrigin` را در خطوط 43–49، 64–71، 142–166 فراخوانی می‌کنند.
- وابستگی‌ها: Node `http` (خط 8) و `./SecurityPipeline` (خط 9).
- finding قطعی: در فایل خطای پیاده‌سازی تولید نمی‌شود؛ این فایل regression contract است. شواهد verbatim: `expect(results[0]).toBe('******');` (خط 49) و `it('Origin بیرونی رد می‌شود'` (خط 142).
- multi-project scope: در هر نمونه `PlatformConfig` مستقل با `port: 0`, `host: '127.0.0.1'`, `token: 'test-token'` (خطوط 12–17)؛ تست پروژه/registry ندارد. scope عملاً process-local است.
- تست مرتبط: خود فایل، 14 تست (خطوط 33–166).
- محدودیت: تست‌ها به‌علت نبود `ts-jest` اجرا نشدند (خطای دقیق بالا). امنیت خارج از scope.

### 2. `src/server/SecurityPipeline.ts`
- نقش: لایه مشترک validation/connection/auth/origin/security-header و redaction برای HTTP server.
- call path: `SecurityPipeline` در خط 81 export می‌شود؛ متدهای `checkConnection` (89)، `authenticate` (128)، `validateSchema` (156)، `checkOrigin` (182)، `isTrustedGateway` (236)، `applySecurityHeaders` (250)، `maskSecrets` (282). import در `HttpServer` توسط تست‌های gateway (test خط 22) تأیید می‌شود.
- وابستگی‌ها: `http` (5)، `ajv`/`ajv-formats` (6–7)، `PlatformConfig` (8)، `isLoopbackHost` (9).
- finding قطعی: در فایل source، الگوهای کلید حساس non-global هستند و `Ajv` به‌صورت module singleton ساخته می‌شود؛ شواهد: `new Ajv({ allErrors: true, coerceTypes: true })` (خط 11) و `const SECRET_KEY_PATTERNS = [` (38) بدون `g`. این مشاهده با تست regression خطوط 24–31 فایل test مستند شده است.
- multi-project scope: config در constructor تزریق می‌شود (84) اما AJV و patternها process-wide هستند؛ هیچ projectId در APIهای این کلاس وجود ندارد. نتیجه: قرارداد multi-project باید از caller/context بیاید؛ تأیید end-to-end در این فایل وجود ندارد.
- تست مرتبط: `SecurityPipeline.test.ts` و `gatewayManagedSecurity.test.ts`.
- محدودیت: تست/build به علت missing `ts-jest`/`tsc` اجرا نشد؛ امکان نتیجه runtime جدید وجود ندارد.

### 3. `src/server/SseManager.ts`
- نقش: مدیریت clientهای Server-Sent Events و heartbeat/broadcast.
- call path: `SseManager` در 20؛ `addClient` در 31، `broadcast` در 69، `sendToClient` در 82، `startHeartbeat` در 100، `close` در 113 و `activeClientsCount` در 127.
- وابستگی‌ها: فقط Node `http` (5)؛ `SseClient` و `SseEvent` در خطوط 7 و 14.
- finding قطعی: state manager در APIها با `projectId` تفکیک می‌شود (امضای `addClient(projectId: string,...)` خط 31 و `broadcast(projectId: string,...)` خط 69) و heartbeat/close lifecycle داخلی دارد (100–125). finding functional قطعی دیگری بدون اجرای تست قابل اثبات نیست.
- multi-project scope: project-scoped broadcast در امضای public API وجود دارد؛ client registry داخلی است. تست/اثبات cross-project در batch وجود ندارد؛ **UNVERIFIED**.
- تست مرتبط: تست مستقیمی در 7 فایل pending نیست؛ wiring باید از callerهای server بررسی شود.
- محدودیت: نبود تست اختصاصی و نبود اجرای build/runtime؛ رفتار close/error روی disconnected response **UNVERIFIED**.

### 4. `src/server/WebSocketManager.ts`
- نقش: EventEmitter manager برای ثبت client و broadcast فرمان graph.
- call path: class در 19؛ `registerClient` 22، `unregisterClient` 26، `broadcastCommand(projectId, command)` 30، `getActiveClientsCount` 47، `close` 51.
- وابستگی‌ها: `http` (5) و `EventEmitter` (6).
- finding قطعی: broadcast API دارای `projectId` و `AgentGraphCommand` است (خطوط 8–17 و 30)؛ manager از EventEmitter ارث می‌برد (19). مورد قطعی دیگری از خود فایل استنتاج نمی‌شود.
- multi-project scope: projectId در broadcast وارد می‌شود، اما registry با `ServerResponse` نگهداری می‌شود؛ اثبات filter درست بر projectId از این فایل به‌تنهایی ممکن نیست، **UNVERIFIED**.
- تست مرتبط: تست اختصاصی در pending batch یافت نشد.
- محدودیت: نبود تست مستقیم و نبود build؛ delivery/error/backpressure و cross-project isolation **UNVERIFIED**.

### 5. `src/server/gatewayManagedSecurity.test.ts`
- نقش: integration tests برای worker gateway-managed و standalone، connection/origin/auth/path isolation.
- call path: imports خطوط 17–22 (`fs`, `http`, `os`, `path`, `HttpServer`, `SecurityPipeline`)، suiteها خطوط 116 و 174 و 365؛ HTTP assertions خطوط 201–359 و 388–414.
- وابستگی‌ها: Node fs/http/os/path، `HttpServer`, `SecurityPipeline`.
- finding قطعی: test contract صریحاً Unix socket + internal token (201)، نبود token را reject (211)، نبود route unauthenticated (219)، بستن registry routes (253)، confined fs browse (286)، foreign path reject (317) و direct browser reject (342) را بررسی می‌کند؛ این‌ها assertions تست‌اند، نه نتیجه اجرای موفق.
- multi-project scope: foreign path و project/registry routes در lines 253–317 پوشش داده شده‌اند؛ نتیجه runtime **UNVERIFIED** چون Jest اجرا نشد.
- تست مرتبط: خود فایل، 435 خط و suiteهای بالا.
- محدودیت: اجرای تست به `Preset ts-jest not found` متوقف شد؛ بنابراین pass/fail واقعی این assertions قابل گزارش نیست.

### 6. `src/server/requestPathBlocking.test.ts`
- نقش: performance/responsiveness integration tests برای static assets، `/health` و fs listing.
- call path: `HttpServer` import خط 19؛ suite خط 21؛ تست‌ها خطوط 74، 88، 103، 116.
- وابستگی‌ها: fs/http/os/path (15–18)، `HttpServer` (19).
- finding قطعی: تست‌ها explicitly concurrency را هدف گرفته‌اند: `serves many static assets concurrently` (74)، `answers /health while a directory listing is in flight` (88)، و چند listing همزمان (103). این نام‌ها و کد تست evidence قراردادی هستند؛ finding performance runtime بدون اجرا **UNVERIFIED**.
- multi-project scope: تست hint برای indexed/plain project folder دارد (116)، اما isolation چند project را اثبات نمی‌کند؛ **UNVERIFIED**.
- تست مرتبط: خود فایل.
- محدودیت: Jest اجرا نشد؛ latency و concurrency outcome قابل اندازه‌گیری نبود.

### 7. `src/server/routes/authRoutes.ts`
- نقش: factory مسیرهای auth/API-key و role discovery/verification.
- call path: `createAuthRoutes(apiKeyStore)` خط 9؛ handlerها `getRolesHandler` خط 10، `createKeyHandler` خط 18 و `verifyHandler` خط 56.
- وابستگی‌ها: `RouteDefinition`, `HttpRequestContext` (5)، `ApiKeyStore` (6)، `ROLE_DEFAULT_PERMISSIONS`, `PlatformRole` (7).
- finding قطعی: route factory به یک `ApiKeyStore` تزریق‌شده وابسته است (خط 9) و routeهای create/verify در همان factory تعریف می‌شوند (18 و 56). شواهد verbatim: `createAuthRoutes(apiKeyStore: ApiKeyStore)` (9).
- multi-project scope: امضا هیچ projectId ندارد (9)؛ store مشترک/جداگانه بودن آن توسط caller تعیین می‌شود و از این فایل قابل اثبات نیست، **UNVERIFIED**.
- تست مرتبط: pending test مستقیم برای authRoutes در batch نیست؛ `gatewayManagedSecurity.test.ts` route exposure را بررسی می‌کند.
- محدودیت: تست مستقیم و build unavailable؛ permission/tenant behavior **UNVERIFIED**.

### 8. `src/server/routes/systemRoutes.ts`
- نقش: factory مسیرهای system/readiness.
- call path: `createSystemRoutes(getReadiness = ...)` خط 17؛ snapshot interface خط 12.
- وابستگی‌ها: فقط `RouteDefinition` از `../types` (5).
- finding قطعی: readiness از callback تزریق می‌شود و default snapshot دارد؛ شواهد: `export function createSystemRoutes(` (17) و `getReadiness: () => ReadinessSnapshot = () => ({` (18).
- multi-project scope: `ReadinessSnapshot`/callback projectId ندارند (12–18)، پس route در این فایل global/system scope است؛ project-specific readiness **UNVERIFIED**.
- تست مرتبط: تست مستقیم pending ندارد؛ `runtimeArtifacts.test.ts` به state/runtime server می‌پردازد.
- محدودیت: بدون build/test نمی‌توان status code یا route table خروجی را runtime تأیید کرد.

### 9. `src/server/runtimeArtifacts.test.ts`
- نقش: integration tests تضمین می‌کند process state خارج source tree در `<dataRoot>/runtime` ذخیره شود.
- call path: imports خطوط 8–11؛ suite خط 13؛ تست‌ها خطوط 27 و 45.
- وابستگی‌ها: fs/os/path و `HttpServer`.
- finding قطعی: intended contract در نام و assertions تست است: `writes jobs and telemetry under <dataRoot>/runtime` (27) و `persists nothing when no data root is configured` (45). این outcomeها به‌علت عدم اجرای Jest **UNVERIFIED** هستند.
- multi-project scope: data root از per-server test setup می‌آید؛ multi-project isolation صریحاً تست نشده، **UNVERIFIED**.
- تست مرتبط: خود فایل.
- محدودیت: `ts-jest` missing؛ هیچ نتیجه pass/fail یا artifact filesystem جدیدی معتبر نیست.

### 10. `src/services/LodService.test.ts`
- نقش: unit tests سرویس Semantic Level of Detail در چهار سطح architecture/module/file/neighborhood.
- call path: imports خطوط 5–9؛ `describe` خط 11؛ تست‌ها خطوط 87، 95، 102، 110.
- وابستگی‌ها: `LodService`, `ManagedProject`, `ProjectIndex`, `ProjectIndexReader`, `makeConfidence`.
- finding قطعی: fixture یک `ProjectIndex` و `ManagedProject` را در خطوط 14–85 می‌سازد و چهار قرارداد level را در خطوط 87–114 نام‌گذاری/بررسی می‌کند. نتیجه runtime **UNVERIFIED** به‌دلیل عدم اجرای Jest.
- multi-project scope: fixture یک project است؛ هیچ test برای دو project یا isolation وجود ندارد، **UNVERIFIED**.
- تست مرتبط: خود فایل (4 test).
- محدودیت: عدم وجود `ts-jest`; correctness خروجی LoD تأیید نشد.

### 11. `src/services/analysis/AnalysisGraph.ts`
- نقش: in-memory directed graph abstraction برای analysis nodes/edges.
- call path: interfaces `AnalysisNode` (5)، `AnalysisEdge` (12)، class (20)؛ methods `addNode` 25، `getNode` 29، `getAllNodes` 33، `addEdge` 37، incoming/outgoing/all edges 54–62.
- وابستگی‌ها: dependency import ندارد.
- finding قطعی: graph API node/edge metadata را typed تعریف می‌کند و edgeهای incoming/outgoing را query می‌کند؛ شواهد: `getIncomingEdges(targetId: string)` (54)، `getOutgoingEdges(sourceId: string)` (58). خطای قطعی source بدون runtime/test قابل اثبات نیست.
- multi-project scope: هیچ projectId در `AnalysisNode`/`AnalysisEdge` یا class API دیده نمی‌شود؛ graph باید per-analysis/per-project instance باشد، اما ownership/caller از این فایل مشخص نیست؛ cross-project contamination **UNVERIFIED**.
- تست مرتبط: `ArchitectureRuleEngine.test.ts` و `ImpactAnalysisEngine.test.ts` آن را import می‌کنند (هر دو خط 2).
- محدودیت: نبود تست مستقیم برای duplicate node/edge یا mutation semantics؛ build اجرا نشد.

### 12. `src/services/analysis/ArchitectureRuleEngine.test.ts`
- نقش: unit tests چرخه‌ها و layer bypass روی `AnalysisGraph`.
- call path: imports lines 1–2؛ suite line 4؛ tests lines 5 و 24.
- وابستگی‌ها: `ArchitectureRuleEngine`, `AnalysisGraph`.
- finding قطعی: تست اول صراحتاً Tarjan SCC cycle detection را هدف می‌گیرد (5) و تست دوم layer violation را (24). این فقط intended behavior است؛ نتیجه اجرا **UNVERIFIED**.
- multi-project scope: graph fixture محلی است و project boundary ندارد؛ **UNVERIFIED**.
- تست مرتبط: خود فایل، 2 test.
- محدودیت: Jest به `ts-jest` نرسید؛ هیچ pass/fail معتبر نیست.

### 13. `src/services/analysis/ImpactAnalysisEngine.test.ts`
- نقش: unit test برای blast radius/risk estimation.
- call path: imports lines 1–2؛ suite line 4؛ test line 5.
- وابستگی‌ها: `ImpactAnalysisEngine`, `AnalysisGraph`.
- finding قطعی: قرارداد تست `computes 3-tier impact and risk score for a modified symbol` (خط 5) است؛ خروجی runtime به علت test environment **UNVERIFIED**.
- multi-project scope: یک graph محلی و یک modified symbol؛ multi-project isolation تست نشده، **UNVERIFIED**.
- تست مرتبط: خود فایل، یک test.
- محدودیت: Jest/ts-jest missing؛ correctness risk score تأیید نشده.

### 14. `tree-sitter-grammars/tree-sitter-go.wasm`
- نقش: compiled Tree-sitter Go grammar artifact برای parser/scanner.
- call path: artifact binary است و call path متنی ندارد؛ مصرف‌کننده باید loader/grammar registry خارج این فایل باشد.
- وابستگی‌ها: binary WASM؛ size `217182 bytes`.
- finding قطعی: فایل وجود دارد و non-empty است (metadata filesystem). محتوای WASM بدون اجرای loader قابل ارزیابی خط‌به‌خط نیست؛ error **UNVERIFIED**.
- multi-project scope: artifact immutable/shared و project-neutral است؛ ownership/runtime loading **UNVERIFIED**.
- تست مرتبط: هیچ تست pending مستقیم grammar artifact ندارد.
- محدودیت: binary را نمی‌توان line-by-line تحلیل کرد؛ hash/ABI/load موفق بررسی نشد.

### 15. `tree-sitter-grammars/tree-sitter-java.wasm`
- نقش: compiled Tree-sitter Java grammar.
- call path: فقط از grammar loader بیرونی؛ در خود binary call path قابل مشاهده نیست.
- وابستگی‌ها: WASM؛ size `414641 bytes`.
- finding قطعی: artifact non-empty موجود است. صحت grammar/نسخه/ABI **UNVERIFIED**.
- multi-project scope: shared parser artifact، project-neutral؛ loading isolation **UNVERIFIED**.
- تست مرتبط: تست مستقیم pending ندارد.
- محدودیت: binary line evidence ندارد؛ build/test به dependencies محلی دسترسی نداشت.

### 16. `tree-sitter-grammars/tree-sitter-javascript.wasm`
- نقش: compiled JavaScript grammar برای scanner/parser.
- call path: loader خارجی، در binary قابل مشاهده نیست.
- وابستگی‌ها: WASM؛ size `411770 bytes`.
- finding قطعی: فایل non-empty است. parse compatibility **UNVERIFIED**.
- multi-project scope: artifact shared و بدون project state؛ loader scope **UNVERIFIED**.
- تست مرتبط: تست pending مستقیم ندارد؛ fixture generator JavaScript files ایجاد می‌کند اما تست اجرا نشد.
- محدودیت: عدم امکان line-by-line؛ runtime load/hash validation انجام نشد.

### 17. `tree-sitter-grammars/tree-sitter-python.wasm`
- نقش: compiled Python grammar.
- call path: loader خارجی.
- وابستگی‌ها: WASM؛ size `457883 bytes`.
- finding قطعی: artifact non-empty موجود است؛ version/ABI/parse behavior **UNVERIFIED**.
- multi-project scope: shared/project-neutral؛ loader isolation **UNVERIFIED**.
- تست مرتبط: تست مستقیم ندارد؛ fixture Python دارد ولی pipeline تست نشد.
- محدودیت: binary line-by-line نیست و ابزار WASM validation اجرا نشد.

### 18. `tree-sitter-grammars/tree-sitter-rust.wasm`
- نقش: compiled Rust grammar.
- call path: loader خارجی.
- وابستگی‌ها: WASM؛ size `1113644 bytes`.
- finding قطعی: فایل non-empty است؛ هیچ finding قطعی درباره parser correctness از metadata حاصل نمی‌شود.
- multi-project scope: shared artifact؛ scope loader **UNVERIFIED**.
- تست مرتبط: تست مستقیم pending ندارد.
- محدودیت: binary opaque؛ build/test dependency failure.

### 19. `tree-sitter-grammars/tree-sitter-tsx.wasm`
- نقش: compiled TSX grammar برای JSX/TSX scanning.
- call path: loader خارجی.
- وابستگی‌ها: WASM؛ size `1445638 bytes`.
- finding قطعی: artifact non-empty موجود است؛ load/parse correctness **UNVERIFIED**.
- multi-project scope: shared/project-neutral؛ isolation **UNVERIFIED**.
- تست مرتبط: fixture `src/ui/Panel.tsx` دارد، اما test pipeline اجرا نشد.
- محدودیت: line-by-line ممکن نیست؛ ABI/version تأیید نشده.

### 20. `tree-sitter-grammars/tree-sitter-typescript.wasm`
- نقش: compiled TypeScript grammar.
- call path: loader خارجی.
- وابستگی‌ها: WASM؛ size `1413849 bytes`.
- finding قطعی: artifact non-empty موجود است؛ grammar loading و parse result **UNVERIFIED**.
- multi-project scope: shared artifact؛ project association توسط loader بیرونی تعیین می‌شود و در binary نیست.
- تست مرتبط: fixture TypeScript متعدد دارد، اما تست/build اجرا نشد.
- محدودیت: binary opaque؛ hash/ABI/runtime validation انجام نشد.

## جمع‌بندی findings

Finding قطعی functional در این batch از source قابل اثبات نشد؛ بیشتر موارد تست/قرارداد هستند و به‌علت dependencyهای ناقص قابل اجرای runtime نیستند. دو خطای محیطی قطعی ثبت شد: missing `ts-jest` برای Jest و missing `tsc` برای build؛ audit checker نیز به missing `AUDIT-2026-08.md` برخورد کرد. مواردی که نیاز به اجرای تست، loader یا caller دارند عمداً **UNVERIFIED/POTENTIAL** نگه داشته شدند و امنیت خارج از scope باقی ماند.
