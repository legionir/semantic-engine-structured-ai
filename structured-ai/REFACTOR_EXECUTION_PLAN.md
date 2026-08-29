# پلن اجرایی ریفکتور Structured AI با حفظ عملکرد فعلی

**وضعیت:** دامنهٔ refactor داخلی؛ اجرای نهایی در `EXECUTION_PLAN.md` ثبت شده است.
**تاریخ:** 2026-08-24
**پروژه:** `structured-ai`

---

> **Execution status and verification:** the implementation is tracked in
> [`EXECUTION_PLAN.md`](EXECUTION_PLAN.md), including the Phase 30 canonical
> rollout and final acceptance evidence.

## ۱. هدف اصلی

هدف این ریفکتور، تبدیل Structured AI از یک runtime بزرگ با چند فایل monolithic به مجموعه‌ای از ماژول‌های مشخص و قابل نگهداری است، بدون تغییر در رفتار فعلی.

مهم‌ترین الزام‌ها:

- Prompt به‌صورت dynamic ساخته شود.
- Prompt، runtime، ابزارها، MCP، persistence و UI در مسیرهای جدا قرار بگیرند.
- رفتار فعلی Agent، ابزارها، delegation، policy، memory، archive و UI حفظ شود.
- APIها، event nameها، schemaها، file pathهای موجود و error contractها بدون migration ناگهانی باقی بمانند.
- هر گام build/test مستقل داشته باشد.
- در پایان هر phase بتوان سیستم را اجرا و rollback کرد.

---

## ۲. وضعیت فعلی و نقاطی که به refactor نیاز دارند

### ۲.۱ فایل‌های بزرگ و مسئولیت‌های ترکیب‌شده

| فایل | وضعیت فعلی | مشکل اصلی | هدف refactor |
|---|---|---|---|
| `agent/agent.js` | حدود 250KB | configuration، registry، prompt، runtime loop، parser، tools، delegation، retry و reporting در یک فایل | تقسیم به runtime، prompt، action، delegation و request |
| `web/server.js` | حدود 60KB | HTTP server، routeها، sessions، SSE، settings، approvals و MCP در یک فایل | gateway/server core، routes، controllers و serializers |
| `web/public/app.js` | حدود 107KB | state، API، event reducer، chat، modal، execution، settings و rendering در یک فایل | frontend modules، store، API client و view components |
| `agent/lib/storage.js` | حدود 43KB | schema تنظیمات، defaultها، env، override، persistence و secret masking | config schema، store، resolver و persistence جدا |
| `agent/lib/archive.js` | حدود 29KB | archive storage، indexing، search، compaction و serialization | archive repository، index و query service |
| `agent/tools/filesystem.js` | حدود 20KB | path security، read، write، edit، move، delete و metadata | filesystem boundary و operationهای جدا |
| `agent/tools/code.js` | حدود 22KB | Semantic Engine client، code toolها، lifecycle و result mapping | semantic client، code tools و session manager |
| `agent/mcp/manager.js` | حدود 18KB | server registry، connection lifecycle، catalogue و runtime state | MCP registry، connection manager و catalogue |
| `agent/mcp/config.js` | حدود 15KB | config sources، interpolation، normalization و security | config loader، interpolation و validator |
| `agent/tools/plan.js` | حدود 17KB | plan persistence، validation، summary و tool handlers | plan model، repository و tools |
| `agent/lib/hooks.js` | حدود 17KB | hook registry، condition evaluation، rendering و execution | hook loader، evaluator، renderer و runner |
| `agent/lib/context.js` | حدود 15KB | context sizing، exchange detection، compression و budget | context model، compactor و policy |
| `agent/bin/interactive.js` | حدود 16KB | REPL، input، command parsing، rendering و session | CLI shell، command handlers و renderer |
| `agent/bin/agent.js` | حدود 24KB | CLI parsing، workspace setup، output و run lifecycle | CLI parser، command layer و application bootstrap |
| `agent/registry/tools.json` | حدود 60KB | تمام schemaهای ابزار در یک فایل | تقسیم declarative schemaها بر اساس tool group، با loader سازگار |

### ۲.۲ تست‌های بزرگ

این فایل‌ها نیز باید به‌تدریج تفکیک شوند، بدون حذف پوشش فعلی:

```text
structured-ai/test/runtime.test.js
structured-ai/test/e2e.test.js
structured-ai/test/ui.test.js
structured-ai/test/web.test.js
structured-ai/test/tools.test.js
structured-ai/test/mcp.test.js
```

تست‌ها باید از حالت «یک فایل برای همه چیز» به تست‌های domain-based تبدیل شوند:

```text
test/runtime/
test/prompt/
test/actions/
test/delegation/
test/context/
test/tools/
test/mcp/
test/web/
test/ui/
test/e2e/
```

---

## ۳. اصولی که در تمام مراحل باید حفظ شوند

### ۳.۱ بدون big-bang rewrite

ریفکتور به‌صورت استخراج تدریجی انجام شود:

```text
کد فعلی
  ↓
ماژول جدید
  ↓
wrapper با API قدیمی
  ↓
انتقال call siteها
  ↓
حذف implementation قدیمی
```

### ۳.۲ حفظ API داخلی فعلی

در طول migration، این exportها باید باقی بمانند:

```js
runAgent
createMainAgentMessages
createSubAgentMessages
buildAgentSystemPrompt
buildAgentRequest
executionRules
createRuntimeContext
maintainContext
resolveTools
validateAction
readModelAction
```

این exportها ابتدا wrapper می‌شوند و implementation به module جدید delegatе می‌شود.

