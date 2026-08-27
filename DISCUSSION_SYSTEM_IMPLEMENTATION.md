# پیاده‌سازی Multi-Agent Discussion System — تحلیل و نقشه راه

این سند تحلیل اسپک داده‌شده و نحوه پیاده‌سازی آن روی runtime فعلی `structured-ai` را توضیح می‌دهد.

## وضعیت پیاده‌سازی (به‌روزرسانی پس از اجرا)

همهٔ فازهای ۰ تا ۸ پیاده‌سازی شده‌اند:

| فاز | وضعیت | محل |
|---|---|---|
| 0 — رجیستری (۱۵ پرسونا + observer) | ✅ | `agent/registry/personas.json`، `agent/registry/agents.json` (پروفایل‌های `discussion_*`)؛ منبع حقیقت prompt ها: `agent/discussion/personas.js`، تولید از `tools/add-discussion-registry.js` |
| 1 — Types & Transcript | ✅ | `agent/discussion/types.js`، `transcript.js` |
| 2 — PersonaRunner & ObserverRunner | ✅ | `personaRunner.js`، `observerRunner.js` (پارس JSON با fallback، تضمین گزارش در هر FINISH) |
| 3 — Engine | ✅ | `engine.js` (دور ۱ independent، cross-examination از دور ۲، سقف دور، forced finish، محدودسازی parallelism با `MAX_PARALLEL_AGENTS`) |
| 4 — Tool | ✅ | `agent/tools/discussion.js` + ثبت در `tools.json`/`tool_groups.json` (گروه `discussion`)؛ مدل‌ها از طریق `callAI` ران‌تایم (نقش‌های L1/L2/MAIN) |
| 5 — CLI | ✅ | `node bin/agent.js --discussion --personas ... --max-rounds N` (با `--json` برای خروجی کامل) |
| 6 — Web | ✅ | `POST /api/discussion` + `GET /api/discussion/personas` در `web/server.js`، رویدادهای SSE از `discussion:start` تا `discussion:finish`، پنل «Discussion» در `web/public` |
| 7 — LoopDetector | ✅ | `loopDetector.js` (شبیه‌سازی جاکارد برای تکرار + unaddressed concerns) |
| 8 — Evaluation | ✅ | `test/discussion.test.js` (۲۳ تست با mock LLM، شامل task نمونه JWT) + تست‌های اندپوینت در `test/web.test.js` |

نکته‌های طراحی که در اجرا اضافه شدند:
* `callAI` از `agent.js` export شد تا discussion از همان لایهٔ endpoint/role/retry ران‌تایم استفاده کند.
* پرسوناهای discussion در کاتالوگ‌های prompt (available_agents / available_personas) **نشان داده نمی‌شوند** — آن‌ها هدف delegation نیستند و از `discussion_start` قابل دسترسی‌اند؛ این کار سقف بودجهٔ prompt ثابت را نگه می‌دارد.
* ابزار در نبود اندپوینت با خطای صریح شکست می‌خورد و هرگز پاسخ mock جایگزین واقعی نمی‌دهد (mock فقط با flag داخلی برای تست).
* Observer تنها خروجی کاربر را می‌سازد؛ هر FINISH بدون گزارش معتبر، گزارش بازیابی‌شده دریافت می‌کند.

## 1. خلاصه اسپک

- کاربر یک task + لیست persona های منتخب (از 15 تا) را می‌دهد.
- **Round 1**: هر persona مستقل و بدون دیدن دیگران نظر می‌دهد.
- **Round 2+**: هر persona پیام‌های دور قبل همه را می‌بیند و باید explicitly agree/disagree/refine کند. تکرار بدون addressing ممنوع.
- **Observer** بعد از هر round تصمیم می‌گیرد CONTINUE یا FINISH. اگر CONTINUE، خلاصه وضعیت + instruction هدفمند برای هر agent می‌دهد. اگر FINISH، گزارش نهایی structured برای کاربر تولید می‌کند.
- **Hard stop**: max rounds (مثلاً 5) و تشخیص تکرار.

موفقیت:
- هر contribution قابل trace به لنز domain
- اختلاف‌ها explicit
- جلوگیری از loop بی‌نهایت
- خروجی نهایی actionable synthesis نه transcript dump

## 2. تناظر با معماری فعلی structured-ai

runtime فعلی already دارد:

