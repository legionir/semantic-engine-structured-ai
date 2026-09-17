# ادامه ممیزی — ۲۰ فایل بعدی

محدوده: نقش، مسیر فراخوانی، وابستگی، خطا، multi-project scope، تست مرتبط و محدودیت. امنیت عمداً خارج از scope است. فقط یافته‌های قطعی با evidence verbatim در بخش Findings آمده‌اند؛ موارد احتمالی در بخش Potential/Unverified.

## Findings قطعی

### F-01 — rename هم‌محتوا همهٔ symbolهای فایل را حذف می‌کند
- **شدت/اثر:** High؛ پس از rename موفق، فایل در `files[]` باقی می‌ماند اما symbolهای قبلی از `symbols[]` حذف می‌شوند و `symbolIds/outline` با محتوای واقعی ناسازگار می‌شود.
- **فایل/خط:** `semantic-engine/src/incremental/IncrementalEngine.ts:547-555`
- **Evidence verbatim:** `if (newHash === oldFile.hash) {`، سپس `this.store.removeFile(oldFile.id);` و `this.store.upsertFile(updatedFile);`.
- **مسیر:** `FileWatcher` رویداد `renamed` را به `IncrementalEngine.applyChanges` می‌دهد؛ `applyChangesUnsafe` به `handleRename` می‌رسد. در branch هم‌محتوا، `removeFile` symbolها را حذف می‌کند و `updatedFile` همان `oldFile` را با `symbolIds` نگه می‌دارد، اما برخلاف branchهای create/modify (`IncrementalEngine.ts:524-525` و `211-212`) هیچ `setSymbolsForFile`ای انجام نمی‌شود.
- **وابستگی/دامنه:** `ProjectIndexStore.removeFile/upsertFile`، `FileIdGenerator`؛ مستقل از workspace و برای هر project/gateway worker رخ می‌دهد.
- **تست مرتبط:** `src/incremental/IncrementalEngine.phase25.test.ts` تست پایداری id را دارد، اما symbol parity بعد از rename هم‌محتوا را بررسی نمی‌کند؛ `src/gateway/multiProject.e2e.test.ts` (خارج از این ۲۰ فایل) مسیر چندپروژه را پوشش می‌دهد.
- **محدودیت:** rename با محتوای متفاوت وارد branch دیگری می‌شود و این finding دربارهٔ آن branch نیست.

### F-02 — watcher برای فایل‌های هم‌محتوا با یک hash، رویداد rename را overwrite می‌کند
- **شدت/اثر:** Medium؛ چند rename هم‌زمان/نزدیک با محتوای یکسان می‌تواند یکی از pending eventها را از دست بدهد و رویدادهای غلط یا ناقص تولید کند.
- **فایل/خط:** `semantic-engine/src/host/FileWatcher.ts:195-206` و `222-233`.
- **Evidence verbatim:** `private readonly pendingUnlinks = new Map<string, PendingEvent>();`، `private readonly pendingAdds = new Map<string, PendingEvent>();`، و `const existing = table.get(hash); if (existing) clearTimeout(existing.timer); ... table.set(hash, { relativePath, timer });` در `hold`.
- **مسیر:** chokidar `add/unlink` → `onAdd/onUnlink` → `pendingAdds/pendingUnlinks` با کلید content hash → `hold`. چون هر hash فقط یک مقدار دارد، فایل دوم همان hash قبلی را جایگزین می‌کند؛ pairing فقط از `get(hash)` انجام می‌شود.
- **وابستگی/دامنه:** chokidar، `sha256` و `previousHash`؛ در هر workspace مستقل رخ می‌دهد و به multi-project بودن وابسته نیست.
- **تست مرتبط:** `src/host/FileWatcher.test.ts` rename تک‌فایل، delete/create و پنجره زمانی را تست می‌کند، اما دو یا چند فایل با hash یکسان را تست نمی‌کند.
- **محدودیت:** فقط وقتی چند pending فایل با hash یکسان در پنجره rename وجود داشته باشند؛ یک rename منفرد affected نیست.