### ۳.۳ حفظ قراردادهای بیرونی

موارد زیر نباید بی‌دلیل تغییر کنند:

- actionهای `tool_call`، `delegate` و `final`
- response schema
- tool nameها
- skill nameها
- event nameها
- payload eventها
- مسیرهای `.agent/`
- APIهای Web Console
- selectorها و idهای HTML
- شکل session و archive fileها
- error messageهای قابل مشاهده

### ۳.۴ هر استخراج باید قابل مقایسه باشد

برای هر Builder یا runtime جدید، خروجی قبل و بعد با normalizer مقایسه شود:

- timestampها حذف شوند.
- PID و duration نادیده گرفته شوند.
- ترتیب object keyها normalize شود.
- ترتیب ابزارها و skillها فقط در صورت قراردادی نبودن normalize شود.
- متن و fieldهای قراردادی دقیقاً برابر بمانند.

---

# ۴. ساختار هدف پروژه

ساختار پیشنهادی نهایی:

```text
structured-ai/
├── bin/
│   ├── agent.js
│   ├── interactive.js
│   └── backfill-eventstore.js
│
├── agent/
│   ├── application/
│   │   ├── run-agent.js
│   │   ├── run-session.js
│   │   └── lifecycle.js
│   │
│   ├── runtime/
│   │   ├── AgentRun.js
│   │   ├── IterationRunner.js
│   │   ├── ActionProcessor.js
│   │   ├── ToolGraphExecutor.js
│   │   ├── DelegationRunner.js
│   │   ├── RetryController.js
│   │   ├── RunBudget.js
│   │   ├── RunState.js
│   │   └── ReportVerifier.js
│   │
│   ├── prompt/
│   │   ├── PromptBuilder.js
│   │   ├── MainPromptBuilder.js
│   │   ├── SubAgentPromptBuilder.js
│   │   ├── RuntimeContextBuilder.js
│   │   ├── RequestBuilder.js
│   │   ├── ToolResolver.js
│   │   ├── SkillResolver.js
│   │   ├── PromptMessages.js
│   │   └── index.js
│   │
│   ├── actions/
│   │   ├── ActionParser.js
│   │   ├── ActionNormalizer.js
│   │   ├── ActionValidator.js
│   │   ├── ResponseRepair.js
│   │   └── NativeToolCallAdapter.js
│   │
│   ├── config/
│   │   ├── SettingsSchema.js
│   │   ├── SettingsStore.js
│   │   ├── SettingsResolver.js
│   │   └── SecretMasker.js
│   │
│   ├── registry/
│   │   ├── RegistryLoader.js
│   │   ├── RegistryValidator.js
│   │   ├── AgentRegistry.js
│   │   ├── ToolRegistry.js
│   │   ├── SkillRegistry.js
│   │   └── registry-data/
│   │
│   ├── context/
│   │   ├── ContextManager.js
│   │   ├── ConversationSizer.js
│   │   ├── ContextCompactor.js
│   │   ├── MemoryCoordinator.js
│   │   └── ArchiveCoordinator.js
│   │
│   ├── persistence/
│   │   ├── JsonRepository.js
│   │   ├── AtomicFile.js
│   │   ├── SessionRepository.js
│   │   ├── MemoryRepository.js
│   │   ├── ArchiveRepository.js
│   │   ├── JournalRepository.js
│   │   └── EventStoreRepository.js
│   │
│   ├── tools/
│   │   ├── index.js
│   │   ├── filesystem/
│   │   ├── process/
│   │   ├── code/
│   │   ├── git/
│   │   ├── planning/
│   │   ├── memory/
│   │   ├── skills/
│   │   ├── search/
│   │   └── mcp/
│   │
│   ├── mcp/
│   │   ├── McpManager.js
│   │   ├── McpConfigLoader.js
│   │   ├── McpConnection.js
│   │   ├── McpCatalogue.js
│   │   ├── protocol/
│   │   └── transports/
│   │
│   ├── policy/
│   │   ├── PolicyEngine.js
│   │   ├── ApprovalManager.js
│   │   ├── PolicyMatcher.js
│   │   └── PolicyRegistry.js
│   │
│   ├── hooks/
│   │   ├── HookRegistry.js
│   │   ├── HookRunner.js
│   │   ├── HookCondition.js
│   │   └── HookRenderer.js
│   │
│   └── config-files/
│       ├── system_prompt.txt
│       ├── execution_rules.txt
│       └── response_format*.json
│
├── web/
│   ├── server/
│   │   ├── WebServer.js
│   │   ├── Router.js
│   │   ├── Controllers/
│   │   ├── Serializers/
│   │   ├── SseHub.js
│   │   └── ApprovalController.js
│   └── public/
│       ├── app/
│       │   ├── main.js
│       │   ├── store.js
│       │   ├── api.js
│       │   ├── events.js
│       │   ├── chat.js
│       │   ├── execution.js
│       │   ├── settings.js
│       │   ├── mcp.js
│       │   ├── history.js
│       │   ├── modals.js
│       │   └── markdown.js
│       └── visualizer/
│           ├── main.js
│           ├── graph-store.js
│           ├── graph-renderer.js
│           └── layout-client.js
│
└── test/
    ├── prompt/
    ├── runtime/
    ├── actions/
    ├── context/
    ├── tools/
    ├── mcp/
    ├── web/
    ├── ui/
    └── e2e/
```

این ساختار الزاماً نباید در یک commit ساخته شود. هر directory در phase مربوط به خودش ایجاد می‌شود.

---

# ۵. گام‌های اجرایی