| نیاز اسپک | معادل فعلی |
|---|---|
| Hierarchical agents با persona, skills, tools | `agent/registry/personas.json` + `agents.json` + `agent.js` delegation |
| Policy engine برای tool access | `lib/policy.js` |
| Parallel execution + dependency graph | `executeDependencyGraph` + waves |
| Event bus, journal, session | `lib/events.js`, `eventstore`, `sessions` |
| LLM endpoint abstraction با role-based models | `endpointFor(role)` و ROLES MAIN/L1/L2/L3/SUMMARY |
| MCP tools | `mcp/` |

**تفاوت کلیدی**: اسپک یک **discussion loop** می‌خواهد نه delegation tree. در delegation فعلی، parent یک task را می‌دهد و child جواب final می‌دهد و تمام. اینجا چند agent هم‌سطح باید چند round با هم صحبت کنند و observer مدیریت کند. پس نیاز به یک orchestrator جدید داریم که reuse کند همین primitives را ولی flow متفاوت.

## 3. معماری پیشنهادی

```
User Task + selected personas
          |
          v
  DiscussionManager (new)
    |-- RoundController
    |     |-- PersonaRunner (parallel calls to LLM with persona prompt)
    |     |-- TranscriptStore
    |
    |-- ObserverRunner (LLM call with observer prompt)
    |     |-- Decision: CONTINUE / FINISH
    |
    |-- LoopDetector (embedding similarity یا ساده: hash + LLM check)
    |
          v
  FinalReport -> User
```

### 3.1 ماژول‌های جدید

```
structured-ai/agent/discussion/
├── personas.js          # 15 persona definition + observer prompt (از اسپک)
├── types.js             # Type definitions: Message, Round, Decision, Report
├── transcript.js        # Transcript management, round isolation
├── personaRunner.js     # اجرای یک persona برای یک round
├── observerRunner.js    # اجرای observer
├── loopDetector.js      # تشخیص تکرار / عدم پیشرفت
├── engine.js            # DiscussionEngine اصلی
└── index.js             # export
```

### 3.2 ابزار جدید

```
structured-ai/agent/tools/discussion.js
  -> discussion_start (tool)
  -> discussion_continue (internal)
```

این tool به main_agent اجازه می‌دهد وقتی کاربر درخواست بحث چندجانبه کرد، discussion را start کند.

### 3.3 رجیستری

- اضافه کردن 15 persona جدید به `agent/registry/personas.json` با system_prompt های دقیق اسپک
- اضافه کردن 15 agent profile به `agents.json` با tools mapping طبق اسپک
- observer هم persona + agent

Tools mapping پیشنهادی (بر اساس اسپک + ابزارهای موجود):

| Persona | Tools |
|---|---|
| security | fs_read, fs_read_many, search_start, code_config_usage, code_dependencies, net_fetch (برای CVE) |
| backend | fs_read, fs_write, fs_edit, fs_list, terminal_exec, code_find_symbol, code_dependencies |
| database | fs_read, code_search, terminal_exec (برای DB MCP آینده), code_file_summary |
| frontend | fs_read, fs_write, fs_edit, terminal_exec, code_find_symbol |
| architect | fs_read, fs_tree, fs_list, code_dependencies, code_impact |
| performance | fs_read, code_search, terminal_exec |
| qa | fs_read, fs_write, terminal_exec, code_find_tests |
| devops | fs_read, terminal_exec, fs_list |
| cost | fs_read, net_fetch |
| accessibility | fs_read, net_fetch |
| data | fs_read, code_search |
| compliance | fs_read, net_fetch |
| mobile | fs_read |
| ml_ai | fs_read, net_fetch, terminal_exec |
| legacy | fs_read, git_log, git_diff, git_status |
| observer | هیچ (فقط transcript read) |

### 3.4 مدل داده

```js
// Round
{
  round: 1,
  messages: [
    { persona: "security", content: "...", timestamp, tools_used: [] }
  ]
}

// ObserverDecision
{
  decision: "CONTINUE" | "FINISH",
  agreements: ["..."],
  open_points: [
    { topic: "auth storage", disagreeing: ["security vs frontend"], reasons: "..." }
  ],
  unaddressed: ["backend didn't address security concern X"],
  instructions: {
    security: "به پیشنهاد backend درباره JWT در localStorage واکنش بده...",
    backend: "پیشنهاد API shape جایگزین برای frontend بده..."
  },
  final_report: { // فقط اگر FINISH
    summary: "one paragraph",
    agreed_points: [],
    unresolved: [{ topic, sides: [{persona, reasoning}] }],
    next_steps: [{ order, layer, action }]
  }
}
```

