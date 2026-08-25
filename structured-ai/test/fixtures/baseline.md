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
