# Baseline Record — EXECUTION_PLAN Phase 1 (گام ۱)

**تاریخ ثبت:** 2026-08-25
**commit:** `e794fb230cfadb97f2b0e5744fb066262bca3a74` (branch `arena/01a03894-semantic-engine-structured-ai`)
**Node:** v22.22.3 · **Platform:** linux x64
**وضعیت:** ✅ suite فعلی در نقطهٔ شروع refactor کاملاً سبز است

## Syntax check

| command | exit code |
|---|---|
| `npm run check` (`node --check agent/agent.js`) | 0 |

## Full test suite (قبل از افزودن contract tests)

| command: `npm test` (زنجیرهٔ ۱۴ فایل با `&&`) | exit code: 0 | مدت: ~۳۵s |
|---|---|---|

| فایل | نتیجه |
|---|---|
| `test/tools.test.js` | 56/56 passed |
| `test/hooks.test.js` | 5/5 passed |
| `test/journal.test.js` | 2/2 passed |
| `test/eventstore.test.js` | 5/5 passed |
| `test/runtime.test.js` | 105/105 passed |
| `test/semantic.test.js` | 14/14 passed |
| `test/mcp.test.js` | 37/37 passed |
| `test/archive.test.js` | 16/16 passed |
| `test/e2e.test.js` | 58/58 passed |
| `test/cli.test.js` | 19/19 passed |
| `test/interactive.test.js` | 12/12 passed |
| `test/ui.test.js` | 35/35 passed |
| `test/discussion.test.js` | 23/23 passed |
| `test/web.test.js` | 28/28 passed |
| **مجموع** | **415/415 passed** |

## قراردادهای ثبت‌شده در همین مرحله

- envelope رویدادها و فهرست نام رویدادها → `test/fixtures/events.json`
- ساختار prompt (Main/Sub-Agent) و request مدل → `test/fixtures/prompt.fixture.json`
- قرارداد action (tool_call/delegate/final + رفتار خطاها) → `test/fixtures/actions.json`
- فهرست مسیرهای API → `test/fixtures/api-surface.json`
- سیاست additive-only و مستندات قرارداد → `test/fixtures/CONTRACTS.md`
- normalizer و تست آن → `test/helpers/normalize.js`, `test/helpers/normalize.test.js`

## یادداشت coverage برای fixtureهای گام ۲

گام ۲ فاز ۱ خواستار fixture برای context compaction، delegation، MCP discovery و UI state نیز هست. این موارد هم‌اکنون با پوشش واقعی این فایل‌ها قابل replay هستند و در فاز ۲۹ (تفکیک test suite) به fixture مستقل تبدیل می‌شوند:

- context compaction → `test/runtime.test.js` (تست‌های compaction)
- delegation → `test/runtime.test.js` و `test/e2e.test.js`
- MCP discovery → `test/mcp.test.js` و `test/semantic.test.js`
- UI state → `test/web.test.js` و `test/ui.test.js` (اجرای سرور واقعی با مدل stub)

## suite پس از گام ۴ (وضعیت فعلی)

**تاریخ:** 2026-08-25 · **exit code: 0** · مدت: ~۳۴s

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/actions.contract.test.js` | 6/6 passed |
| `test/contracts/events.contract.test.js` | 5/5 passed |
| `test/contracts/prompt.contract.test.js` | 5/5 passed |
| ۱۴ فایل اصلی (مانند جدول بالا) | 415/415 passed |
| **مجموع** | **437/437 passed** |

*نکته:* `npm run check` نیز سبز است. اعداد جدول اول baseline **قبل** از افزودن contractها را ثبت می‌کنند؛ این جدول وضعیت پایان فاز ۱ است.

## suite پایان فاز ۳ (وضعیت فعلی)

**تاریخ:** 2026-08-25 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/actions.contract.test.js` | 6/6 passed |
| `test/contracts/events.contract.test.js` | 5/5 passed |
| `test/contracts/prompt.contract.test.js` | 5/5 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` (جدید فاز ۳) | 5/5 passed |
| ۱۴ فایل اصلی (مانند جدول اول) | 415/415 passed |
| **مجموع** | **459/459 passed** |

*نکته:* تست parity فاز ۳ خروجی normalize‌شدهٔ اجرای single-Run در حالت `RUN_CONTEXT_MODE=modular` را در همان فرایند با حالت legacy (baseline این سند) مقایسه و برابر اعلام کرد؛ تنها تفاوت مجاز، فیلد additive `project_id` روی envelope رویدادهای scoped است (CONTRACTS.md §۸).

## suite پایان فاز ۴ (وضعیت فعلی)

**تاریخ:** 2026-08-25 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` (جدید فاز ۴) | 9/9 passed |
| ۱۴ فایل اصلی (مانند جدول اول) | 415/415 passed |
| **مجموع** | **468/468 passed** |

