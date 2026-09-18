# Audit final batch 1

## Scope and method

از `AUDIT_FILE_STATUS.md` دقیقاً ۲۰ ردیف اول با وضعیت `درانتظار` انتخاب شد؛ همان ۲۰ فایل زیر خط‌به‌خط مرور شدند. ارزیابی امنیتی انجام نشد؛ پنج فایل security صرفاً برای تکمیل وضعیت فایل مرور شدند و هر نتیجهٔ امنیتی در این گزارش خارج از scope است. شواهد کد به‌صورت verbatim با path/line آمده‌اند. مواردی که اجرای مستقل برای اثباتشان ممکن نبود با `POTENTIAL` یا `UNVERIFIED` علامت‌گذاری شده‌اند.

## Findings (با درجهٔ اطمینان)

### F-01 — `OpenTelemetryTracer.parseTraceparent` ورودی malformed را اعتبارسنجی نمی‌کند (POTENTIAL/UNVERIFIED)

- **Evidence:** `semantic-engine/src/observability/OpenTelemetryTracer.ts:29-36`
  ```ts
  const parts = header.split('-');
  if (parts.length < 4) return null;
  return {
    traceId: parts[1]!,
    parentSpanId: parts[2],
  };
  ```
- تولیدکننده در `:23-26` شناسه‌های 32/16 هگز تولید می‌کند، اما parser فقط تعداد قطعات را بررسی می‌کند؛ طول، هگز بودن، version/flags و all-zero بودن بررسی نمی‌شود. تست `OpenTelemetryTracer.test.ts:4-18` فقط header تولیدشدهٔ سالم را می‌آزماید. مصرف‌کنندهٔ خارج از این ۲۰ فایل برای اثبات اثر عملی بررسی نشد؛ بنابراین finding قطعیِ production impact نیست و UNVERIFIED باقی می‌ماند.

### F-02 — شمارندهٔ `errorCount` برای skip ناشی از `FileProcessor` افزایش نمی‌یابد (POTENTIAL)

- **Evidence:** `semantic-engine/src/scanner/WorkspaceScanner.ts:148-163`
  ```ts
  processed[index] = await this.fileProcessor.processFile(filePath);
  if (processed[index] === null) skippedCount++;
  ...
  } catch (error) {
    errorCount++;
  ```
- `FileProcessor.processFile` خطای خواندن/پردازش را در `FileProcessor.ts:171-175` می‌گیرد، diagnostic ثبت می‌کند و `null` برمی‌گرداند؛ در نتیجه این مسیر فقط `skippedCount` را زیاد می‌کند و `errorCount` صفر می‌ماند. تست `WorkspaceScanner.phase21.test.ts:439-456` diagnostic را بررسی می‌کند، اما `errorCount` را برای فایل unreadable assert نمی‌کند. قرارداد `ScanResult` صرفاً نام `errorCount` را دارد و معنای دقیق skip/error از call-site کامل اثبات نشده؛ پس این مورد POTENTIAL است.

### F-03 — diagnostic مربوط به exception پردازش فایل مسیر فایل را ندارد (POTENTIAL)

- **Evidence:** `semantic-engine/src/scanner/WorkspaceScanner.ts:151-162`
  ```ts
  this.diagnostics.push({
    severity: 'warning',
    message: `Could not process file: ${error instanceof Error ? error.message : String(error)}`,
    line: 1,
    source: 'scanner',
  });
  ```
- در مقابل، مسیر `FileProcessor` در `:69-75` مسیر نسبی را در message می‌گذارد. بنابراین اگر خطایی خارج از catch داخلی `FileProcessor` رخ دهد، diagnostic scanner قابل نسبت‌دادن به فایل نیست. تست‌های انتخاب‌شده فقط وجود diagnostic را می‌سنجند، نه path برای این شاخه؛ بازتولید exception خارجی انجام نشد، بنابراین POTENTIAL.

## ارزیابی فایل‌به‌فایل

