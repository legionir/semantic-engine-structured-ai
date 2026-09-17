# Checkpoint اجرای فاز ۴ — 2026-09-18

## Revision

- Branch: `docs/audit-file-status`
- Commit: `89bcb2da9cdeccddc5c88dc01f7ed6adfb751223`

## تغییرات قطعی انجام‌شده

### Context assembly

- `semantic-engine/src/services/ContextService.ts`
  - `options.files` اکنون با نام قراردادی `targetFiles` به `AssembleContextTool` ارسال می‌شود.
  - `tokenEstimate` از `result.metadata.estimatedTokens` خوانده می‌شود.
  - `maxTokens` دیگر به‌عنوان estimate بازتاب داده نمی‌شود؛ fallback صریح `0` است.

### Search contract

- `semantic-engine/src/ai/tools/SemanticSearchTool.ts`
  - ورودی‌های `mode` و `minScore` به interface و schema اضافه شدند.
  - `keyword` فقط keyword candidates را می‌گیرد.
  - `vector` keyword candidates را حذف و فقط embedding path را فعال می‌کند.
  - `hybrid` هر دو مسیر را ادغام می‌کند.
  - `minScore` پس از ranking روی score نهایی اعمال می‌شود.
  - `useEmbeddings` برای compatibility باقی مانده و وقتی `mode` وجود دارد، mode اولویت دارد.
- `semantic-engine/src/services/SearchService.ts`
  - mode و minScore را به ابزار منتقل می‌کند.
  - default limit با `??` حفظ می‌شود.

### Regression test

- `semantic-engine/src/ai/tools/SemanticSearchTool.test.ts`
  - modeهای keyword/vector/hybrid و minScore را به‌صورت focused پوشش می‌دهد.

## وضعیت راستی‌آزمایی

- وضعیت گام‌های مرتبط در `EXECUTION_PLAN.md` عمداً `🟡` است، نه `🟢`.
- تست Jest، typecheck و runtime هنوز در این محیط با dependencyهای کامل اجرا نشده‌اند؛ بنابراین pass ادعا نمی‌شود.
- تست ContextService مستقل اضافه نشد، چون fixture/test harness موجود برای آن در این checkpoint verify نشده است: **Unknown / Requires Verification**.
- گام ۵ فاز ۴ (embedding cardinality و graph-query parity) هنوز انجام نشده است.