## گام ۰ — ثبت baseline و قرارداد regression

### هدف

قبل از هر extraction، رفتار فعلی با تست و snapshot ثبت شود.

### علت

بدون baseline مشخص نمی‌شود refactor فقط ساختار را تغییر داده یا رفتار runtime نیز تغییر کرده است.

### نحوهٔ پیاده‌سازی

1. اجرای کل تست‌های فعلی.
2. ثبت command، exit code و تعداد تست‌ها.
3. ساخت fixtureهای deterministic برای:
   - prompt Main Agent
   - prompt Sub-Agent
   - tool request
   - action parsing
   - context compaction
   - delegation
   - MCP discovery
   - UI state
4. ایجاد normalizer برای timestamp، PID و duration.
5. ثبت event contractهای فعلی.

### فایل‌های پیشنهادی

```text
structured-ai/test/fixtures/
structured-ai/test/helpers/normalize.js
structured-ai/test/contracts/events.contract.test.js
structured-ai/test/contracts/prompt.contract.test.js
```

### معیار پذیرش

- کل suite فعلی سبز باشد.
- خروجی baseline ذخیره شده باشد.
- حداقل یک fixture برای هر action وجود داشته باشد.
- event nameها و payloadهای مهم مستند شده باشند.
- هیچ refactorی قبل از سبز شدن baseline شروع نشود.

---

## گام ۱ — ایجاد لایهٔ Application و facade سازگار

### هدف

نقطهٔ ورود runtime از منطق داخلی جدا شود، بدون تغییر API فعلی.

### علت

در حال حاضر `agent.js` هم entry point است، هم orchestrator، هم تمام implementationها را در خود دارد.

### نحوهٔ پیاده‌سازی

1. ایجاد `agent/application/run-agent.js`.
2. انتقال تدریجی startup و shutdown به آن.
3. نگه‌داشتن `agent/agent.js` به‌عنوان facade موقت.
4. export کردن `runAgent` از facade.
5. انتقال responsibility مربوط به session و run lifecycle به `application`.

ساختار موقت:

```js
// agent/agent.js
const application = require('./application/run-agent');

module.exports = {
  ...legacyExports,
  runAgent: application.runAgent
};
```

### معیار پذیرش

- CLI فعلی بدون تغییر command کار کند.
- `require('./agent/agent').runAgent()` رفتار قبلی را حفظ کند.
- shutdown و process cleanup تغییر نکند.
- eventهای `run:start` و `run:end` همان payload قبلی را داشته باشند.
- هیچ business logic جدیدی در facade اضافه نشود.

---

## گام ۲ — تفکیک Config و Registry

### هدف

تنظیمات runtime و registryهای declarative از `agent.js` خارج شوند.

### علت

`storage.js` و بخش Registry در `agent.js` چند مسئولیت مستقل دارند و تغییر یک schema می‌تواند به runtime آسیب بزند.

### نحوهٔ پیاده‌سازی

#### Config

```text
agent/config/SettingsSchema.js
agent/config/SettingsStore.js
agent/config/SettingsResolver.js
agent/config/SecretMasker.js
```

مسئولیت‌ها:

- `SettingsSchema`: تعریف type، default، min/max و توضیح.
- `SettingsStore`: خواندن مقدار، override و reset.
- `SettingsResolver`: اولویت env، فایل و runtime override.
- `SecretMasker`: masking برای UI، log و runtime context.

API سازگار:

```js
settings.get(key)
settings.set(key, value)
settings.reset(key)
settings.sourceOf(key)
settings.snapshot()
```

#### Registry

```text
agent/registry/RegistryLoader.js
agent/registry/RegistryValidator.js
agent/registry/AgentRegistry.js
agent/registry/ToolRegistry.js
agent/registry/SkillRegistry.js
```

`loadRegistries()` فعلی به loader جدید منتقل شود و با mtime/size همچنان live reload داشته باشد.

### تفکیک `tools.json`

در مرحلهٔ بعد schema ابزارها از یک فایل بزرگ به گروه‌های جدا تقسیم شوند:

```text
agent/registry/tool-schemas/
├── filesystem.json
├── process.json
├── git.json
├── code.json
├── planning.json
├── memory.json
└── mcp.json
```

یک loader آن‌ها را به شکل قدیمی آرایهٔ tools برگرداند تا runtime و مدل هیچ تغییری نبینند.

### معیار پذیرش

- تمام settings فعلی با همان default و type موجود باشند.
- تغییر setting از UI هنوز در iteration بعدی اعمال شود.
- env override همان اولویت قبلی را داشته باشد.
- secretها در snapshot و log mask شوند.
- registry خراب باعث پیام واضح شود، نه crash مبهم.
- خروجی `resolveTools()` قبل و بعد برابر باشد.

---

## گام ۳ — استخراج کامل Prompt Builder

### هدف

Prompt به‌صورت dynamic ساخته شود، اما composition آن در فایل‌های مستقل و قابل نگهداری قرار بگیرد.

### علت

Prompt فعلی بخشی از orchestration بزرگ `agent.js` است و تغییر یک بخش آن نیازمند دست‌زدن به فایل 250KB است.

### ساختار نهایی

```text
agent/prompt/
├── PromptBuilder.js
├── MainPromptBuilder.js
├── SubAgentPromptBuilder.js
├── RuntimeContextBuilder.js
├── RequestBuilder.js
├── ToolResolver.js
├── SkillResolver.js
├── PromptMessages.js
└── index.js
```

### `PromptBuilder`

Facade اصلی:

