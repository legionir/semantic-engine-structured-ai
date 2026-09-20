# Semantic Engine Code Intelligence — Execution Plan (Updated)

**Target repository:** `legionir/semantic-engine-structured-ai`  
**Target package:** `semantic-engine/`  
**Execution order:** Baseline/Hardening → v1 closure → v2 → v3 pilot → gated expansion  
**Status:** Living execution plan; specification is not implementation evidence.

## 1. Purpose and evidence policy

این plan، سه specification تطبیق‌یافتهٔ CodeIntel v1/v2/v3 را به اجرای مرحله‌ای و قابل‌راستی‌آزمایی تبدیل می‌کند. هیچ قابلیت یا فازی فقط به دلیل وجود type، schema، migration، test file، README یا prompt «تکمیل‌شده» تلقی نمی‌شود.

برای هر گام این وضعیت‌ها جدا ثبت می‌شوند:

- `TARGET`: در specification لازم است اما هنوز در repository اثبات نشده.
- `IMPLEMENTED`: تغییر کد انجام شده؛ به‌تنهایی pass نیست.
- `TESTED`: تست مربوط اجرا شده و خروجی ثبت شده.
- `LOCALLY VERIFIED`: command واقعی با revision، environment، output و exit code ثبت شده.
- `MCP/GATEWAY VERIFIED`: مسیر واقعی transport یا lifecycle اجرا و ثبت شده.
- `BLOCKED / UNKNOWN`: evidence لازم موجود نیست یا dependency/runtime در دسترس نیست.

کار فقط با fixture، workspace و credential آزمایشی انجام می‌شود. production data، credential واقعی و migration مخرب ممنوع است.

## 2. قواعد وابستگی و توقف

1. v2 قبل از closure فازهای baseline و v1 شروع نمی‌شود.
2. v3 قبل از عبور v2 از edit safety و contract gates شروع نمی‌شود.
3. هر فاز مستقل باید implementation، focused tests، build/type validation و evidence capture داشته باشد.
4. شکست یک gate، فاز را `🔴 BLOCKED` نگه می‌دارد؛ با تغییر نام یا تقسیم مصنوعی فاز pass اعلام نمی‌شود.
5. تغییرات additive و کوچک، قابل rollback و adapterمحور هستند؛ rewrite یا source-of-truth دوم مجاز نیست.
6. هر claim runtime، performance، compatibility، security، crash recovery، MCP یا Gateway فقط با اجرای واقعی قابل تأیید است.

---

## Phase 0 — Baseline and Hardening Foundation

**هدف:** تثبیت baseline قابل‌تکرار و پوشش کامل hardening پایه پیش از هر قابلیت v2/v3.  
**وضعیت اولیه:** 🔴 NOT STARTED  
**وابستگی:** دسترسی به checkout، dependency tree و محیط اجرای repository.

### Steps

0.1. ثبت branch، revision دقیق، package version، Node/npm، OS، lockfile hash و dependency manifest.

0.2. ثبت scriptهای واقعی package و اجرای مستقل commandهای موجود: build/compile، typecheck در صورت وجود، lint، test، `test:gate`، validate، snapshot و benchmark. برای هر command، command کامل، fixture، خروجی، exit code و timestamp ذخیره شود. command ناموجود نباید pass گزارش شود.

0.3. ایجاد یا به‌روزرسانی `semantic-engine/docs/DECISIONS.md` و `semantic-engine/docs/CONTRACTS.md`. در آن‌ها source of truth، تصمیم‌های compatibility، قراردادهای ردشده و gapهای evidence ثبت شود.

0.4. بازاعتبارسنجی مستقیم این boundaryها: `ProjectIndex` schema/types، `ProjectPaths`/`ProjectRegistry`، scanner، parser/extractor pipeline، `IncrementalEngine`، `OutputWriter`، `ProjectIndexReader`، `AiToolRegistry`، MCP server، Gateway/worker lifecycle، filesystem port و tests.

0.5. تثبیت قراردادهای پایه: project identity، root/rootPath، path confinement، schema version، file/symbol ID، line semantics، `Range/offset` encoding، end-exclusive behavior، BOM/CRLF/Unicode، generation و freshness.

0.6. اجرای fixtureهای full-vs-incremental برای add/modify/delete/rename، parse failure، skipped/truncated/generated/binary file و stale artifact. خروجی semantic، diagnostics، graph، vector و cache باید بررسی شود.

0.7. اجرای restart/artifact reload و consumer consistency برای ProjectIndexReader، registry، MCP و Gateway؛ بدون اعلام pass در صورت نبود runtime evidence.

0.8. تهیهٔ compatibility matrix فعلی برای schema، tool names/aliases، `AiToolOutput`، MCP `content`/`structuredContent`، `projectId` و `indexGeneration`.

