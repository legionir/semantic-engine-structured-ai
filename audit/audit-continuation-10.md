# ادامهٔ ممیزی — ۲۰ فایل بعدی LSP/Observability

## دامنه و روش

طبق اولین ۲۰ ردیف «درانتظار» در `AUDIT_FILE_STATUS.md`، فایل‌های ردیف 345 تا 364 بررسی شدند؛ یعنی ۱۸ فایل زیر `src/lsp/` و دو فایل MetricsCollector در `src/observability/`. هر فایل کامل و خط‌به‌خط خوانده شد. امنیت خارج از scope بود. مسیرهای call path بر اساس import/exportهای همین فایل‌ها و تست‌های مرتبط ثبت شده‌اند.

## Findings قطعی

### F-01 — override آرگومان‌های سرور بدون `command` در Registry اعمال نمی‌شود

- **Severity:** متوسط — correctness/configuration
- **مسیر/خطوط:** `semantic-engine/src/lsp/config.ts:67-81`; `semantic-engine/src/lsp/registry.ts:259-288`
- **Evidence verbatim:**
  - `config.ts:72-74`: `const args = Array.isArray(entry.args) ...`
  - `config.ts:80-81`: `if (!command && !disabled && !args) continue;` و `out[id] = { command, args, disabled };`
  - `registry.ts:261-263`: `const override = this.options.overrides?.[spec.id];` و `if (override?.disabled) return null;`
  - `registry.ts:264-278`: فقط داخل `if (override?.command)`، آرگومان override مصرف می‌شود: `args: override.args ?? spec.args`
  - `registry.ts:281-288`: اگر command override وجود نداشته باشد، `spec.resolveCommand(...)` فراخوانی می‌شود و نتیجه مستقیماً برگردانده می‌شود.
- **Call path:** `lspSettingsFrom(Config)` → `normalizeOverrides` (args را نگه می‌دارد) → ساخت `LspServerRegistry({ overrides })` → `resolveSpec`/`resolveForLanguage`. برای overrideهایی مثل `{ typescript: { args: [...] } }`، شاخهٔ `override.command` اجرا نمی‌شود؛ resolver اختصاصی TypeScript args پیش‌فرض `['--lsp','--stdio']` را برمی‌گرداند و args کاربر دور ریخته می‌شود.
- **نتیجه:** API نوع `ServerOverride` و normalization، args مستقل از command را معتبر می‌دانند، اما Registry آن را فقط زمانی اعمال می‌کند که command هم داده شده باشد. بنابراین تنظیم معتبر و مستندشدهٔ args-only اثر ندارد.
- **تست مرتبط:** `src/lsp/config.test.ts:83-97` فقط خواندن args از Config را می‌سنجد؛ تستی در فایل‌های بررسی‌شده وجود ندارد که args-only را از Registry تا resolve دنبال کند. `registry.test.ts:168-209` فقط override همراه command، نام command روی PATH و disabled را پوشش می‌دهد.
- **محدودیت/دامنه:** اثر روی همهٔ specها زمانی رخ می‌دهد که resolver اختصاصی داشته باشند یا مسیر عادی به `spec.args` برگردد؛ در مسیر عادی نیز args-only override در `resolveSpec` به `spec.args` سقوط می‌کند. اصلاح باید semantics را صریح کند (مثلاً merge/override args پس از resolve، بدون تغییر command).

## بررسی فایل‌به‌فایل

### `src/lsp/LspServerManager.test.ts`

- **نقش:** تست چرخهٔ عمر LSP-05/LSP-06: spawn lazy، اشتراک، fallback، crash/backoff/degraded، reap، memory limit و readiness.
- **Call path:** `managerWith` → `LspServerManager` با `LspServerRegistry` ساختگی و `LspClient` روی `__fixtures__/fakeLspServer.js`؛ تست‌ها APIهای عمومی manager را exercise می‌کنند.
- **وابستگی/تست مرتبط:** `LspServerManager.ts`, `registry.ts`, `readiness.ts`, `processMemory.ts`, `LspClient.ts`, fake server.
- **یافته:** finding قطعی مستقیمی فراتر از F-01 ثبت نشد. ادعای «بعد از سه شکست» با پیاده‌سازی `failures >= maxRestarts` هم‌خوان است؛ هرچند متن طراحی «تا ۳ بار restart» از نظر شمارش می‌تواند تفسیری متفاوت داشته باشد (**POTENTIAL/UNVERIFIED**، نه finding قطعی).

### `src/lsp/LspServerManager.ts`