## 4. پروتکل اجرا - جزئیات

### Round 1 - Independent

برای هر persona انتخاب‌شده:

```js
async function runIndependentPersona(task, personaDef, workspaceContext) {
  const messages = [
    { role: "system", content: personaDef.system_prompt },
    { role: "system", content: `Task: ${task}\nWorkspace: ${workspaceContext}\nRound: 1 - You must NOT see other personas. Provide assessment, recommended approach, key risks.` },
    { role: "user", content: task }
  ];
  // call LLM via endpointFor(personaRole)
  // tools allowed per persona if needed
}
```

نکته: باید **parallel** اجرا شود: `Promise.all(personas.map(...))` ولی با `MAX_PARALLEL_AGENTS` limit فعلی.

### Round 2+ - Cross-examination

```js
function buildCrossExamPrompt(task, allPriorMessages, currentPersona, observerInstructions) {
  return `
Task: ${task}

Prior discussion transcript:
${formatTranscript(allPriorMessages)}

Observer instruction for you specifically:
${observerInstructions[currentPersona] || "React to others' points"}

Rules:
- You MUST explicitly agree/disagree/refine.
- Restating unchanged opinion without addressing others is NOT acceptable.
- Keep focused on your lens: ${currentPersona lens}.
`;
}
```

### Observer review

Observer prompt از اسپک + addition:

```
You are Observer...
After each round...
Input: full transcript + round number + max rounds
Output JSON:
{
  "decision": "CONTINUE" | "FINISH",
  "agreements": [...],
  "open_points": [...],
  "unaddressed": [...],
  "instructions": { persona: "specific instruction" },
  "final_report": { ... } // if FINISH
}
```

Observer باید structured output برگرداند. می‌توان از `response_format.json` استفاده کرد.

### Loop detection

دو لایه:

1. **Hard stop**: `if round >= maxRounds => FINISH`
2. **Repetition detection**:
   - ساده: embedding similarity بین پیام‌های یک persona در دو round متوالی (اگر >0.95 و observer instruction را address نکرده => تکرار)
   - یا از observer بخواهیم خودش تشخیص دهد: "Are agents restating same points?" — این در prompt observer می‌آید.
   - همچنین می‌توان hash ساده + LLM check کرد.

### Final Report ساختار

طبق اسپک:

- one-paragraph summary
- agreed points list
- unresolved disagreements explicit با reasoning هر طرف
- actionable next steps ordered by layer

## 5. پیاده‌سازی در runtime فعلی

### گام 0: رجیستری

```bash
# اضافه کردن personas
cat agent/registry/personas.json | jq '. += [newPersonas]'
# اضافه کردن agents
cat agent/registry/agents.json | jq '. += [newAgents]'
```

### گام 1: Discussion Engine Core (pure JS, بدون وابستگی به LLM برای تست)

```js
// agent/discussion/engine.js
class DiscussionEngine {
  constructor({ task, personas, maxRounds = 5, llmCaller, workspaceContext }) {}
  async run() {
    let rounds = [];
    // Round 1 independent
    let current = await this.runRound(1, null, true);
    rounds.push(current);
    for (let r=2; r<=maxRounds; r++) {
      const observerDecision = await this.observer.review(rounds);
      if (observerDecision.decision === "FINISH") return observerDecision.final_report;
      const next = await this.runRound(r, observerDecision.instructions, false);
      rounds.push(next);
      // check loop
      if (this.loopDetector.isStuck(rounds)) {
        return this.observer.forceFinish(rounds);
      }
    }
    return this.observer.forceFinish(rounds);
  }
}
```

`llmCaller` می‌تواند `callAI` فعلی یا `endpointFor` را reuse کند.

### گام 2: PersonaRunner

```js
async function runPersona({ personaDef, task, transcript, isFirstRound, instruction, tools }) {
  const systemPrompt = personaDef.system_prompt;
  const userPrompt = isFirstRound 
    ? buildFirstRoundPrompt(task)
    : buildCrossExamPrompt(task, transcript, instruction);
  
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  // اگر persona tool دارد، از tool graph موجود استفاده کن
  // ولی طبق اسپک بیشتر reasoning است تا tool execution
  const response = await llmCall(messages, personaDef);
  return { persona: personaDef.name, content: response.content };
}
```

