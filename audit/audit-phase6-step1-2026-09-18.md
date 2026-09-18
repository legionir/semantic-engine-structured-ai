# گزارش گام ۱ فاز ۶ — ProjectResolver و context نرمال‌شده (2026-09-18)

## دامنه

فقط **گام ۱ فاز ۶** اجرا شد: یکسان‌سازی قرارداد record/context در
`ProjectResolver` و `ProjectContext` و اعتبارسنجی ownership برای
`options.project`. گام‌های ۲ تا ۵ فاز ۶ در این stage اجرا **نشده‌اند**.

- branch: `docs/audit-file-status`
- baseline revision: `794fc9772f24b5d80a3ea0f25eb8b6a75f1ea5c5`

## وضعیت

| مورد | وضعیت |
|---|---|
| فاز ۶ | 🟡 (فقط گام ۱ کامل است) |
| گام ۱ | 🟢 |
| گام ۲ تا ۵ | 🔴 |

## findingهای پوشش‌داده‌شده

| finding | منبع | وضعیت |
|---|---|---|
| `API-016` — `runAgent({ project })` با `ProjectContext` نرمال‌شده ناسازگار است | `audit/audit-progress-2026-09-15.md:55-68` | اصلاح شد |
| `F-008` — explicit project object از validation مستند عبور می‌کرد | `audit/structured-ai-audit.md:775-805` (POTENTIAL/UNVERIFIED) | تا حد قابل‌اثبات اصلاح شد؛ باقیمانده در «Unknown / Requires Verification» زیر |

## تغییرات

### `agent/projects/ProjectContext.js`

- `normalizeProjectInput(value)` اضافه شد: تنها نقطه‌ای که هر دو shape را به
  نام‌فیلدهای record نگاشت می‌کند —
  `{ id, rootPath }` و `{ projectId, workspaceRoot }`.
- `isProjectRecordShape` / `isProjectContextShape` به‌عنوان predicate صریح
  export شدند (id و rootPath باید رشتهٔ ناتهی باشند).
- `createProjectContext` حالا هر دو shape را می‌پذیرد و روی یک context
  **idempotent** است: `dataRoot` موجود verbatim حفظ می‌شود تا round trip
  یک پروژهٔ synthetic را از layout قدیمی `.agent` به store مرکزی جابه‌جا نکند.
- پیام خطای shape نامعتبر هر دو shape مجاز را نام می‌برد.

### `agent/projects/ProjectRegistry.js`

- `projectRootHash(canonicalRoot)` استخراج و export شد. این نیمهٔ
  identity-bearing شناسهٔ پروژه است (slug جلوی آن با rename تغییر می‌کند،
  این hash نه)، و مبنای اعتبارسنجی synthetic در resolver است.
- `projectIdFor` بدون تغییر رفتار روی همین helper بازنویسی شد.

### `agent/projects/ProjectResolver.js`

- `resolveProjectForRun` ورودی `options.project` را از
  `normalizeProjectInput` عبور می‌دهد، پس record و context هر دو پذیرفته
  می‌شوند؛ ناسازگاری مستندسازی/implementation (`API-016`) برطرف شد.
- `validateProjectOwnership(record, registry)` اضافه و export شد:
  1. `canonicalizeRoot` روی root ادعاشده اجرا می‌شود؛ root ناموجود یا
     non-directory با خطای صریح رد می‌شود.
  2. اگر id در registry باشد، root ثبت‌شده باید با root ادعاشده یکی باشد؛
     در غیر این صورت خطای mismatch. رکورد registry برای name/permissions/
     endpoint **authoritative** است و کپی stale کاربر override نمی‌شود.
  3. اگر id در registry نباشد و رکورد `synthetic` باشد، id باید به
     `-${projectRootHash(canonicalRoot)}` ختم شود؛ یعنی یک default
     دست‌ساز نمی‌تواند root بیگانه را ادعا کند.

## رفتار عمداً حفظ‌شده

یک نسخهٔ اول این تغییر قانون سخت‌گیرانه‌تری داشت: «id ثبت‌نشده نمی‌تواند
root متعلق به یک پروژهٔ ثبت‌شده را ادعا کند». این قانون تست موجود
`test/runs/run-context.test.js:341` («two concurrent runs on two projects
share nothing») را شکست، چون آن تست عمداً رکورد synthetic default یک root
را پس از register شدن همان root همچنان addressable نگه می‌دارد (layout
قدیمی `.agent`). قانون با بررسی hash هویتی جایگزین شد که همان تضمین را
بدون شکستن این قرارداد می‌دهد. رفتار قبلی حفظ شد، نه ساده‌سازی.

## Unknown / Requires Verification

- **explicit project ثبت‌نشده:** رکوردی با id ناشناخته و `synthetic` نبودن،
  همچنان پذیرفته می‌شود (پس از canonicalize شدن root). محدودکردن
  `options.project` به عضویت registry نیاز به **caller inventory** برای
  `runAgent({ project })` دارد که در این stage اثبات نشده است. تا فراهم‌شدن
  آن evidence، این مورد باز می‌ماند.
- `assertWorkspaceMatch` همچنان export است و از `resolveProjectForRun`
  فراخوانی نمی‌شود؛ مرز cross-root به گام‌های بعدی فاز ۶ (tool runtime و
  propagation) وابسته است و در این گام تغییر نکرد.

## evidence اجرا

| command | result |
|---|---|
| `npm run test:projects` (baseline، قبل از تغییر) | PASS — 17 + 17 + 8 |
| `npm run test:runs` (baseline، قبل از تغییر) | PASS — 5 + 11 + 5 + 8 |
| `node test/projects/projects.test.js` (بعد از تغییر) | PASS — 22/22 |
| `npm run test:runs` (بعد از تغییر) | PASS — 5 + 11 + 5 + 8 |
| `npm test` (کل suite structured-ai) | PASS — exit 0، 705 تست ok، 0 FAIL |

`structured-ai` هیچ dependency خارجی ندارد (`package-lock.json` بدون
package)، بنابراین آماده‌سازی محیط لازم نبود؛ Node نصب‌شده `v22.22.2` با
`engines.node: >=18` سازگار است.

## skip باقی‌مانده

`test/mcp/gateway.integration.test.js` با پیام
`skip semantic-engine is not built (run npm run build in semantic-engine/)`
از اجرا خارج می‌شود. این skip **پیش از** تغییرات این stage هم وجود داشت و
به گام ۱ مربوط نیست؛ طبق قاعدهٔ ۱۱/۱۲ پلن، pass محسوب نمی‌شود و به‌عنوان
blocker محیطی برای فاز ۹ باقی می‌ماند.

## تست‌های regression افزوده‌شده

در `test/projects/projects.test.js`:

- `resolveProjectForRun accepts a record AND an already-built context`
- `createProjectContext is idempotent on a context`
- `normalizeProjectInput maps both shapes and rejects anything else`
- `an explicit project is ownership-validated, not taken on faith`
- `a project option of the wrong shape names both accepted shapes`