### Acceptance criteria

- revision، manifest و command baseline قابل بازتولید و ذخیره‌شده است؛
- وضعیت هر command با output/exit code معلوم است؛
- قراردادهای پایه با source و test مرتبط شده‌اند؛
- full و incremental برای fixtureهای مصوب equivalence یا discrepancy مستند دارند؛
- حذف فایل stale symbol/edge/vector/diagnostic باقی نمی‌گذارد، یا gap دقیقاً ثبت شده است؛
- restart و artifact reload وضعیت واقعی دارند؛
- compatibility matrix و فهرست gapها منتشر شده است.

**خروجی:** baseline evidence bundle، decisions/contracts، fixture matrix، risk register.  
**Gate:** بدون این خروجی‌ها v1/v2/v3 `BLOCKED` می‌مانند.

---

## Phase 1 — v1 Index and Platform Closure

**هدف:** بستن baseline functional موجود، بدون ایجاد CodeIntel مستقل یا source of truth دوم.  
**وضعیت:** 🔴 NOT STARTED  
**وابستگی:** Phase 0 سبز یا gapهایش formally accepted.

### Steps

1.1. رفع mismatchهای قطعی بین schema و TypeScript types با migration/version decision؛ حفظ optional/additive compatibility.

1.2. تثبیت scanner/parser adapter policy و ثبت language support واقعی، parser version، partial/truncated و unavailable/degraded state.

1.3. تثبیت deterministic ordering برای files، symbols، diagnostics، graph edges و tool results؛ حذف timestamp/random/process-order از semantic output.

1.4. تثبیت atomic publication و manifest/generation؛ consumer نباید snapshot نیمه‌نوشته ببیند.

1.5. تکمیل registry/tool validation، cache key و invalidation بر اساس project/index identity؛ جلوگیری از bypass کردن project/file policy.

1.6. اجرای MCP `tools/list` و `tools/call` با SDK نصب‌شده و بررسی text/structured parity، project scope و generation freshness. اجرای Gateway/worker path فقط با fixture ایزوله.

1.7. ثبت وضعیت هر قابلیت به‌صورت specified/implemented/tested/locally verified/MCP verified/Gateway verified.

### Acceptance criteria

- `ProjectIndex` و schema/type contract همگام و versioned هستند؛
- full/incremental، removed files، partial states و atomic publication evidence دارند؛
- خروجی deterministic است؛
- registry، MCP و lifecycle با project identity و generation صحیح کار می‌کنند یا gap دقیق دارند؛
- هیچ ادعای completion بدون command/test evidence باقی نمانده است.

**Gate v1:** 🟢 فقط با evidence واقعی؛ در غیر این صورت 🟡/🔴 و v2 متوقف.

---

## Phase 2 — v2 Structural Search and Safe Mutation

**هدف:** افزودن structural search و edit safety به‌صورت extension روی v1.  
**وضعیت:** 🔴 NOT STARTED  
**وابستگی:** Phase 1 gate.

### Steps

2.1. inspect و pin کردن نسخه/API واقعی ast-grep، YAML/rule dependency و diff tooling؛ نبود dependency باید `DEPENDENCY/BLOCKED` بماند.

2.2. ساخت adapter read-only برای structural search، syntax-tree dump و rule packs؛ tree-sitter/index pipeline جایگزین نشود.

2.3. اجرای post-filter با ProjectIndex outline، project scope، path policy و deterministic ordering.

2.4. تعریف source-independent `EditPlan` و مسیر اجباری:

```text
plan → diff → approval → apply → verify → undo/recover
```

2.5. پیاده‌سازی transaction با stale hash، overlap detection، path/symlink/denylist protection، BOM/EOL preservation، journal و atomic recovery. پیش‌فرض read-only بماند.

2.6. اضافه‌کردن overlay provider و `overlayPolicy` برای unsaved buffers؛ provenance دیسک/overlay باید جدا باشد.

2.7. validatorها فقط از server-side allowlist انتخاب شوند؛ command دلخواه client/agent ممنوع. isolated apply و انتخاب rollback per-edit تست شود.

2.8. اجرای golden diff، Unicode/Persian/emoji، CRLF/BOM، overlap، crash injection، undo conflict، fuzz حداقل ۱۰۰۰ چرخه و MCP e2e.

### Acceptance criteria

- search بدون mutation و با scope/provenance روشن کار می‌کند؛
- diff preview هیچ source file را تغییر نمی‌دهد؛
- apply فقط پس از approval و precondition معتبر انجام می‌شود؛
- failure/crash باعث corruption یا partial commit غیرقابل‌بازیابی نمی‌شود؛
- rollback/undo conflict صریح و قابل‌آزمایش است؛
- overlay، validator و MCP contract evidence دارند؛
- v1 regression suite سبز و exit code ثبت شده است.