| فایل | نقش | call path / وابستگی‌ها | خطا/وضعیت | multi-project scope | تست مرتبط | محدودیت بررسی |
|---|---|---|---|---|---|---|
| `semantic-engine/src/observability/OpenTelemetryTracer.test.ts` | تست traceparent، span و flush-state | `OpenTelemetryTracer.test` → `OpenTelemetryTracer`; وابسته به `crypto` به‌صورت غیرمستقیم | finding مستقل ندارد؛ پوشش malformed ناقص است (F-01) | کلاس stateful و per-instance است؛ multi-project در تست نیست | همین فایل: `:4-18` | فقط مسیر happy-path؛ flush و چند پروژه آزموده نشده |
| `semantic-engine/src/observability/OpenTelemetryTracer.ts` | تولید/parse context و نگهداری ۱۰۰۰ span، flush اتمیک | callerهای repository برای `new OpenTelemetryTracer` پیدا نشدند؛ deps: `crypto`, `fs`, `path` | F-01 POTENTIAL/UNVERIFIED؛ `parseTraceparent` حداقل validation را دارد (`:29-36`) | spanها در حافظهٔ instance هستند؛ outputPath caller تعیین می‌کند و namespace پروژه در کلاس نیست | تست `OpenTelemetryTracer.test.ts:4-18` | مصرف واقعی و قرارداد ورودی خارجی در این batch در دسترس نبود |
| `semantic-engine/src/pipeline/IndexPipeline.contents.test.ts` | regression تست عمر محتوای فایل و vector source | تست → `IndexPipeline`, `VectorIndexer`, `HashingEmbeddingGenerator`, `createExtractors` (`:40-43`) | تست‌ها ادعاهای clear/release را assert می‌کنند (`:118-159`)؛ finding قطعی از خود تست نیست | temp workspace مستقل per test (`:49-52`)، multi-project در یک run نیست | همین فایل، ۴ تست `:89-159` | به implementation اصلی `IndexPipeline.ts` خارج از ردیف دسترسی مستقیم داده نشد؛ اجرای تست متوقف شد |
| `semantic-engine/src/pipeline/IndexPipeline.diagnostics.test.ts` | regression propagation diagnostics file/project/scanner | تست → `IndexPipeline`, `createExtractors`, `Diagnostic` (`:22-24`) | سناریوهای parse error، scanner diagnostic و ordering را assert می‌کند (`:57-125`)؛ finding قطعی ندارد | یک workspace موقت در هر تست؛ aggregation چند project بررسی نشده | همین فایل: `:58-125` | dangling symlink و parse behavior به runtime/OS حساس است |
| `semantic-engine/src/pipeline/IndexPipeline.lspDiagnostics.test.ts` | تست اتصال diagnostics source، budget و `diagnosticsRun` | تست → `IndexPipeline`, `createExtractors`, `FileDiagnosticsSource` (`:18-21`) | پوشش binary skip و budget دارد (`:128-150`)، finding قطعی ندارد | یک workspace، یک source؛ multi-project orchestration خارج از scope این فایل است | همین فایل: `:99-173` | fake source جای LSP واقعی است؛ callerهای CLI/watcher/job اثبات نشد |
| `semantic-engine/src/pipeline/rescoreAfterEnrichment.test.ts` | regression امتیازدهی مجدد بعد از referenceCount | تست → `rescoreAfterEnrichment`; types/common helpers (`:24-26`) | مسیر null/peak/idempotence/range پوشش دارد (`:95-234`)؛ finding قطعی ندارد | مدل `ProjectIndex` در fixture چند فایل دارد اما project boundary ندارد | همین فایل: `:95-234` | integration ordering با `IndexPipeline` در این تست مستقیم اجرا نمی‌شود |
| `semantic-engine/src/scanner/FileProcessor.ts` | خواندن فایل، binary/encoding/hash/metrics و تولید `FileEntry` | `WorkspaceScanner` → `FileProcessor.processFile`; deps: fs/path, id/language/config/hash/encoding/logger (`:1-19`) | F-02 به‌صورت POTENTIAL در تعامل با scanner؛ hook محتوا فقط برای فایل کامل (`:166-168`) و فایل بزرگ عمداً callback نمی‌گیرد | `workspaceRoot` و relative path per instance؛ برای پروژهٔ واحد طراحی شده | `WorkspaceScanner.phase21.test.ts` hashing/encoding/metrics (`:50-549`) | فشردگی و root privilege اجرای unreadable را محدود می‌کند؛ streaming UTF-16 ذکرشده در `:197-203` تست کامل ندارد |
| `semantic-engine/src/scanner/WorkspaceScanner.host.test.ts` | سازگاری Progress/Cancellation host و VS Code-shaped | تست → `WorkspaceScanner.scan`, host `CancellationTokenSource`, `NdjsonProgress` (`:15-18`) | ۵ سناریو host/cancel را assert می‌کند (`:27-98`)؛ finding قطعی ندارد | fixture مشترک repository، multi-project ندارد | همین فایل: `:29-98` | به fixture موجود و shape ساختاری وابسته است |
| `semantic-engine/src/scanner/WorkspaceScanner.phase1.test.ts` | fixture integration و schema/language/binary baseline | scanner → exporter → `validate-schema.js` (`:4-6`, `:24-29`, `:36-42`) | تست‌های حداقل ۵۰ فایل، ۳ زبان، ignore و binary (`:45-79`) | فقط یک fixture root و یک output path | همین فایل: `:36-79` | اجرای pretest به تولید fixture ناقص برخورد کرد؛ نتیجهٔ runtime قابل تأیید نیست |
| `semantic-engine/src/scanner/WorkspaceScanner.phase21.test.ts` | regression وسیع hashing/ignore/encoding/symlink/errors/concurrency | تست → `WorkspaceScanner.scan` (`:17`, `:28-37`) | پوشش قوی سناریوها؛ در کد scanner F-02/F-03 POTENTIAL باقی است | هر تست temp root مستقل؛ symlink alias و sorted output آزموده شده، چند workspace نه | همین فایل: `:50-575` | chmod روی root بی‌اثر است (`:449-453`)، بنابراین unreadable branch ممکن است اجرا نشود |
| `semantic-engine/src/scanner/WorkspaceScanner.ts` | recursive discovery، ignore، cancellation، concurrency، diagnostics | public `scan` → `collectFilePaths` → `FileProcessor.processFile`; deps host/config/ignore (`:1-13`) | F-02 و F-03 POTENTIAL؛ cycle/broken symlink diagnostics در `:241-297` | `workspaceRoot` یک root دارد؛ symlink real-path dedupe (`:234-250`) از cross-project escape جلوگیری/کنترل می‌کند، ولی federation چند root ندارد | host/phase1/phase21 و pipeline diagnostics | error injection شاخهٔ catch بیرونی تست نشده؛ multi-project orchestration خارج از کلاس است |
| `semantic-engine/src/scanner/index.ts` | public barrel export | consumers → `WorkspaceScanner`, `FileProcessor` (`:1-2`) | خطای مستقل ندارد | exportها global package-level هستند؛ state ندارند | indirectly all scanner tests | هیچ type exportی برای `FileContentHook`/`FileSkipHook` ندارد؛ اثر عملی بررسی نشد |
| `semantic-engine/src/security/audit/AuditLogger.test.ts` | تست audit chain/query | test → `AuditLogger` (`:1`) | **خارج از scope امنیت**؛ finding امنیتی ثبت نشد | instance-local event chain | همین فایل: `:3-41` | امنیت طبق دستور بررسی نشد |
| `semantic-engine/src/security/audit/AuditLogger.ts` | in-memory hash-linked audit events/query | callers در این batch بررسی نشد؛ deps `crypto` (`:5`) | **خارج از scope امنیت**؛ بدون finding | chain فقط در حافظهٔ همان instance (`:22-24`) | test: `AuditLogger.test.ts:3-41` | persistence/durability/security عمداً ارزیابی نشد |
| `semantic-engine/src/security/rbac/ApiKeyStore.test.ts` | تست bootstrap/create/revoke API key | test → `ApiKeyStore` (`:1`) | **خارج از scope امنیت** | store per instance و in-memory | همین فایل: `:3-40` | expiry/persistence/security عمداً ارزیابی نشد |
| `semantic-engine/src/security/rbac/ApiKeyStore.ts` | in-memory key registry/token lookup | deps `crypto`, RBAC types (`:5-6`) | **خارج از scope امنیت** | key map per instance؛ `allowedProjects` فقط record field است (`:39-46`, `:55-65`) | test: `ApiKeyStore.test.ts:3-40` | security semantics عمداً بررسی نشد |
| `semantic-engine/src/security/rbac/PermissionChecker.test.ts` | تست permission و resource scope | test → `PermissionChecker`, `AuthContext` (`:1-2`) | **خارج از scope امنیت** | context per request/test | همین فایل: `:4-44` | security عمداً بررسی نشد |
| `semantic-engine/src/security/rbac/PermissionChecker.ts` | evaluate auth/permission/resource scope | static caller → `hasPermission`; deps RBAC types (`:5`) | **خارج از scope امنیت** | scope string per AuthContext؛ federation بررسی نشد | test: `PermissionChecker.test.ts:4-44` | security عمداً بررسی نشد |
| `semantic-engine/src/security/rbac/types.ts` | RBAC/domain contracts and role defaults | imported by ApiKeyStore/PermissionChecker (`:5-6` در store و `:5` checker) | **خارج از scope امنیت** | `resourceScope` و optional `allowedProjects` contract (`:26-50`) | indirect tests above | security عمداً بررسی نشد |
| `semantic-engine/src/server/HttpServer.test.ts` | HTTP integration tests، project routes، visualization، auth/origin assertions | test → `HttpServer`; temp project/index setup (`:9-10`, `:16-80`), raw Node `http` client (`:88-140`) | non-security route/visualization tests assert responses (`:142-262`); security block intentionally not assessed (`:264-346`) | registers one project under `projectsRoot`, so project route scope is exercised but multi-project isolation نیست | همین فایل: `:142-262` برای non-security | `npm test` قبل از Jest در fixture generation شکست خورد؛ no runtime result |