### F-03 — خطای asynchronous stream وقتی write مقدار true می‌دهد listener ندارد
- **شدت/اثر:** Medium؛ خطای `Writable` که بعد از write موفق emit شود می‌تواند به unhandled `error` تبدیل شود؛ `writeJsonAtomic` تضمین «خطا را به caller برگردان و مقصد قبلی را حفظ کن» را برای این مسیر ندارد.
- **فایل/خط:** `semantic-engine/src/host/FileSystem.ts:185-190`، `296-318` و `339-354`.
- **Evidence verbatim:** در `stringifyToStream`: `if (!stream.write(chunk)) { await waitForDrain(stream); ... }`؛ listenerهای `error` فقط داخل `waitForDrain` ثبت می‌شوند (`stream.once('error', onError as never);`). در `writeJsonAtomic` نیز فقط `await stringifyToStream(...)` و سپس `stream.end(...)` دیده می‌شود.
- **مسیر:** `NodeFileSystem.writeJsonAtomic` → `stringifyToStream`؛ اگر `stream.write(chunk)` برابر `true` باشد، `waitForDrain` اجرا نمی‌شود و هیچ `error` listener نصب نمی‌شود. خطای بعدی stream در مسیر `catch` promise قابل capture تضمین‌شده نیست.
- **وابستگی/دامنه:** Node `fs.WriteStream`/`WritableLike`؛ هر project که JSON atomic export انجام دهد.
- **تست مرتبط:** `src/host/FileSystem.test.ts` backpressure، خطای writeFile، خطای rename و round-trip را دارد؛ stream error پس از write موفق را ندارد.
- **محدودیت:** خطاهای `end(callback)` پوشش داده می‌شوند؛ این finding فقط خطای emit‌شده پیش/هم‌زمان/پس از writeهایی است که backpressure ایجاد نکرده‌اند.

## بررسی فایل‌به‌فایل

| فایل | نقش، call path، وابستگی، scope و تست | نتیجه/محدودیت |
|---|---|---|
| `host/Config.ts` | بارگذاری چهارلایه flag/env/file/default؛ `Config.fromProcess/load` ← CLI/مصرف‌کننده‌ها؛ AJV و `contracts/config.schema.json`؛ کلیدهای global config به ازای هر workspace | Finding قطعی مشاهده نشد. تست مرتبطِ قبلاً کامل‌شده: `Config.test.ts`; این batch تست اختصاصی نداشت. `strictFlags` و file discovery محدود به قرارداد فعلی schema است. |
| `host/EventLoop.test.ts` | تست macrotask yield و cadence ییلدر؛ وابسته به Jest و Node `setImmediate` | تست‌محور، production path ندارد؛ assertions رفتار فعلی را پوشش می‌دهند. |
| `host/EventLoop.ts` | `yieldToEventLoop` و `createYielder` برای loopهای CPU؛ مصرف‌کننده‌ها در مسیرهای hot loop | Finding قطعی در قرارداد فعلی ثبت نشد؛ ورودی `every<=0` validation ندارد و به‌عنوان POTENTIAL/UNVERIFIED نگه داشته شد. |
| `host/FileSystem.test.ts` | تست serializer، backpressure، atomic write/fsync، stale temp و read/remove؛ fs/os/temp fixtures | F-03؛ تست stream error asynchronous ناقص است. تست بزرگ ۲۰MB timeout=120s دارد. |
| `host/FileSystem.ts` | port دیسک: `readJson`, `writeFileAtomic`, `writeJsonAtomic`; exporter/pipeline به آن متکی‌اند؛ Node fs | F-03. همچنین fsync دایرکتوری پس از rename در این snapshot اثبات نشده، اما به‌عنوان finding قطعی گزارش نشد. |
| `host/FileWatcher.test.ts` | chokidar integration، ignore parity، rename/delete/create و WatchPipeline/IncrementalEngine؛ temp workspace | F-02؛ سناریوی duplicate-content وجود ندارد. multi-project مستقیم ندارد. |
| `host/FileWatcher.ts` | chokidar add/change/unlink → FileChangeEvent؛ IgnoreMatcher/ScannerConfig/sha256/Logger | F-02. هر watcher برای یک workspace ساخته می‌شود؛ outputDir از ignore matcher می‌آید. |
| `host/Logger.test.ts` | routing، level، text/ndjson، Error/circular metadata و sink failure | Finding قطعی در تست‌ها/کد مرتبط مشاهده نشد؛ تست duplicate shared object ندارد. |
| `host/Logger.ts` | logger جایگزین console؛ child scopes، stdio→stderr، env factory؛ بدون dependency خارجی | Finding قطعی ثبت نشد. `safeJsonValue` برای reference مشترک (نه cycle) رفتار `[Circular]` دارد ولی این batch آن را POTENTIAL/UNVERIFIED نگه داشت. |
| `host/Progress.test.ts` | Silent/Tty/NDJSON و factory؛ sinkهای in-memory | Finding قطعی ثبت نشد؛ ورودی‌های NaN/negative increment پوشش ندارند. |
| `host/Progress.ts` | progress reporter مستقل از VS Code؛ TTY/NDJSON/silent؛ مصرف pipeline/CLI | Finding قطعی ثبت نشد؛ clamp فقط سقف ۱۰۰ است و lower/non-finite contract در این snapshot مشخص نیست. |
| `host/barrelLoad.test.ts` | child process برای require واقعی `dist/index.js` و optional native deps؛ package barrel | تست‌ها با `describe.skip` در نبود dist رد می‌شوند؛ build/package-dependent است. |
| `host/configSchemaSync.test.ts` | اسکن source برای کلیدهای `semanticEngine.*` و مقایسه با schema؛ fs/path | Finding قطعی در خود تست مشاهده نشد؛ regex فقط literalهای static را می‌یابد و dynamic key access را نمی‌سنجد (محدودیت تست). |
| `host/libraryOutput.test.ts` | اسکن console call در non-test TS و whitelist entry points؛ fs/path | Finding قطعی مشاهده نشد؛ regex کامنت/الگوهای پیچیده را کامل مدل نمی‌کند، هرچند self-check دارد. |
| `host/packaging.test.ts` | package/lock/package files، VS Code coupling، binary dependency و README contract | Finding قطعی مشاهده نشد؛ بسیاری assertions به `node_modules` و build/install snapshot وابسته‌اند. |
| `host/vscodeCoupling.test.ts` | guard اسکن import `vscode` در src و whitelist خالی؛ fs/path | Finding قطعی مشاهده نشد؛ فقط static import pattern تعریف‌شده را detect می‌کند. |
| `incremental/IncrementalCost.phase26.test.ts` | cost/scoped metrics، AI scope، serialization queue، LLM concurrency/cache/budget/abort؛ پروژه‌های synthetic | تست‌های سنگین و timing-sensitive؛ به LLM fake و timers متکی‌اند؛ Finding تولیدی مستقیم در این فایل مشاهده نشد. |
| `incremental/IncrementalEngine.fileShape.test.ts` | parity فایل incremental با full index برای symbolIds/outline/diagnostics؛ pipeline/extractors | تست modified/created را پوشش می‌دهد، اما rename هم‌محتوا را نه؛ F-01 همین gap را به source وصل می‌کند. |
| `incremental/IncrementalEngine.phase25.test.ts` | rename id stability/restart، graph/vector cleanup، transitive dependents، immutability | rename id را می‌سنجد ولی symbol preservation را نمی‌سنجد؛ F-01. |
| `incremental/IncrementalEngine.test.ts` | baseline engine: load/apply، vectors، rename، delete، drift/blueprint threshold؛ fake extractors | rename تست تغییر path و id دارد، نه حفظ symbols؛ branch هم‌محتوا در source F-01 است. |