*نکته:* برابری خروجی ابزارها در حالت legacy با baseline همچنان توسط `test/tools.test.js` (۵۶ تست بدون تغییر) و suite runtime قفل است؛ در حالت modular نیز خروجی pathها نسبت به root همان context با همان شکل گزارش می‌شود.

## suite پایان فاز ۵ (وضعیت فعلی)

**تاریخ:** 2026-08-25 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` (جدید فاز ۵) | 7/7 passed |
| ۱۴ فایل اصلی (مانند جدول اول) | 415/415 passed |
| **مجموع** | **475/475 passed** |

*نکته:* برابری prompt در سه لایه قفل است: (۱) تست differential legacy/modular پیام‌به‌پیام در همان فرایند؛ (۲) ارضای fixture فاز ۱ توسط خروجی modular؛ (۳) `prompt.contract.test.js` بدون تغییر روی مسیر legacy سبز.

## suite پایان فاز ۶ (وضعیت فعلی)

**تاریخ:** 2026-08-25 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/semantic-pool.test.js` (جدید فاز ۶) | 9/9 passed |
| ۱۴ فایل اصلی (مانند جدول اول) | 415/415 passed |
| **مجموع** | **484/484 passed** |

*نکته:* برابری routing حالت legacy با baseline توسط `test/semantic.test.js` (۱۴ تست بدون تغییر) و تست identity مستقیم resolver (برگشت همان آبجکت `mcp/semantic.js`) قفل است؛ ایزوله‌بودن دو پروژه، degradation per-project، cache کلید generation و تعویض endpoint از registry توسط suite جدید روی stub قرارداد `/mcp/:projectId` اثبات می‌شود.

## suite پایان فاز ۷ (وضعیت فعلی)

**تاریخ:** 2026-08-25 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` (جدید فاز ۷) | 8/8 passed |
| ۱۴ فایل اصلی (مانند جدول اول) | 415/415 passed |
| **مجموع** | **492/492 passed** |

*نکته:* مسیرهای legacy کاملاً قفل‌اند: `cli.test.js` (۱۹ تست) و `web.test.js` (۲۸ تست) بدون تغییر سبزند و بدنهٔ 202 مسیر قدیمی در تست جدید با deep-equal تطبیق داده می‌شود؛ اثبات زنجیرهٔ end-to-end با مدل stub، پیام `project_context` در بدنهٔ request و attribution رویدادها (`project_id`/`run_id`) در eventstore و `/api/state` انجام می‌شود.

## suite پایان فاز ۸ (وضعیت فعلی)

**تاریخ:** 2026-08-25 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` (جدید فاز ۸) | 9/9 passed |
| ۱۴ فایل اصلی (مانند جدول اول) | 415/415 passed |
| **مجموع** | **501/501 passed** |

*نکته:* رفتار legacy بیت‌به‌بیت قفل است (هر ۲۴ فایل قبلی بدون تغییر سبز؛ تنها اصلاح تستی existent، خواندن eventstore مرکزی برای پروژهٔ ثبت‌شده در `test/project-run.test.js` بود که مستقیماً از routing جدید فاز ۸ ناشی می‌شود). جداسازی per-project حافظه/پلن/session/archive/journal/eventstore، overlay تنظیمات (floor+cap) و migration ایدم‌پوتنت با ۹ تست جدید اثبات شد.