**Gate v2:** بدون corruption، rollback/recovery evidence، e2e MCP و full/incremental regression، v3 ممنوع است.

---

## Phase 3 — v3 Semantic Graph Pilot

**هدف:** یک vertical slice کم‌ریسک برای semantic graph، نه rollout کامل چندزبانه.  
**وضعیت:** 🔴 NOT STARTED  
**وابستگی:** Phase 2 gate و dependency review.

### Scope محدود pilot

یک زبان و یک resolver انتخاب شود؛ ابتدا import/reference extraction، یک query reference، یک MCP path و یک incremental fixture. LSP اختیاری و degraded است و تا زمان evidence نباید اجباری شود.

### Steps

3.1. تعیین versioned `Range` encoding و mapping به line-based model؛ تست UTF-16/Unicode و boundaryها.

3.2. تعریف confidence/resolution states: `exact`, `heuristic`, `ambiguous`, `unresolved` با candidates و provenance.

3.3. افزودن migration additive برای refs/edges/unresolved فقط پس از backup/fixture/recovery design و اجرای isolated migration.

3.4. پیاده‌سازی resolver محدود و bounded؛ name matching هرگز exact اعلام نشود.

3.5. افزودن یک query مثل `symbol_references` یا `dependency_query` از طریق همان registry/MCP path.

3.6. اثبات dirty propagation و `incremental == full` برای semantic output؛ unresolved و removed-file cleanup اجباری است.

3.7. اجرای precision/recall و calibration روی gold fixture؛ بدون metric واقعی، pilot فقط `EXPERIMENTAL` بماند.

### Acceptance criteria

- resolver state و provenance در persistence و output قابل مشاهده‌اند؛
- ambiguity/unresolved حذف یا پنهان نمی‌شود؛
- query project/generation scope را رعایت می‌کند؛
- incremental semantic graph با full equivalence یا discrepancy مستند دارد؛
- migration rollback/recovery روی fixture اجرا شده است؛
- حداقل یک metric baseline و threshold مصوب دارد؛
- failure در هر gate باعث توقف گسترش language/provider است.

**Gate v3 pilot:** فقط در صورت عبور از precision، equivalence، persistence recovery و MCP e2e؛ در غیر این صورت `EXPERIMENTAL`.

---

## Phase 4 — Controlled v3 Expansion (مشروط)

**هدف:** توسعهٔ مرحله‌ای فقط پس از موفقیت pilot.  
**وضعیت:** 🔴 BLOCKED UNTIL PHASE 3 GATE

ترتیب پیشنهادی:

4.1. provider/resolver زبان دوم با همان contract و benchmark.  
4.2. FTS/BM25 و graph constraints، فقط پس از اثبات نیاز و ثبت dependency.  
4.3. `context_build`/`context_expand` با token budget، handles، deduplication و truncation metadata.  
4.4. ranking/PageRank فقط با baseline و ablation قابل‌اندازه‌گیری.  
4.5. semantic rename به‌عنوان producer همان v2 `EditPlan`، با conflict/unresolved policy؛ transaction engine جدید ساخته نشود.  
4.6. test edges، Git integration، fold plugins و LSP demand-driven، هرکدام با gate مستقل.

هر قابلیت جدید باید قبل از implementation دارای contract، fixture، failure state، security boundary، metric و rollback plan باشد.

---

## 3. وضعیت و گزارش‌دهی هر فاز

برای هر stage این evidence ثبت شود:

- revision و diff file list؛
- command کامل و environment؛
- output و exit code؛
- test/fixture identity؛
- artifact paths و hashes؛
- implementation files و contract changes؛
- static-only gaps؛
- runtime/MCP/Gateway status؛
- findings با شدت `Low/Medium/High` فقط در صورت evidence؛
- rollback/recovery result؛
- decision: `🟢 ACCEPTED`, `🟡 CONDITIONAL`, `🔴 BLOCKED`.

## 4. جمع‌بندی تصمیم

پیاده‌سازی پیشنهادی، یک rollout زنجیره‌ای است:

```text
Phase 0 baseline/hardening
  → Phase 1 v1 closure
  → Phase 2 v2 safe mutation
  → Phase 3 v3 pilot
  → Phase 4 controlled expansion
```

Phase 0 اکنون بخشی رسمی و non-optional از plan است. تا زمانی که baseline، قراردادهای ProjectIndex، full/incremental equivalence، artifact freshness و compatibility واقعی ثبت نشده‌اند، توسعهٔ v2/v3 نباید به‌عنوان پیشرفت قابل‌قبول یا release readiness گزارش شود.