```js
class PromptBuilder {
  buildMainMessages({ task, history, agentDefinition }) {}
  buildSubAgentMessages({ task, context, agentDefinition }) {}
  buildAgentSystemPrompt(agentDefinition) {}
  buildRequest(options) {}
  refreshRuntimeContext(messages) {}
}
```

این class نباید مستقیماً به globalهای `agent.js` وابسته باشد. dependencyها به آن inject شوند:

```js
new PromptBuilder({
  settings,
  registry,
  runtimeContextBuilder,
  toolResolver,
  skillResolver,
  endpointResolver,
  responseSchemaProvider,
  executionRulesProvider
});
```

### `MainPromptBuilder`

منطق فعلی `createMainAgentMessages(task)` به این فایل منتقل شود.

پیام‌های Main Agent:

```text
1. system_prompt
2. execution_rules
3. runtime_context
4. available_skills
5. available_personas، در صورت امکان delegation
6. available_agents
7. user task
```

### `SubAgentPromptBuilder`

منطق فعلی `buildAgentSystemPrompt()` و `createSubAgentMessages()` به این فایل منتقل شود.

پیام‌های Sub-Agent:

```text
1. persona
2. execution rules فیلترشده
3. agent runtime rules
4. skills
5. output contract
6. delegation policy
7. runtime context
8. agent profile
9. available tools
10. task و context والد
```

### `RuntimeContextBuilder`

اطلاعات زیر را به‌صورت dynamic بسازد:

```text
workspace
repository
plan
memory
archive
policy
endpoints
runtime budget
MCP state
```

`refreshRuntimeContext()` فقط wrapper کوچکی برای update پیام runtime context باشد.

### `RequestBuilder`

بدنهٔ OpenAI-compatible request را بسازد:

```json
{
  "model": "...",
  "messages": [],
  "temperature": 0.1,
  "tools": [],
  "parallel_tool_calls": true,
  "response_format": {}
}
```

Summarizer باید همچنان با `responseFormat: null` بدون tool schema اجرا شود.

### Dynamic behavior که باید حفظ شود

- system prompt با live mtime دوباره خوانده شود.
- execution rules بر اساس ابزارهای Agent فیلتر شوند.
- registryها live reload شوند.
- MCP tools قبل از اولین request discover شوند.
- `semantic_engine` skill فقط در صورت فعال بودن Semantic MCP در prompt قرار گیرد.
- skillها به‌صورت index اولیه و full detail با `skill_get` ارائه شوند.
- runtime context در ابتدای هر iteration refresh شود.
- settings جدید در iteration بعدی اثر کنند.

### Wrapper موقت در `agent.js`

```js
function createMainAgentMessages(task) {
  return getPromptBuilder().buildMainMessages({
    task,
    agentDefinition: mainAgentProfile()
  });
}
```

### معیار پذیرش

- خروجی normalized prompt Main قبل و بعد یکسان باشد.
- خروجی normalized prompt Sub-Agent قبل و بعد یکسان باشد.
- تغییر `system_prompt.txt` در request بعدی دیده شود.
- تغییر `skills.json` در prompt بعدی دیده شود.
- خاموش کردن Semantic MCP باعث حذف `semantic_engine` skill شود.
- ابزارهای MCP discoverشده در `tools` request باقی بمانند.
- هیچ tool result یا reasoning ناخواسته وارد system prompt نشود.
- `response_format`، model، temperature و `parallel_tool_calls` تغییر نکنند.

---

## گام ۴ — تفکیک Action Parser و Response Normalizer

### هدف

خواندن، repair، normalize و validation پاسخ مدل از runtime loop خارج شود.

### علت

در `agent.js` parser، native tool call adapter، Markdown repair، response repair و validation در چند هزار خط کنار execution قرار دارند.

### ساختار پیشنهادی

```text
agent/actions/
├── ActionParser.js
├── ActionNormalizer.js
├── ActionValidator.js
├── ResponseRepair.js
├── NativeToolCallAdapter.js
└── ActionErrors.js
```

### مسئولیت‌ها

- `ActionParser`: خواندن JSON، fenced JSON و provider response.
- `NativeToolCallAdapter`: تبدیل native tool calls به action داخلی.
- `ResponseRepair`: اصلاح envelope ناقص و Markdown pathها.
- `ActionValidator`: بررسی schema و field matrix.
- `ActionErrors`: error code و detailهای استاندارد.

### معیار پذیرش

- تمام actionهای معتبر فعلی معتبر باقی بمانند.
- پاسخ ناقص همان retry و error code قبلی را ایجاد کند.
- response schema strict/non-strict حفظ شود.
- native tool callها همان action قبلی تولید کنند.
- error messageها و `response_diagnostics` حفظ شوند.
- testهای malformed response بدون تغییر سبز بمانند.

---

## گام ۵ — تفکیک Runtime Loop و Agent Orchestration

### هدف

حلقهٔ iteration، execution graph، delegation و budget مستقل شوند.

### علت

حجم زیادی از `agent.js` مربوط به runtime است و به prompt یا tool implementation ارتباط مستقیم ندارد.

### ساختار پیشنهادی

```text
agent/runtime/
├── AgentRun.js
├── IterationRunner.js
├── ActionProcessor.js
├── ToolGraphExecutor.js
├── DelegationRunner.js
├── RetryController.js
├── RunBudget.js
├── RunState.js
└── ReportVerifier.js
```

### جریان جدید

```text
AgentRun
  ├── initialize
  ├── discover capabilities
  ├── run before hooks
  ├── iteration loop
  │   ├── maintain context
  │   ├── refresh runtime context
  │   ├── request model
  │   ├── parse action
  │   ├── process action
  │   └── append results
  ├── run after hooks
  └── verify final report
```