## تست‌ها و وضعیت اجرا

دستور اجراشده:

```text
npm test -- --runInBand --runTestsByPath src/observability/OpenTelemetryTracer.test.ts src/pipeline/IndexPipeline.contents.test.ts src/pipeline/IndexPipeline.diagnostics.test.ts src/pipeline/IndexPipeline.lspDiagnostics.test.ts src/pipeline/rescoreAfterEnrichment.test.ts src/scanner/WorkspaceScanner.host.test.ts src/scanner/WorkspaceScanner.phase1.test.ts src/scanner/WorkspaceScanner.phase21.test.ts src/security/audit/AuditLogger.test.ts src/security/rbac/ApiKeyStore.test.ts src/security/rbac/PermissionChecker.test.ts src/server/HttpServer.test.ts
```

نتیجه: **اجرا نشد، exit code 1**؛ hook `pretest` قبل از Jest شکست خورد:

```text
Error: ENOENT: no such file or directory, mkdir '/tasklet/threads/a_pjgnxp3j2201gp81brsm/work/repo/semantic-engine/test-fixture/node_modules/left-pad'
at .../semantic-engine/scripts/gen-fixture.js:34:8
at edgeCases (.../scripts/gen-fixture.js:924:5)
```

برای build نیز `npm run build` اجرا شد و **exit code 127** داد:

```text
sh: 1: tsc: not found
```

پس هیچ pass/fail تستی ادعا نمی‌شود.

## وضعیت فایل status

همان ۲۰ ردیف اول `درانتظار` در `AUDIT_FILE_STATUS.md` به `کامل` تغییر کرد؛ ردیف دیگری عمداً تغییر داده نشد. ردیف بعدی باقی‌مانده از خط ۴۰۰ است (`semantic-engine/src/server/SecurityPipeline.test.ts`).