### گام 3: اتصال به main agent به عنوان tool

```js
// agent/tools/discussion.js
module.exports = {
  discussion_start: {
    description: "Start a multi-agent discussion with selected specialist personas",
    parameters: { task, personas: array, max_rounds },
    execute: async ({ task, personas, max_rounds }, context) => {
      const engine = new DiscussionEngine({ task, personas, max_rounds });
      const report = await engine.run();
      return report;
    }
  }
}
```

### گام 4: CLI mode

```js
// bin/agent.js
if (args.discussion) {
  const engine = require('../agent/discussion').DiscussionEngine;
  // parse --personas security,backend,database
  // run engine
}
```

### گام 5: Web Console

اضافه کردن endpoint در `web/server.js`:

```
POST /api/discussion
body: { task, personas, max_rounds }
-> SSE stream of rounds + observer decisions
-> final report
```

Frontend: یک پنل جدید "Discussion" که rounds را live نشان دهد.

## 6. چالش‌ها و راه‌حل‌ها

| چالش | راه‌حل |
|---|---|
| Cost: هر round = N persona LLM calls + 1 observer = مثلاً 5*4+4=24 calls | از مدل‌های کوچکتر برای personas استفاده کن (ENDPOINT_L1/L2), observer از مدل قوی‌تر |
| Isolation Round 1: مدل نباید دیگران را ببیند | هر persona را با messages جدا call کن، transcript را فقط از round 2 به بعد inject کن |
| Tool usage: اسپک می‌گوید هر persona باید tools داشته باشد | برای MVP فقط fs_read و search را بده، بعداً MCP ها (vuln scanner, DB MCP) را اضافه کن |
| Observer bias: نباید opinion خودش را inject کند | system prompt observer را دقیقاً از اسپک بگیر و temperature=0 |
| Repetition detection | observer prompt بگو "Never let discussion continue only because agents are being polite" + ساده hash check |
| Final report فقط چیزی که user می‌بیند | Observer تنها کسی است که به user output می‌دهد، بقیه transcript internal |

## 7. مراحل پیاده‌سازی پیشنهادی (order)

1. **Phase 0 - Registry**: اضافه کردن 15 persona + observer به `personas.json` و `agents.json` (بدون کد)
2. **Phase 1 - Types & Transcript**: `types.js`, `transcript.js` با تست unit
3. **Phase 2 - PersonaRunner & ObserverRunner**: wrapper دور `callAI` فعلی، با mock LLM برای تست
4. **Phase 3 - Engine**: DiscussionEngine با loop, max rounds, observer decision parsing
5. **Phase 4 - Tool**: `discussion_start` tool که main_agent می‌تواند صدا بزند
6. **Phase 5 - CLI**: `bin/agent.js --discussion` flag
7. **Phase 6 - Web**: `/api/discussion` + SSE + UI panel
8. **Phase 7 - LoopDetector پیشرفته**: similarity check + observer forced finish
9. **Phase 8 - Evaluation**: تست با task نمونه مثلاً "design auth system" و بررسی اینکه trade-offs واقعاً surface می‌شود

## 8. نمونه task برای تست

```
Task: "Design a user session storage for a Next.js app with JWT"

Expected:
- Security: flag localStorage XSS, recommend httpOnly cookie
- Frontend: flag httpOnly can't be read by JS, propose shape
- Backend: propose endpoint /api/session, error handling
- Performance: flag JWT size, propose caching
- Observer: باید disagreement بین Security vs Frontend را explicit flag کند
```

## 9. تخمین

- Registry + Types: 0.5 روز
- Engine + Runners: 2 روز
- Tool + CLI: 0.5 روز
- Web + SSE: 1 روز
- Tests + polish: 1 روز
جمع: ~5 روز برای MVP

## 10. نتیجه

این سیستم روی runtime فعلی کاملاً قابل پیاده‌سازی است چون:

- ما already persona system داریم
- parallel tool execution و delegation graph داریم
- event bus برای streaming rounds داریم
- LLM endpoint abstraction داریم

تنها چیز جدید **orchestration loop** متفاوت است که باید به عنوان یک ماژول جدا نوشته شود و از primitives موجود استفاده کند، نه اینکه delegation فعلی را hack کند.