## suite پایان فاز ۹ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` (جدید فاز ۹) | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| ۱۴ فایل اصلی (مانند جدول اول) | 415/415 passed |
| **مجموع** | **518/518 passed** |

*نکته:* `web.test.js` 28/28 و `mcp.test.js` 37/37 بدون تغییر سبز ماندند. توکن master رفتار قبلی را حفظ می‌کند؛ ایزوله‌سازی API/event/MCP/approval با ۱۷ تست جدید قفل شد.

## suite پایان فاز ۱۰ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` (جدید فاز ۱۰) | 11/11 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| ۱۴ فایل اصلی (مانند جدول اول) | 415/415 passed |
| **مجموع** | **529/529 passed** |

*نکته:* Scheduler فقط در هر دو flag modular و Run دارای `projectId` فعال است. overflow صف `RUN_QUEUE_FULL`/429 است؛ سقف حافظه فقط همان پروژه را رد می‌کند؛ crash یک پروژه gateway را حداکثر `degraded` می‌کند. `web.test.js` قفل busy سراسری `/api/tasks` را حفظ می‌کند.

## suite پایان فاز ۱۱ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| ۱۴ فایل اصلی (ui.test.js حالا ۴۰/۴۰) | 420/420 passed |
| **مجموع** | **534/534 passed** |

*نکته:* `web.test.js` 28/28 بدون تغییر سبز ماند. ۵ تست UI جدید switcher، task scoped، dashboard deep-link، فیلتر event بین پروژه‌ها و صف labelدار چندپروژه‌ای را قفل می‌کنند.

## suite پایان فاز ۱۲ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/runs/delegation-projects.test.js` (جدید فاز ۱۲) | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| ۱۴ فایل اصلی (ui.test.js ۴۰/۴۰) | 420/420 passed |
| **مجموع** | **539/539 passed** |

*نکته:* `projectId` اختیاری روی `delegate` additive است و فقط با هر دو flag modular اعمال می‌شود. دو Sub-Agent روی دو root هم‌زمان بدون نشت ابزار/پیام اجرا می‌شوند؛ شکست `Unknown project` فقط همان فرزند را می‌گیرد؛ writeهای cross/multi approval جدا علاوه بر policy می‌گیرند. در legacy فیلد پذیرفته و نادیده گرفته می‌شود و envelope رویدادها شکل تاریخی را حفظ می‌کند.

## suite پایان فاز ۱۳ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/runs/delegation-projects.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| `test/mvp/mvp.test.js` (جدید فاز ۱۳) | 10/10 passed |
| ۱۴ فایل اصلی (ui.test.js ۴۰/۴۰) | 420/420 passed |
| **مجموع** | **549/549 passed** |

*نکته:* این فاز قابلیت محصولی ندارد. isolation (project/tool/runtime/MCP/persistence)، load/recovery (سقف هم‌زمانی، crash Worker، overflow صف) و سناریوی ده‌مرحله‌ای e2e با Console زنده قفل شدند. باندل runtime MVP همه-modular است و در تست‌ها ست می‌شود؛ پیش‌فرض schema `legacy` می‌ماند (تصمیم ۳۲) تا CLI/API بدون scope بیت‌به‌بیت یکسان بمانند.

## suite پایان فاز ۱۴ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/runs/delegation-projects.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/application/application.test.js` (جدید فاز ۱۴) | 8/8 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| `test/mvp/mvp.test.js` | 10/10 passed |
| ۱۴ فایل اصلی (ui.test.js ۴۰/۴۰) | 420/420 passed |
| **مجموع** | **557/557 passed** |

*نکته:* استخراج Config/Registry/Application بدون تغییر رفتار. `lib/storage.js` wrapper است؛ loader همان آرایهٔ tools.json را از `tool-schemas/` می‌سازد؛ facade همان exportها را دارد.

## suite پایان فاز ۱۵ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/runs/delegation-projects.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/application/application.test.js` | 8/8 passed |
| `test/actions/parser.test.js` (جدید فاز ۱۵) | 8/8 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| `test/mvp/mvp.test.js` | 10/10 passed |
| ۱۴ فایل اصلی (ui.test.js ۴۰/۴۰) | 420/420 passed |
| **مجموع** | **565/565 passed** |