`ActionProcessor` فقط dispatch کند:

```text
tool_call → ToolGraphExecutor
delegate  → DelegationRunner
final     → finalization + hooks
```

### معیار پذیرش

- ترتیب execution waveها تغییر نکند.
- `depends_on` همان رفتار قبلی را داشته باشد.
- max iterations، deadline و cancellation حفظ شوند.
- delegation budget و depth limit حفظ شوند.
- report mismatch همچنان جلوی ادعای تأییدنشده را بگیرد.
- eventهای runtime همان زمان و payload منطقی قبلی را داشته باشند.

---

## گام ۶ — تفکیک Context، Memory و Archive

### هدف

context management از runtime و persistence مستقل شود.

### علت

`context.js`، `memory.js`، `archive.js` و بخشی از `agent.js` روی یک concern مشترک کار می‌کنند، اما مسئولیت‌هایشان جدا نیست.

### ساختار پیشنهادی

```text
agent/context/
├── ContextManager.js
├── ConversationSizer.js
├── ExchangeDetector.js
├── ContextCompactor.js
├── MemoryCoordinator.js
└── ArchiveCoordinator.js

agent/persistence/
├── AtomicFile.js
├── JsonRepository.js
├── MemoryRepository.js
└── ArchiveRepository.js
```

### رفتار قابل حفظ

```text
recent exchanges → untouched
older exchanges → light/medium/heavy compression
folded exchanges → archive
important facts → working memory
```

تنظیمات زیر نباید تغییر کنند:

```text
MAX_CONTEXT_CHARS
CONTEXT_COMPACT_AT
KEEP_RECENT_EXCHANGES
CONTEXT_LIGHT_CHARS
CONTEXT_MEDIUM_CHARS
CONTEXT_SUMMARY
MEMORY_ENABLED
MEMORY_CHUNK_CHARS
MEMORY_MAX_SUMMARY_CALLS
MEMORY_SUMMARY_PARALLELISM
MEMORY_MAX_CHARS
ARCHIVE_ENABLED
```

### معیار پذیرش

- تعداد و ترتیب پیام‌های نگه‌داشته‌شده تغییر نکند.
- tool call و tool result pair از هم جدا نشوند.
- archive قبل از compaction نوشته شود.
- memory message در محل قبلی قرار بگیرد.
- archive_search و archive_get همان نتیجهٔ قبلی را بدهند.
- بعد از restart، memory و archive قابل بازیابی باشند.
- سقف context هیچ request بزرگ‌تر از قبل تولید نکند.

---

## گام ۷ — تفکیک Persistence و File Formatها

### هدف

نوشتن session، memory، journal، eventstore و archive از implementation domain جدا شود.

### علت

اکنون چند ماژول مستقل مستقیماً با `fs` کار می‌کنند و atomic write، safe ID، migration و error handling ممکن است بین آن‌ها متفاوت شود.

### ساختار پیشنهادی

```text
agent/persistence/
├── AtomicFile.js
├── JsonRepository.js
├── SafeIdentifier.js
├── SchemaVersion.js
├── SessionRepository.js
├── MemoryRepository.js
├── ArchiveRepository.js
├── JournalRepository.js
└── EventStoreRepository.js
```

### نحوهٔ پیاده‌سازی

- pathهای فعلی `.agent/` در phase اول تغییر نکنند.
- فقط عملیات read/write به repositoryها منتقل شوند.
- فایل‌ها با temp + rename اتمیک نوشته شوند.
- corruption باعث fallback کنترل‌شده شود.
- version و migration handler اضافه شود.
- safe ID فعلی sessionها حفظ شود.

### معیار پذیرش

- فایل‌های موجود بدون migration دستی خوانده شوند.
- sessionهای قدیمی replay شوند.
- archive و journal format تغییر نکنند.
- crash وسط write فایل ناقص باقی نگذارد.
- error یک فایل خراب، کل runtime را متوقف نکند مگر contract فعلی همین را الزام کند.

---

## گام ۸ — تفکیک ابزارها و Tool Registry

### هدف

tool implementation، schema، policy و lifecycle از یکدیگر جدا شوند.

### علت

`tools/index.js` implementation map مرکزی دارد و toolهای بزرگ مانند filesystem و code چند responsibility دارند.

### ساختار پیشنهادی

```text
agent/tools/
├── ToolRuntime.js
├── ToolRegistryAdapter.js
├── filesystem/
│   ├── PathBoundary.js
│   ├── ReadTools.js
│   ├── WriteTools.js
│   ├── DirectoryTools.js
│   └── FileMetadataTools.js
├── process/
│   ├── ProcessManager.js
│   ├── ForegroundCommand.js
│   └── BackgroundSession.js
├── code/
│   ├── SemanticClient.js
│   ├── SemanticTools.js
│   ├── LiveLspTools.js
│   └── IndexSessions.js
├── planning/
│   ├── PlanModel.js
│   ├── PlanRepository.js
│   └── PlanTools.js
├── memory/
│   ├── MemoryTools.js
│   └── ArchiveTools.js
└── index.js
```

### اصل مهم

تعریف tool و implementation همچنان باید قابل مقایسه باشند:

```text
tools registry → declaration/schema
tools runtime  → implementation
validator      → parity check
```

### معیار پذیرش

- تمام tool nameهای فعلی در دسترس باشند.
- schema و argument validation تغییر نکند.
- filesystem boundary و symlink protection حفظ شود.
- process group kill و timeout حفظ شوند.
- semantic fallback و index sessionها حفظ شوند.
- tool result cap و telemetry همان مقادیر قبلی را داشته باشند.
- `tools.executeTool()` API سازگار باقی بماند.