## Potential / Unverified (یافته قطعی محسوب نشده)

- `createYielder(0)` در `EventLoop.ts:57-64` به‌خاطر `% 0` هرگز yield نمی‌کند؛ قرارداد ورودی مثبت در فایل تصریح نشده، بنابراین نیازمند تصمیم API/تست است.
- `TtyProgress` و `NdjsonProgress` برای `increment` منفی یا non-finite اعتبارسنجی ندارند؛ schema/قرارداد حداقل مقدار در این ۲۰ فایل تعیین نشده است.
- `Logger.safeJsonValue` یک object مشترک در دو property را circular گزارش می‌کند؛ این رفتار می‌تواند misleading باشد، اما برای هدف logger و قرارداد فعلی تست قطعی ندارد.

## اجرای تست

- `npm test -- --runInBand ...` برای batch اجرا شد اما در هر دو تلاش ۱۲۰ ثانیه timeout شد؛ علت مشاهده‌شده خروجی قابل اتکا از Jest نبود (احتمالاً pretest/fixture یا نبود نصب کامل؛ فرآیند timeout شد).
- اجرای مستقیم `./node_modules/.bin/jest` ممکن نبود: `sh: 1: ./node_modules/.bin/jest: not found`.
- `npm run build` نیز اجرا نشد: `sh: 1: tsc: not found`.
- بنابراین هیچ ادعای سبز/قرمز بودن تست‌ها ثبت نمی‌شود؛ علت دقیق قابل اثبات، نبود `node_modules/.bin/jest` و `tsc` است.