*نکته:* استخراج parser/repair/validator بدون تغییر رفتار. wrapperهای `agent.js` همان امضا را دارند؛ native tool call، کدهای خطا و `response_diagnostics` قفل شدند. حلقهٔ اجرا هنوز در `agent.js` است (فاز ۱۶).

## suite پایان فاز ۱۶ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/runs/delegation-projects.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/application/application.test.js` | 8/8 passed |
| `test/actions/parser.test.js` | 8/8 passed |
| `test/runtime/engine.test.js` (جدید فاز ۱۶) | 5/5 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| `test/mvp/mvp.test.js` | 10/10 passed |
| ۱۴ فایل اصلی (ui.test.js ۴۰/۴۰) | 420/420 passed |
| **مجموع** | **570/570 passed** |

*نکته:* استخراج حلقهٔ اجرا بدون تغییر رفتار. هر دو مقدار `RUNTIME_ENGINE_MODE` همان engine را اجرا می‌کنند؛ wrapperهای `agent.js` حفظ شدند. سناریوی delegation normalize‌شده در هر دو حالت برابر است. `npm run check` سبز.

## suite پایان فاز ۱۷ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/runs/delegation-projects.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/application/application.test.js` | 8/8 passed |
| `test/actions/parser.test.js` | 8/8 passed |
| `test/runtime/engine.test.js` | 5/5 passed |
| `test/context/context.test.js` (جدید فاز ۱۷) | 7/7 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| `test/mvp/mvp.test.js` | 10/10 passed |
| ۱۴ فایل اصلی (ui.test.js ۴۰/۴۰، runtime.test.js ۱۰۵/۱۰۵، archive.test.js ۱۶/۱۶) | 420/420 passed |
| **مجموع** | **577/577 passed** |

*نکته:* استخراج context/memory/archive بدون تغییر رفتار. `lib/context.js`/`lib/memory.js`/`lib/archive.js` wrapperاند؛ جفت tool call/result جدا نمی‌شود؛ سقف context request را بزرگ‌تر نمی‌کند؛ بازیابی پس از restart حفظ است. فلگ MODE تازه‌ای اعلان نشد. `npm run check` سبز.

## suite پایان فاز ۱۸ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/runs/delegation-projects.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/application/application.test.js` | 8/8 passed |
| `test/actions/parser.test.js` | 8/8 passed |
| `test/runtime/engine.test.js` | 5/5 passed |
| `test/context/context.test.js` | 7/7 passed |
| `test/persistence/repositories.test.js` (جدید فاز ۱۸) | 9/9 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| `test/mvp/mvp.test.js` | 10/10 passed |
| ۱۴ فایل اصلی (ui.test.js ۴۰/۴۰، runtime.test.js ۱۰۵/۱۰۵، archive.test.js ۱۶/۱۶) | 420/420 passed |
| **مجموع** | **586/586 passed** |

*نکته:* استخراج persistence بدون تغییر قالب/مسیر. نوشتن JSON اتمیک (temp+rename)؛ JSONL خط truncated را skip می‌کند؛ session قدیمی بدون migration replay می‌شود. `lib/sessions.js`/`lib/journal.js`/`lib/eventstore.js` wrapperاند. فلگ MODE تازه‌ای اعلان نشد. `npm run check` سبز.

## suite پایان فاز ۱۹ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/runs/delegation-projects.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/tools/tool-runtime.test.js` (جدید فاز ۱۹) | 8/8 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/application/application.test.js` | 8/8 passed |
| `test/actions/parser.test.js` | 8/8 passed |
| `test/runtime/engine.test.js` | 5/5 passed |
| `test/context/context.test.js` | 7/7 passed |
| `test/persistence/repositories.test.js` | 9/9 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| `test/mvp/mvp.test.js` | 10/10 passed |
| ۱۴ فایل اصلی (ui.test.js ۴۰/۴۰، runtime.test.js ۱۰۵/۱۰۵، archive.test.js ۱۶/۱۶) | 420/420 passed |
| **مجموع** | **594/594 passed** |