---

## گام ۹ — تفکیک MCP Layer

### هدف

MCP config، connection، protocol، catalogue و transport به modules مستقل تبدیل شوند.

### علت

`manager.js` و `config.js` علاوه بر connection lifecycle، normalization، tool catalogue و security را نیز مدیریت می‌کنند.

### ساختار پیشنهادی

```text
agent/mcp/
├── McpManager.js
├── McpConfigLoader.js
├── McpConfigValidator.js
├── McpConnection.js
├── McpCatalogue.js
├── McpTrustPolicy.js
├── protocol/
│   ├── JsonRpcCodec.js
│   ├── ContentLengthCodec.js
│   ├── NdjsonCodec.js
│   └── McpErrors.js
└── transports/
    ├── StdioTransport.js
    ├── HttpTransport.js
    ├── SseTransport.js
    └── WebSocketTransport.js
```

### رفتار قابل حفظ

- چهار transport فعلی.
- MCP server discovery.
- namespaced tools.
- `mcp_call` gateway.
- trust و approval policy.
- timeout و maximum message size.
- runtime add/remove.
- Semantic Engine به‌عنوان built-in MCP server.

### معیار پذیرش

- handshake هر چهار transport موفق باشد.
- framing split/merged message درست decode شود.
- ابزارهای هم‌نام serverها collision نداشته باشند.
- server خراب باعث crash runtime نشود.
- mcp server state و error همان result قبلی را بدهد.
- تست‌های `mcp.test.js` و `semantic.test.js` بدون تغییر سبز بمانند.

---

## گام ۱۰ — تفکیک Policy و Approval

### هدف

policy matching، approval lifecycle و enforcement مستقل شوند.

### علت

policy فقط یک helper نیست؛ یک boundary امنیتی است و باید مستقل، تست‌پذیر و قابل audit باشد.

### ساختار پیشنهادی

```text
agent/policy/
├── PolicyEngine.js
├── PolicyMatcher.js
├── PolicyRegistry.js
├── ApprovalManager.js
├── ApprovalStore.js
└── PolicyErrors.js
```

### flow

```text
Agent tool request
  → Agent allowlist
  → argument resolution
  → PolicyMatcher
  → allow / deny / require approval
  → approval handler
  → execution
  → audit event
```

### معیار پذیرش

- هیچ callی بدون عبور از policy اجرا نشود.
- policy روی argumentهای resolveشده اعمال شود.
- حالت‌های `auto`، `prompt` و `deny` حفظ شوند.
- MCP approval و filesystem/terminal approval حفظ شوند.
- approvalهای pending در UI و API همان‌طور دیده شوند.
- deny و approval eventها با payload قبلی تولید شوند.

---

## گام ۱۱ — تفکیک Hooks

### هدف

hook declaration، شرط، rendering و execution مستقل شوند.

### علت

`hooks.js` هم registry است، هم template renderer، هم condition evaluator و هم runner.

### ساختار پیشنهادی

```text
agent/hooks/
├── HookRegistry.js
├── HookLoader.js
├── HookCondition.js
├── HookRenderer.js
├── HookRunner.js
└── HookResult.js
```

### معیار پذیرش

- before/after task hookها با همان ترتیب اجرا شوند.
- `on_failure` behavior تغییر نکند.
- template variableها همان مقدار قبلی را بگیرند.
- hook eventها حفظ شوند.
- hookهای غیرفعال یا نامعتبر رفتار فعلی را داشته باشند.
- hook commit و hook agent همچنان درست اجرا شوند.

---

## گام ۱۲ — تفکیک Web Backend

### هدف

`web/server.js` از یک فایل monolithic به server، router، controller و service تقسیم شود.

### علت

Web server فعلی هم transport HTTP، هم session، هم task execution، هم event stream، هم settings و هم UI API را مدیریت می‌کند.

### ساختار پیشنهادی

```text
web/server/
├── WebServer.js
├── Router.js
├── RequestBody.js
├── Response.js
├── Middleware.js
├── controllers/
│   ├── TaskController.js
│   ├── SessionController.js
│   ├── StateController.js
│   ├── SettingsController.js
│   ├── ApprovalController.js
│   ├── McpController.js
│   ├── ArchiveController.js
│   └── PlanController.js
├── services/
│   ├── TaskService.js
│   ├── SessionService.js
│   ├── SettingsService.js
│   └── EventStreamService.js
├── serializers/
│   ├── StateSerializer.js
│   ├── SessionSerializer.js
│   └── ErrorSerializer.js
└── SseHub.js
```

### نحوهٔ پیاده‌سازی

1. ابتدا routeهای فعلی inventory شوند.
2. برای هر route contract test نوشته شود.
3. handlerها یکی‌یکی به controller منتقل شوند.
4. server فقط request routing و lifecycle را نگه دارد.
5. response shape و status codeها تغییر نکنند.

### معیار پذیرش

- تمام endpointهای فعلی همان status و JSON را بدهند.
- SSE connection قطع نشود و eventها از دست نروند.
- approval UI/API همان behavior قبلی را داشته باشد.
- session replay و history همچنان کار کند.
- endpointهای settings و MCP live reload باقی بمانند.
- تست‌های web و UI بدون تغییر contract سبز بمانند.

---

## گام ۱۳ — تفکیک Frontend Web Console

### هدف

`web/public/app.js` و `app.css` به modules مستقل تقسیم شوند، بدون اضافه‌کردن framework سنگین در phase اول.

