# گزارش اجرای یک‌مرحله‌ای فاز ۴ — 2026-09-18

## دامنه

فاز ۴ مربوط به `semantic-engine` و قراردادهای AI tools، schema، search، embedding و graph query است. این stage فقط فایل‌های production و regression test مرتبط با فاز ۴ را تغییر داد و فاز ۵ را شروع نکرد.

## تغییرات production

### `semantic-engine/src/graphs/GraphQueryEngine.ts`

- قراردادهای default graph به ثابت‌های export‌شده تبدیل شد:
  - `DEFAULT_GRAPH_MAX_NODES`
  - `DEFAULT_GRAPH_DEPTH`
  - `DEFAULT_GRAPH_DIRECTION`
  - `DEFAULT_GRAPH_MIN_CONFIDENCE`
- مصرف‌کننده‌های in-memory از همین ثابت‌ها استفاده می‌کنند تا default depth/direction/threshold پراکنده نشود.
- مسیر `subgraph` همچنان `both` است، چون این API در همان call صراحتاً رفتار دوطرفه را تعریف می‌کند؛ این با default traversal عمومی قاطی نشده است.

### `semantic-engine/src/export/sqlite/SqliteGraphQuery.ts`

- defaultهای SQLite از ثابت‌های مشترک `GraphQueryEngine` گرفته می‌شوند؛ پیش از این SQLite برای `neighbors` و `path` به‌طور مستقل `both` داشت و با default حافظه‌ای `out` هم‌قرارداد نبود.
- `depth` و `maxNodes` به‌صورت non-negative integer اعتبارسنجی می‌شوند و ورودی نامعتبر error صریح می‌گیرد.
- سقف traversal همچنان داخل recursive CTE اعمال می‌شود و نتیجهٔ بریده‌شده با `truncated: true` گزارش می‌شود؛ `maxNodes: 0` نیز دیگر success خالیِ گمراه‌کننده نیست.

### `semantic-engine/src/export/sqlite/SqliteGraphQuery.phase4.test.ts`

Regressionهای این stage:

1. default direction SQLite با in-memory یکی است؛ `neighbors('b')` فقط `c` می‌دهد و path معکوس پیش‌فرض ندارد.
2. `maxNodes: 0` خروجی خالی و `truncated: true` می‌دهد.
3. `maxNodes: -1` و `depth: -1` با error صریح رد می‌شوند.

## وضعیت validation

- **Static implementation review:** انجام شد؛ تغییرات فقط در قرارداد graph و تست مستقیم آن‌هاست.
- **Focused Jest:** هنوز اجرا و pass نشده است؛ checkout کامل repository و dependencyهای `jest`/`ts-jest` در محیط فعلی موجود نیست.
- **Typecheck/build:** هنوز اجرا و pass نشده است؛ `tsc`/`node_modules` در محیط audit موجود نیست.
- **Runtime SQLite parity:** هنوز اجرا و pass نشده است؛ نیازمند dependency و native/runtime setup واقعی repository است.

## وضعیت DoD فاز

فاز ۴ فعلاً **🟡 partially implemented / unverified** است، نه 🟢. تمام گام‌های implementation فاز انجام شده یا اصلاحات موردنیازشان روی شاخه ثبت شده‌اند، اما acceptance criteria فاز بدون اجرای focused tests، typecheck و runtime parity قابل تأیید نیستند. هیچ pass سراسری ادعا نمی‌شود.

## Unknown / Requires Verification

- نصب‌پذیری و نسخهٔ واقعی dependencyهای package برای اجرای Jest، ts-jest، TypeScript و SQLite باید در checkout کامل repository با manifest واقعی تأیید شود.
- نتیجهٔ نهایی parity SQLite/in-memory، شامل schema واقعی و native SQLite backend، پس از رفع blocker بالا باید با command و خروجی ثبت شود.