*نکته:* استخراج tools بدون تغییر schema/قرارداد. `filesystem.js`/`process.js`/`code.js`/`plan.js`/`memory.js` wrapperاند؛ `ToolRegistryAdapter` parity با loader فاز ۱۴ را قفل می‌کند؛ `code/SemanticClient.js` همان کلاس فاز ۶ است. فلگ MODE تازه‌ای اعلان نشد. `npm run check` سبز.

## suite پایان فاز ۲۰ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/runs/delegation-projects.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/tools/tool-runtime.test.js` | 8/8 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/application/application.test.js` | 8/8 passed |
| `test/actions/parser.test.js` | 8/8 passed |
| `test/runtime/engine.test.js` | 5/5 passed |
| `test/context/context.test.js` | 7/7 passed |
| `test/persistence/repositories.test.js` | 9/9 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| `test/mcp/layer.test.js` (جدید فاز ۲۰) | 8/8 passed |
| `test/mvp/mvp.test.js` | 10/10 passed |
| ۱۴ فایل اصلی (ui.test.js ۴۰/۴۰، runtime.test.js ۱۰۵/۱۰۵، mcp.test.js ۳۷/۳۷) | 420/420 passed |
| **مجموع** | **602/602 passed** |

*نکته:* استخراج MCP بدون تغییر handshake/framing/namespace. `manager.js`/`client.js`/`config.js`/`protocol.js` wrapperاند؛ چهار transport حفظ شدند؛ server خراب runtime را crash نمی‌کند. فلگ MODE تازه‌ای اعلان نشد. `npm run check` سبز.

## suite پایان فاز ۲۱ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/policy/policy.test.js` (جدید فاز ۲۱) | 8/8 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/runs/delegation-projects.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/tools/tool-runtime.test.js` | 8/8 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/application/application.test.js` | 8/8 passed |
| `test/actions/parser.test.js` | 8/8 passed |
| `test/runtime/engine.test.js` | 5/5 passed |
| `test/context/context.test.js` | 7/7 passed |
| `test/persistence/repositories.test.js` | 9/9 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| `test/mcp/layer.test.js` | 8/8 passed |
| `test/mvp/mvp.test.js` | 10/10 passed |
| ۱۴ فایل اصلی (ui.test.js ۴۰/۴۰، runtime.test.js ۱۰۵/۱۰۵، mcp.test.js ۳۷/۳۷) | 420/420 passed |
| **مجموع** | **610/610 passed** |

*نکته:* matching و lifecycle approval به `agent/policy/` منتقل شدند؛ `agent/lib/policy.js` facade و `state.approvals` Map برای سازگاری حفظ شدند. policy روی آرگومان‌های resolveشده اعمال می‌شود؛ approvalهای پروژه‌ای، MCP gateway cache و writeهای cross/multi پروژه از lifecycle مشترک استفاده می‌کنند. `npm run check` سبز.

## suite پایان فاز ۲۲ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/policy/policy.test.js` | 8/8 passed |
| `test/hooks.test.js` | 5/5 passed |
| `test/hooks/hooks.test.js` (جدید فاز ۲۲) | 8/8 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/runs/delegation-projects.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/tools/tool-runtime.test.js` | 8/8 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/application/application.test.js` | 8/8 passed |
| `test/actions/parser.test.js` | 8/8 passed |
| `test/runtime/engine.test.js` | 5/5 passed |
| `test/context/context.test.js` | 7/7 passed |
| `test/persistence/repositories.test.js` | 9/9 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| `test/mcp/layer.test.js` | 8/8 passed |
| `test/mvp/mvp.test.js` | 10/10 passed |
| ۱۴ فایل اصلی (ui.test.js ۴۰/۴۰، runtime.test.js ۱۰۵/۱۰۵، mcp.test.js ۳۷/۳۷) | 420/420 passed |
| **مجموع** | **618/618 passed** |

*نکته:* HookRegistry/Loader، condition، renderer، result و runner ماژولار شدند. runner همچنان از graph/executorهای موجود استفاده می‌کند، بنابراین policy/approval، telemetry، project context و eventهای `hook:*` حفظ شده‌اند. `npm run check` سبز.