### علت

فایل فعلی هم state management، هم rendering، هم fetch، هم event handling، هم markdown، هم modal و هم chat را انجام می‌دهد.

### ساختار پیشنهادی

```text
web/public/app/
├── main.js
├── store.js
├── api.js
├── event-stream.js
├── task-runner.js
├── chat.js
├── execution-view.js
├── event-view.js
├── settings-view.js
├── mcp-view.js
├── history-view.js
├── plan-view.js
├── modal-manager.js
├── markdown.js
├── direction.js
├── dom.js
└── formatters.js
```

### Store پیشنهادی

State فعلی به domainهای جدا تقسیم شود:

```text
runtimeState
conversationState
executionState
eventState
approvalState
settingsState
mcpState
historyState
planState
```

Reducerها باید eventهای فعلی را مصرف کنند:

```text
run:start
run:end
agent:start
agent:iteration
agent:thinking
agent:response
tool:start
tool:end
policy:decision
approval:request
approval:resolved
context:compacted
```

### حفظ behavior UI

- Markdown امن.
- RTL/LTR خودکار.
- execution block برای هر iteration.
- modal lifecycle.
- event replay.
- session history.
- cancel task.
- MCP settings.
- plan display.

### معیار پذیرش

- تمام selectorهای فعلی کار کنند.
- UI بعد از چند بار باز و بسته کردن modal خراب نشود.
- execution هر AI iteration جدا نمایش داده شود.
- reasoning و پاسخ AI از بین نرود.
- event replay duplicate ایجاد نکند.
- پیام فارسی/عربی/عبری با `dir="rtl"` نمایش داده شود.
- markdown unsafe به HTML اجرایی تبدیل نشود.
- تست‌های UI و web بدون تغییر user-facing behavior سبز بمانند.

---

## گام ۱۴ — تفکیک Visualizer

### هدف

Visualizer از chat console و state عمومی UI مستقل شود.

### ساختار پیشنهادی

```text
web/public/visualizer/
├── main.js
├── api-client.js
├── graph-store.js
├── graph-model.js
├── graph-renderer.js
├── layout-client.js
├── selection-state.js
├── node-details.js
└── visualizer-events.js
```

### علت

Visualizer graph، layout worker، selection و APIهای semantic را مدیریت می‌کند و نباید با state chat coupling مستقیم داشته باشد.

### معیار پذیرش

- graphهای architecture، module، file و neighborhood مانند قبل load شوند.
- layout worker و fallback همان رفتار را داشته باشند.
- انتخاب node و نمایش detail حفظ شود.
- Visualizer در sessionهای مختلف state قبلی را leak نکند.
- API callهای semantic با همان URL و payload انجام شوند.

---

## گام ۱۵ — تفکیک CLI و Interactive REPL

### هدف

CLI اصلی و REPL تعاملی قابل توسعه و مستقل شوند.

### ساختار پیشنهادی

```text
agent/cli/
├── ArgParser.js
├── CommandRegistry.js
├── OutputFormatter.js
├── RunCommand.js
├── ServeCommand.js
├── InteractiveCommand.js
└── HelpCommand.js

agent/interactive/
├── Repl.js
├── ReplCommands.js
├── InputReader.js
├── OutputRenderer.js
└── ApprovalPrompt.js
```

### معیار پذیرش

- commandهای فعلی تغییر نکنند.
- `--json` فقط JSON معتبر روی stdout بدهد.
- log stream و final output همان behavior فعلی را داشته باشند.
- `/help`، `/clear`، `/history`، `/approve`، `/tools` و `/save` حفظ شوند.
- approval prompt با execution runtime سازگار بماند.

---

## گام ۱۶ — Event Contract و Observability

### هدف

Event bus، journal، eventstore، telemetry و UI event reducer از هم تفکیک شوند، ولی event contract ثابت بماند.

### علت

در حال حاضر event تولید، ذخیره، replay و نمایش در چند بخش پراکنده است. تغییر یک event می‌تواند runtime و UI را هم‌زمان بشکند.

### ساختار پیشنهادی

```text
agent/events/
├── EventBus.js
├── EventTypes.js
├── EventValidator.js
├── EventContext.js
├── EventProjector.js
└── EventRedactor.js
```

### معیار پذیرش

- event nameهای فعلی حفظ شوند.
- event payload validation اضافه شود.
- secret و source content در log mask شوند.
- journal و eventstore همان eventها را ذخیره کنند.
- UI همان eventها را replay کند.
- telemetry از business eventها جدا باشد.

---

## گام ۱۷ — تفکیک Test Suite و ایجاد Contract Tests

### هدف

تست‌ها به‌جای پوشش monolith، behavior هر boundary را مستقل بررسی کنند.

### ساختار پیشنهادی

```text
structured-ai/test/
├── contracts/
│   ├── action-contract.test.js
│   ├── tool-contract.test.js
│   ├── event-contract.test.js
│   ├── api-contract.test.js
│   └── persistence-contract.test.js
├── prompt/
│   ├── main-prompt.test.js
│   ├── sub-agent-prompt.test.js
│   ├── runtime-context.test.js
│   ├── request-builder.test.js
│   └── dynamic-reload.test.js
├── runtime/
│   ├── iteration.test.js
│   ├── budget.test.js
│   ├── cancellation.test.js
│   └── report-verification.test.js
├── actions/
│   ├── parser.test.js
│   ├── repair.test.js
│   └── validator.test.js
├── context/
│   ├── compaction.test.js
│   ├── memory.test.js
│   └── archive.test.js
├── tools/
│   ├── filesystem/
│   ├── process/
│   ├── code/
│   └── planning/
├── mcp/
├── web/
├── ui/
└── e2e/
```