- **نقش:** مالک lifecycle و اشتراک server per language؛ acquire/start، exit failure accounting، backoff، readiness، idle reap، RSS restart و dispose.
- **Call path:** pipeline/مصرف‌کننده → `acquire(languageId)` → registry resolve → `start` → `LspClient.start`, `ReadinessTracker.waitUntilReady`; maintenance → `reapIdle` و `enforceMemoryLimit`; client exit → `handleExit` → `noteFailure`.
- **multi-project scope:** یک manager با `workspaceRoot` واحد است؛ isolation بین پروژه‌ها با instance جدا و registry resolve همان root انجام می‌شود.
- **محدودیت:** restart پس‌زمینه‌ای نیست؛ پس از crash فقط acquire بعدی تلاش می‌کند (خطوط 20-33 و 429-441). readiness از `Date.now()` داخلی tracker استفاده می‌کند، نه `options.now` manager (خطوط 334-370 و readiness.ts:126-156)، بنابراین clock تزریقی manager زمان readiness را کنترل نمی‌کند (**POTENTIAL/UNVERIFIED**؛ در رفتار عادی correctness ثابت‌شده‌ای نقض نشده).
- **تست:** همین `LspServerManager.test.ts`؛ اجرا به علت نبود dependencyها ممکن نشد (Issues).

### `src/lsp/WorkspaceEdit.test.ts`

- **نقش:** تست تبدیل range به offset، UTF-16/BOM/CRLF، overlap، root boundary، plan/dry-run، documentChanges و apply.
- **Call path:** test → `planWorkspaceEdit`/`applyTextEdits`/`resolveInsideRoot`/`applyEditPlan`.
- **نتیجه:** پوشش مستقیم و مناسبی برای رفتار موجود؛ finding قطعی ثبت نشد.

### `src/lsp/WorkspaceEdit.ts`

- **نقش:** ساخت plan و اعمال TextEditها روی فایل‌های workspace؛ اجرای edits از آخر به اول و رد overlap/file operations.
- **Call path:** مصرف‌کنندهٔ rename/code-action → `planWorkspaceEdit` → `collectEdits`/`resolveInsideRoot`/`applyTextEdits` → `applyEditPlan`.
- **تست:** `WorkspaceEdit.test.ts`.
- **محدودیت ثبت‌شده:** `applyEditPlan` در خطوط 112-119 فایل‌ها را ترتیبی می‌نویسد و rollback ندارد؛ اگر write فایل بعدی fail شود، بخشی از plan اعمال شده و «همه یا هیچ» docstring (خطوط 11-12) تضمین نمی‌شود (**POTENTIAL/UNVERIFIED** چون failure injection تست نشده؛ از scope امنیت خارج است).

### `src/lsp/__fixtures__/fakeLspServer.js`

- **نقش:** fake LSP مستقل برای تست framing، handshake، symbols، diagnostics، edits، crash/hang و lifecycle بدون نصب server.
- **Call path:** تست‌ها → `LspClient` child process → stdio Content-Length parser → `handle(message)`.
- **تست مرتبط:** `LspServerManager.test.ts`, `readiness.test.ts`, `fakeServerContract.integration.test.ts`, تست‌های سایر LSP که در audit قبلی کامل شده‌اند.
- **نتیجه:** finding قطعی ثبت نشد؛ عمداً تفاوت hierarchy و error code با real server در contract test ثبت شده است.

### `src/lsp/config.test.ts`

- **نقش:** تست defaults، فایل/ENV/nested Config، normalization override و mapping به manager options.
- **Call path:** test → `Config.load` → `lspSettingsFrom` → `managerOptionsFrom`.
- **نتیجه:** F-01 را از نظر read/normalize نشان می‌دهد ولی end-to-end registry args-only را نمی‌سنجد.

### `src/lsp/config.ts`

- **نقش:** ترجمه Config به `LspSettings` و `LspServerManagerOptions` و normalization امن‌نوع overrideها.
- **Call path:** `Config.get` برای کلیدهای `semanticEngine.lsp.*`; `normalizeOverrides` خروجی Registry را می‌سازد.
- **نتیجه:** در F-01 به‌عنوان upstream evidence استفاده شد؛ خود normalization args را درست نگه می‌دارد.

### `src/lsp/fakeServerContract.integration.test.ts`

- **نقش:** مقایسهٔ شکل پاسخ fake و TypeScript واقعی برای initialize, symbols, errors, sync و shutdown.
- **Call path:** `resolveTypeScriptLspCommand()` → real `LspClient` و fake `LspClient` → مقایسهٔ shape.
- **محدودیت:** محیط‌محور و وابسته به native TypeScript LSP؛ اجرای آن بدون نصب/بسته‌های تست ممکن نیست. finding کدی قطعی ثبت نشد.

### `src/lsp/lspTesting.test.ts`

- **نقش:** guard تستی برای جلوگیری از وابستگی unit tests به real LSP و آزمون orphan cleanup.
- **Call path:** walk source tree → regex/static checks؛ سپس spawn fake server و SIGKILL والد.
- **نتیجه:** finding قطعی ثبت نشد.

### `src/lsp/processMemory.ts`

- **نقش:** resident RSS از `/proc/<pid>/status` و fallback به `ps`؛ `null` در سیستم غیرقابل‌اندازه‌گیری.
- **Call path:** `LspServerManager.status` و `enforceMemoryLimit` → `residentMemoryMb`.
- **نتیجه:** finding قطعی ثبت نشد؛ ویندوز عمداً null است.