## suite پایان فاز ۲۳ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/policy/policy.test.js` | 8/8 passed |
| `test/hooks.test.js` | 5/5 passed |
| `test/hooks/hooks.test.js` | 8/8 passed |
| `test/web/routes.test.js` (جدید فاز ۲۳) | 8/8 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/runs/delegation-projects.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/tools/tool-runtime.test.js` | 8/8 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/application/application.test.js` | 8/8 passed |
| `test/actions/parser.test.js` | 8/8 passed |
| `test/runtime/engine.test.js` | 5/5 passed |
| `test/context/context.test.js` | 7/7 passed |
| `test/persistence/repositories.test.js` | 9/9 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| `test/mcp/layer.test.js` | 8/8 passed |
| `test/mvp/mvp.test.js` | 10/10 passed |
| `test/web.test.js` | 28/28 passed |
| ۱۴ فایل اصلی (runtime.test.js ۱۰۵/۱۰۵، ui.test.js ۴۰/۴۰، mcp.test.js ۳۷/۳۷ و discussion.test.js ۲۳/۲۳) | 420/420 passed |
| **مجموع** | **626/626 passed** |

*نکته:* Web Backend به facade، Router، request/response/middleware، SSE hub، controller/service/serializer graph و route inventory تفکیک شد. `WEB_SERVER_MODE=legacy` پیش‌فرض سازگار است و `WEB_SERVER_MODE=modular` با همان API/status/SSE قرارداد تأیید شد. `npm run check` سبز.

## suite پایان فاز ۲۴ (وضعیت فعلی)

**تاریخ:** 2026-08-26 · **exit code: 0** · `npm run check` سبز

| فایل | نتیجه |
|---|---|
| `test/helpers/normalize.test.js` | 6/6 passed |
| `test/contracts/*.contract.test.js` | 16/16 passed |
| `test/policy/policy.test.js` | 8/8 passed |
| `test/hooks.test.js` | 5/5 passed |
| `test/hooks/hooks.test.js` | 8/8 passed |
| `test/web/routes.test.js` | 8/8 passed |
| `test/ui.test.js` | 40/40 passed |
| `test/ui/modules.test.js` (جدید فاز ۲۴) | 8/8 passed |
| `test/projects/projects.test.js` | 17/17 passed |
| `test/projects/project-api.test.js` | 17/17 passed |
| `test/runs/run-context.test.js` | 5/5 passed |
| `test/runs/concurrency.test.js` | 11/11 passed |
| `test/runs/delegation-projects.test.js` | 5/5 passed |
| `test/tools/project-tools.test.js` | 9/9 passed |
| `test/tools/tool-runtime.test.js` | 8/8 passed |
| `test/prompt/builder.test.js` | 7/7 passed |
| `test/application/application.test.js` | 8/8 passed |
| `test/actions/parser.test.js` | 8/8 passed |
| `test/runtime/engine.test.js` | 5/5 passed |
| `test/context/context.test.js` | 7/7 passed |
| `test/persistence/repositories.test.js` | 9/9 passed |
| `test/semantic-pool.test.js` | 9/9 passed |
| `test/project-run.test.js` | 8/8 passed |
| `test/persistence/project-stores.test.js` | 9/9 passed |
| `test/mcp/layer.test.js` | 8/8 passed |
| `test/mvp/mvp.test.js` | 10/10 passed |
| `test/web.test.js` | 28/28 passed |
| ۱۴ فایل اصلی (runtime.test.js ۱۰۵/۱۰۵، mcp.test.js ۳۷/۳۷ و discussion.test.js ۲۳/۲۳) | 420/420 passed |
| **مجموع** | **634/634 passed** |

*نکته:* frontend با native ESM بدون build step bootstrap می‌شود؛ `app.js` renderer سازگار باقی مانده و domain modules/store/reducers در `web/public/app/` ثبت شده‌اند. APIها relative و project-aware هستند و behavior فعلی UI، markdown امن، RTL/LTR، modal، history، SSE replay و selectorها حفظ شده‌اند.