### تست differential

برای phaseهای استخراج از facade قدیمی استفاده شود:

```js
const before = legacyBuilder(input);
const after = newBuilder(input);
assert.deepStrictEqual(normalize(after), normalize(before));
```

### معیار پذیرش

- تعداد تست‌ها بعد از split کم نشود.
- هر module جدید تست unit داشته باشد.
- هر مرز عمومی contract test داشته باشد.
- full suite بعد از هر phase سبز باشد.
- تست‌های e2e رفتار واقعی کاربر را حفظ کنند.

---

## گام ۱۸ — ترتیب merge و rollout

### ترتیب پیشنهادی commitها

```text
1.  add baseline and contract fixtures
2.  extract settings and registry loaders
3.  extract prompt builders
4.  extract action parser/validator
5.  extract runtime loop
6.  extract context and persistence repositories
7.  split tool implementations
8.  split MCP layer
9.  split policy and hooks
10. split web backend
11. split web frontend
12. split visualizer
13. split CLI and REPL
14. add event contracts and observability boundaries
15. split tests and update documentation
16. remove deprecated monolith wrappers
```

### قانون هر commit

هر commit باید:

- build/check را پاس کند.
- تست مرتبط خود را داشته باشد.
- behavior جدید اضافه نکند، مگر برای compatibility.
- wrapper قبلی را تا پایان migration نگه دارد.
- diff آن قابل review باشد.

### rollout

در ابتدا implementation جدید با feature flag داخلی قابل فعال‌سازی باشد:

```text
PROMPT_BUILDER_MODE=legacy|modular
RUNTIME_ENGINE_MODE=legacy|modular
WEB_SERVER_MODE=legacy|modular
```

پس از برابر بودن خروجی و سبز بودن full suite، default به modular تغییر کند. در نهایت flagهای legacy حذف شوند.

---

# ۶. معیار پذیرش نهایی

ریفکتور زمانی کامل است که تمام موارد زیر برقرار باشند:

## Prompt

- Prompt dynamic باشد.
- Main و Sub-Agent builder جدا باشند.
- Runtime context در هر iteration refresh شود.
- skillها conditional و on-demand باشند.
- ابزارها در فیلد `tools` و نه به‌صورت متن تکراری ارسال شوند.
- response schema و endpoint policy حفظ شوند.

## Runtime

- actionهای `tool_call`، `delegate` و `final` بدون تغییر کار کنند.
- execution graph و parallel waves حفظ شوند.
- retry، deadline، cancellation و budget حفظ شوند.
- delegation و Sub-Agent context ایزوله بماند.

## Tools و MCP

- تمام tool nameها و schemaها حفظ شوند.
- workspace boundary و security guardها حفظ شوند.
- چهار MCP transport کار کنند.
- Semantic Engine integration و skill activation حفظ شود.

## Persistence

- session، memory، archive، journal و eventstore قدیمی خوانده شوند.
- file pathهای فعلی تا زمان migration رسمی تغییر نکنند.
- writeها atomic و corruption-safe باشند.

## Web و UI

- تمام endpointها و status codeها حفظ شوند.
- SSE، modal، execution، events، settings، MCP و history کار کنند.
- Markdown امن و RTL/LTR حفظ شود.
- Visualizer و graph interactions تغییر نکنند.

## کیفیت فنی

- monolithهای اصلی به modules با یک مسئولیت مشخص تقسیم شده باشند.
- moduleها dependencyهای صریح داشته باشند.
- global mutable state کاهش یافته باشد.
- هر module تست مستقل و هر boundary contract test داشته باشد.
- full test suite، check و lint سبز باشند.
- مستندات ساختار جدید و روش افزودن tool، skill، agent و prompt section به‌روز شده باشند.

---

# ۷. نتیجهٔ مورد انتظار

بعد از این refactor، افزودن یک قابلیت جدید نباید نیازمند ویرایش `agent/agent.js` باشد.

نمونهٔ مورد انتظار:

### افزودن skill

```text
agent/registry/skills.json
agent/tools/skills.js
```

### افزودن tool

```text
agent/registry/tool-schemas/code.json
agent/tools/code/SemanticTools.js
agent/policy/PolicyRegistry.js
```

### تغییر Prompt

```text
agent/config/system_prompt.txt
agent/prompt/MainPromptBuilder.js
agent/prompt/RuntimeContextBuilder.js
```

### افزودن event UI

```text
agent/events/EventTypes.js
web/server/SseHub.js
web/public/app/event-stream.js
web/public/app/<feature>.js
```

این تفکیک باعث می‌شود توسعهٔ آیندهٔ Structured AI، بدون ریسک شکستن هم‌زمان runtime، prompt، MCP و UI انجام شود.


---

## وضعیت اجرای نهایی

تمام گام‌های refactor این سند در Phases 14–30 اجرا و verification شده‌اند. ساختار
canonical شامل `agent/actions`، `agent/application`، `agent/config`،
`agent/context`، `agent/events`، `agent/hooks`، `agent/mcp`، `agent/persistence`,
`agent/policy`، `agent/projects`، `agent/prompt`، `agent/runtime` و گروه‌های
`agent/tools` است. facadeها و rollout flagهای موقت در Phase 30 حذف شدند؛ برای
status، mapping و شمارش تست‌ها به [`EXECUTION_PLAN.md`](EXECUTION_PLAN.md) مراجعه کنید.