### `src/lsp/protocol.ts`

- **نقش:** subset typeهای LSP: symbols, capabilities, diagnostics, progress و JSON-RPC constants.
- **Call path:** مصرف‌کنندگان LspClient/LSP providers؛ import مستقیم در فایل‌های مرتبط.
- **نتیجه:** finding قطعی ثبت نشد.

### `src/lsp/readiness.test.ts`

- **نقش:** تست سه لایهٔ readiness: progress، serverStatus و active documentSymbol probe، به‌علاوهٔ memory.
- **Call path:** fake LSP → `ReadinessTracker.attach/isBusy/waitUntilReady`.
- **نتیجه:** finding قطعی ثبت نشد.

### `src/lsp/readiness.ts`

- **نقش:** tracking progress/quiescent و polling readiness با backoff؛ probe خطا را warming تلقی می‌کند.
- **Call path:** manager `start` → `waitForReadiness` → tracker؛ tracker → `LspClient.withDocument/documentSymbol`.
- **محدودیت:** timeout با wall clock واقعی (`Date.now`) و probe timeout ثابت ۵۰۰۰ms است (خطوط 126 و 171). این با clock تزریقی manager هماهنگ نیست (**POTENTIAL/UNVERIFIED**).

### `src/lsp/registry.test.ts`

- **نقش:** جدول serverها، PATH/rootMarkers، override، doctor و missing messages.
- **Call path:** registry با TEST_SPECS → resolve/detect methods؛ TypeScript resolve اختصاصی عمداً حذف شده تا unit test محیط‌محور نشود.
- **نتیجه:** F-01 را پوشش نمی‌دهد؛ finding قطعی دیگری ثبت نشد.

### `src/lsp/registry.ts`

- **نقش:** فهرست ۹ LSP، انتخاب بر اساس language/root markers، binary discovery، override و doctor detection.
- **Call path:** manager `resolveForLanguage`؛ CLI doctor `detectAll`؛ Config overrides از `config.ts`.
- **نتیجه:** F-01 در خطوط 259-288.

### `src/lsp/typescriptServer.integration.test.ts`

- **نقش:** آزمون محیط واقعی native-preview و registry bundled TypeScript.
- **Call path:** module-level `resolveTypeScriptLspCommand()` سپس LSP registry detection.
- **محدودیت:** deliberately نیازمند package/binary واقعی؛ unit نیست. finding قطعی ثبت نشد.

### `src/lsp/typescriptServer.test.ts`

- **نقش:** unit test parsing/version gate، selection، env override، missing behavior و help message.
- **Call path:** injected `exists/probeVersion` → `resolveTypeScriptLspCommand` بدون spawn واقعی.
- **نتیجه:** finding قطعی ثبت نشد.

### `src/lsp/typescriptServer.ts`

- **نقش:** کشف TypeScript LSP با env، native-preview، package candidate و PATH؛ version gate major >= 7.
- **Call path:** registry default TypeScript spec → `resolveTypeScriptLspCommand`؛ integration/doctor message.
- **نتیجه:** finding قطعی ثبت نشد.

### `src/observability/MetricsCollector.test.ts`

- **نقش:** تست smoke بسیار کوچک برای MetricsCollector.
- **Call path:** تست فقط `new MetricsCollector()` را import/instantiate می‌کند.
- **محدودیت قطعی تستی:** فایل ۱۴ خطی تنها ساختن collector را می‌سنجد و هیچ metric/flush/snapshot behavior را assert نمی‌کند؛ این ضعف پوشش است نه bug production. **POTENTIAL/UNVERIFIED**.

### `src/observability/MetricsCollector.ts`

- **نقش:** جمع‌آوری counter/gauge/histogram، snapshot و reset.
- **Call path:** instrumentation callers → `increment`, `setGauge`, `observe`; readers → `snapshot`; lifecycle → `reset`.
- **نتیجه:** finding قطعی production ثبت نشد.

## تست‌ها و محدودیت اجرا

- `npm test -- --runInBand ...` اجرا نشد: hook `pretest` در `scripts/gen-fixture.js` با `ENOENT` شکست خورد هنگام `mkdir '/tasklet/threads/a_pjgnxp3j2201gp81brsm/work/repo/semantic-engine/test-fixture/node_modules/left-pad'`؛ parent directory `test-fixture/node_modules` موجود نبود.
- اجرای مستقیم `npx jest ...` نیز نشد: `Preset ts-jest not found relative to rootDir .../semantic-engine`.
- `npm run build` نیز نشد: `sh: 1: tsc: not found`.

## جمع‌بندی

یک finding قطعی correctness ثبت شد: args-only server override در Registry اعمال نمی‌شود (`F-01`). سایر موارد مشاهدات پوشش/محدودیت یا POTENTIAL/UNVERIFIED هستند و به‌عنوان finding قطعی گزارش نشده‌اند.
