# پلتفرم ران‌تایم ایجنت‌های سلسله‌مراتبی (Structured AI)
## Hierarchical Multi-Agent Runtime, Deterministic Execution & Autonomous Code Intelligence

پروژهٔ **`structured-ai`** یک فریم‌ورک و ران‌تایم چند‌ایجنت سلسله‌مراتبی (Hierarchical Multi-Agent) برای هدایت مدل‌های زبانی بزرگ (LLMs) بر پایهٔ قراردادهای اکشن ساختاریافته (Structured Action Contract) و اندپوینت‌های استاندارد سازگار با OpenAI (`/chat/completions`) است.

در این سیستم، مدل هوش مصنوعی تصمیم‌گیرندهٔ محض نیست؛ بلکه در هر تکرار، مدل دقیقاً یک اکشن استاندارد (`tool_call`، `delegate` یا `final`) برمی‌گرداند و **ران‌تایم سیستم**، زمان‌بندی موازی، تفویض وظایف (Delegation)، کنترل مرزهای امنیتی، اعمال پالیسی‌ها و تأییدیه‌ها را مدیریت می‌کند.

---

## فهرست مطالب
1. [معرفی و منشور معماری سیستم](#۱-معرفی-و-منشور-معماری-سیستم)
2. [معماری کلان و ساختار دایرکتوری‌ها](#۲-معماری-کلان-و-ساختار-دایرکتوریها)
3. [پیش‌نیازها و راه‌اندازی سریع](#۳-پیش‌نیازها-و-راه‌اندازی-سریع)
4. [حالت‌های سه‌گانهٔ استفاده (Usage Modes)](#۴-حالت‌های-سهگانه-استفاده-usage-modes)
5. [جدول کامل پیکربندی و متغیرهای محیطی](#۵-جدول-کامل-پیکربندی-و-متغیرهای-محیطی)
6. [مستندات کامل اندپوینت‌های سرور وب کنسول (Web Server & REST / SSE API)](#۶-مستندات-کامل-اندپوینتهای-سرور-وب-کنسول-web-server--rest--sse-api)
7. [کاتالوگ کامل ابزارها و گروه‌ها (Tools & Tool Groups)](#۷-کاتالوگ-کامل-ابزارها-و-گروهها-tools--tool-groups)
8. [خط‌لولهٔ امنیتی، پالیسی و گاردها (Security & Policy Engine)](#۸-خط‌لوله-امنیتی-پالیسی-و-گاردها-security--policy-engine)
9. [مدیریت بودجهٔ کانتکست و حافظه (Context Budget & Compaction)](#۹-مدیریت-بودجه-کانتکست-و-حافظه-context-budget--compaction)
10. [لایهٔ اتصال به MCP و پروتکل‌های چهارگانه](#۱۰-لایهٔ-اتصال-به-mcp-و-پروتکلهای-چهارگانه)
11. [آزمون‌ها و ارزیابی کیفیت](#۱۱-آزمونها-و-ارزیابی-کیفیت)

---

## ۱. معرفی و منشور معماری سیستم

### ۱.۱ قرارداد اکشن ساختاریافته (Structured Action Contract)
در هر مرحله از اجرای تسک، مدل ملزم به ارسال یک ساختار JSON معتبر است که شامل یکی از موارد زیر است:
- **`tool_call`:** فراخوانی یک یا چند ابزار به صورت موازی (Parallel) یا دارای گراف وابستگی (`depends_on`).
- **`delegate`:** تفویض کار به یک Sub-Agent تخصصی با Persona و ابزارهای ایزوله.
- **`final`:** پایان موفق یا اعلام نیاز به اطلاعات تکمیلی.

### ۱.۲ انزوای کامل و زمان‌بندی موجی (Execution Waves)
ران‌تایم فرامین ارسال‌شده را به صورت خودکار به **امواج اجرایی (Execution Waves)** تقسیم می‌کند؛ ابزارهای مستقل به صورت همزمان (Concurrency کنترل‌شده) و ابزارهای وابسته پس از اتمام گام قبلی اجرا می‌شوند.

### ۱.۳ مهار مرزها و پیشگیری از توهم مدل
- **Workspace Confinement:** تمام مسیرهای فایلی به دایرکتوری ورک‌اسپیس محدود بوده و لینک‌های نمادین (Symlinks) خروج از مرز را مسدود می‌کنند.
- **Output Capping:** خروجی ابزارها پیش از ارسال به مدل برش داده می‌شود تا بودجهٔ توکن Context Window بهینه‌سازی شود.

---

## ۲. معماری کلان و ساختار دایرکتوری‌ها

```text
repository-root/
├── bin/                         # agent، interactive و backfill entrypoints
├── agent/
│   ├── agent.js                # public application entrypoint and bindings
│   ├── actions/                # action parsing, repair and validation
│   ├── application/            # run/session lifecycle
│   ├── cli/                    # argument parsing and command dispatch
│   ├── config/                 # SettingsSchema، SettingsStore، secrets
│   ├── context/                # context budget، workspace boundary، memory
│   ├── discussion/             # discussion engine، service و transcripts
│   ├── events/                 # event bus، validation، projection، redaction
│   ├── hooks/                  # hook loading، conditions، rendering، runner
│   ├── host/                   # factoryهای composition root که agent.js به ترتیب صدا می‌زند
│   ├── interactive/            # REPL input/output و approval prompt
│   ├── mcp/                    # manager، connection، config، protocol و transports
│   ├── persistence/            # atomic JSON، JSONL، repositories و data roots
│   ├── policy/                 # policy matching، approval و errors
│   ├── projects/               # registry، context، migration و workspace profile
│   ├── prompt/                 # main/sub-agent/runtime/request builders
│   ├── registry/               # JSON registries و split tool schemas
│   ├── runtime/                # RunManager، engine، scheduler و telemetry
│   └── tools/                  # ToolRuntime و گروه‌های filesystem/process/
│                                 # planning/memory/git/network/search/skills/mcp
├── web/
│   ├── server.js               # canonical WebServer entrypoint
│   ├── server/                 # router، middleware، controllers، services
│   │   ├── routes/             # گروه‌های مسیر API که handler به ترتیب صدا می‌زند
│   │   └── console/            # state و helperهای سرور کنسول (factory)
│   └── public/                 # app/ native browser modules
├── test/                       # domain-based unit, contract و e2e suites
```

در rollout نهایی Phase 30 هیچ facade انتخاب‌کننده‌ای برای حالت legacy وجود
ندارد. `agent/config`، `agent/persistence`، `agent/mcp`، `agent/tools` و
`web/server` مسیرهای canonical هستند. ریشهٔ `.agent/` فقط به‌عنوان data layout
سازگار برای synthetic default خوانده می‌شود؛ این موضوع با نگه‌داشتن کد legacy
یا flag اجرایی تفاوت دارد.

## ۳. پیش‌نیازها و راه‌اندازی سریع

### پیش‌نیازها
* **Node.js:** نسخهٔ `>= 18.0.0`
* **مدل زبانی سازگار با OpenAI:** یک اندپوینت فعال مانند Local vLLM, Ollama, OpenRouter, OpenAI یا LMStudio.

### تنظیم متغیرهای اولیه
```bash
# تنظیم اندپوینت و کلید دسترسی مدل
export AGENT_BASE_URL=http://localhost:11434/v1
export AGENT_API_KEY=your-api-key
export AGENT_MODEL=qwen2.5-coder:32b
# Optional: HTTP proxy or SOCKS5 (supports socks5h for proxy-side DNS)
export AGENT_PROXY_URL=socks5h://proxy.example:1080
```

یا فقط برای یک اجرای CLI:

```bash
node bin/agent.js --proxy-url http://proxy.example:3128 -w /path/to/project "..."
```

از کنسول وب هم `AGENT_PROXY_URL` را در تنظیمات Endpoint تغییر دهید؛ مقدار جدید
از درخواست بعدی استفاده می‌شود. نشانی پراکسی secret است و مقدار کامل آن در UI
نمایش داده نمی‌شود.

### اجرای تست‌های ران‌تایم
```bash
npm test
```

---

## ۴. حالت‌های سه‌گانهٔ استفاده (Usage Modes)

---

### حالت ۱: اجرای تک‌تسک در ترمینال (Headless CLI)
مناسب برای خط‌لوله‌های CI/CD، اسکریپت‌ها و دستورات سریع:

```bash
# اجرای یک تسک مشخص روی ورک‌اسپیس
node bin/agent.js -w /path/to/project "بررسی کن چرا تست لاگین شکست می‌خورد و اصلاحش کن"

# اجرای خروجی ساختاریافته فقط در قالب JSON
node bin/agent.js -w /path/to/project --json "لیست تمامی کنترلرهای موجود"
```

---

### حالت ۲: نشست تعاملی در ترمینال (Interactive REPL)
مناسب برای کار پیوسته با امکان پرسش و پاسخ دنباله‌دار با حفظ کانتکست و پاسخ به درخواست‌های تأیید (Approval Prompt):

```bash
node bin/agent.js -i -w /path/to/project
```

دستورات داخلی در محیط تعاملی:
* `/help` — مشاهده لیست فرامین
* `/clear` — شروع یک مکالمه جدید با حفظ تنظیمات
* `/history` — مشاهده تاریخچه پیام‌ها
* `/approve` — تغییر حالت تأییدیه به `auto`، `prompt` یا `deny`
* `/tools` — مشاهده ابزارهای فعال
* `/save` — ذخیره آخرین پاسخ در یک فایل

---

### حالت ۳: کنسول وب و داشبورد زنده (Web Console)
راه‌اندازی سرور کنسول وب با رابط کاربری تعاملی، استریم زندهٔ گراف اجرای ایجنت‌ها، مانیتورینگ رویدادها و پنل تأییدیه:

```bash
node bin/agent.js --serve 7777 -w /path/to/project
```

سپس در مرورگر به آدرس `http://localhost:7777` مراجعه کنید. برای اجرای خودکار
وب در محیط‌هایی مثل Docker یا سرویس‌های میزبانی، کافی است `PORT` را تنظیم کنید؛
اگر command task یا حالت دیگری نداده باشید، CLI بدون `--serve` سرور را روی
`0.0.0.0:$PORT` بالا می‌آورد:

```bash
PORT=8080 npm start
```

`--serve <port>` صریح بر `PORT` اولویت دارد؛ در حالت خودکار پیش‌فرض bind روی
`0.0.0.0` است تا سرویس از بیرون container قابل دسترسی باشد.

**ساختار پنل وب (بدون build):** پنل با ماژول‌های ES بومی مرورگر اجرا می‌شود و
هیچ مرحلهٔ build ندارد. Preact 10، htm و `@preact/signals-core` به‌صورت فایل در
`web/public/vendor/` قرار دارند (نسخه و sha256 در `manifest.json`). state در
`web/public/app/store.js` نگه داشته می‌شود و هر view فقط ناحیه‌هایی از store را که
می‌خواند دوباره رسم می‌کند؛ reducerها (`runtime-state.js`، `*-model.js`) خالص‌اند
و viewها (`*-view.js`، `chat.js`) هیچ‌گاه HTML رشته‌ای نمی‌سازند. درخواست‌ها و
جریان رویدادها در کنترلرهای جدا برای هر بخش هستند (`*-controller.js`،
`project-*.js`) و `console.js` فقط کنترل‌های صفحه را به آن‌ها وصل می‌کند. تست‌های UI روی happy-dom با
`index.html` واقعی اجرا می‌شوند: `npm run test:ui`.

---

### حالت ۴: بحث چندجانبه با پرسوناهای متخصص (Multi-Agent Discussion)
به‌جای درخت واکل، تعدادی پرسونای هم‌سطح (از ۱۵ پرسونای موجود) یک تسک را در چند دور با هم بحث می‌کنند: در دور ۱ هر پرسونا بدون دیدن بقیه نظر می‌دهد؛ از دور ۲ به بعد همه پیام‌های قبلی را می‌بینند و باید صریحاً موافق/مخالف/بهبوددهنده باشند. یک **Observer** (همیشه فعال، غیرقابل انتخاب) بعد از هر دور تصمیم می‌گیرد بحث ادامه یابد یا تمام شود؛ در صورت ادامه، دستورالعمل هدفمند برای هر ایجنت جداگانه می‌دهد. توقف اجباری با سقف دورها و تشخیص تکرار انجام می‌شود.

```bash
# اجرای بحث در ترمینال
node bin/agent.js -w /path/to/project --discussion \
  --personas security,backend,frontend,architect,performance,qa \
  --max-rounds 5 "طراحی ذخیره‌سازی نشست کاربر با JWT در اپلیکیشن Next.js"

# خروجی JSON کامل (شامل رونوشت دورها و تصمیمات Observer)
node bin/agent.js -w /path/to/project --discussion --personas security,frontend --json "..."
```

همچنین:
* **ابزار `discussion_start`** — ایجنت اصلی هرگاه کاربر تحلیل چندبُعدی بخواهد، خودش بحث را از داخل اجرای عادی شروع می‌کند.
* **کنسول وب** — دکمهٔ «Discussion» در هدر: انتخاب تسک، پرسوناها و سقف دورها، مشاهدهٔ زندهٔ دورها و پیام‌ها از طریق SSE، و در نهایت گزارش ساختاریافته (خلاصه، نقاط توافقی، اختلاف‌نظرهای باز با استدلال هر طرف، و گام‌های بعدی مرتب‌شده).

پرسونای موجود: `security, backend, database, frontend, architect, performance, qa, devops, cost, accessibility, data, compliance, mobile, ml, legacy` — تعریف کامل آن‌ها در `agent/discussion/personas.js` و نقشه‌راه پیاده‌سازی در `DISCUSSION_SYSTEM_IMPLEMENTATION.md` در ریشهٔ مخزن.

---

## ۵. جدول کامل پیکربندی و متغیرهای محیطی

تنظیمات runtime زیر در `agent/config/SettingsSchema.js` تعریف شده‌اند و همگی از environment با همان نام خوانده می‌شوند. precedence در حالت runtime این است: مقدار تغییر‌یافته در حافظه، سپس environment، سپس پیش‌فرض schema. موارد `fixed` فقط هنگام راه‌اندازی قابل تنظیم‌اند؛ مقدارهای `secret` در UI و log ماسک می‌شوند.

**رمز ورود پنل وب:** برای فعال‌کردن درخواست رمز، هر دو متغیر زیر را پیش از راه‌اندازی تنظیم کنید؛ فلگ به‌تنهایی کافی نیست:

```bash
AGENT_CONSOLE_PASSWORD_REQUIRED=true
AGENT_CONSOLE_PASSWORD='choose-a-long-password'
```

| متغیر محیطی | نوع | مقدار پیش‌فرض | توضیح |
|---|---|---|---|
| `AGENT_BASE_URL` | string | `"http://localhost:4414/p/smart_routing/v1"` | Base URL of the OpenAI compatible endpoint. |
| `AGENT_API_KEY` | string · secret | `"your-api-key"` | Bearer token sent with every request. |
| `AGENT_PROXY_URL` | string · secret | `""` | Optional outbound proxy for all LLM provider requests. Supports http://, socks5:// and socks5h://. Changes apply to the next request. |
| `AGENT_MODEL` | string | `"auto-switch"` | Model requested when a profile does not name one. |
| `AGENT_CONSOLE_TOKEN` | string · secret | `""` | Bearer token for the web console control plane. Empty generates a token at startup. |
| `AGENT_CONSOLE_TOKENS` | string · secret | `""` | JSON map of extra console tokens to { allowedProjects, permissions } (Phase 9). The AGENT_CONSOLE_TOKEN itself remains a master token. |
| `AGENT_CONSOLE_PASSWORD_REQUIRED` | boolean · fixed at startup | `false` | Require a password login before the web console UI is loaded. Configure AGENT_CONSOLE_PASSWORD and restart to change this. |
| `AGENT_CONSOLE_PASSWORD` | string · secret, fixed at startup | `""` | Password used by the web console login when AGENT_CONSOLE_PASSWORD_REQUIRED=true. Set through the environment and restart to change it. |
| `AGENT_TEMPERATURE` | number | `0.2` | Sampling temperature used when a profile does not set one. |
| `RESPONSE_FORMAT_MODE` | enum | `"auto"` | Whether to send response_format. auto stops sending it to an endpoint that rejected it, always keeps sending it, never leaves it out from the start. |
| `AGENT_SCHEMA` | enum · fixed at startup | `"default"` | Which response schema file to send. Read once at startup. |
| `AGENT_PROVIDER` | enum | `"openai-compatible"` | Which LLM API the endpoint speaks (roadmap P1-1). openai-compatible keeps AGENT_BASE_URL as is; for any other provider AGENT_BASE_URL is used only when set, otherwise the vendor endpoint applies. |
| `AGENT_PROVIDER_REGION` | string | `"us-east-1"` | AWS region of the bedrock provider (bedrock-runtime.<region>.amazonaws.com). |
| `AZURE_OPENAI_API_VERSION` | string | `"2024-10-21"` | api-version sent to Azure OpenAI deployments. Not used with a /openai/v1 base URL. |
| `BEDROCK_ACCESS_KEY_ID` | string · secret | `""` | IAM access key id for the bedrock provider (SigV4). Not needed with a Bedrock API key in AGENT_API_KEY. |
| `BEDROCK_SECRET_ACCESS_KEY` | string · secret | `""` | IAM secret access key for the bedrock provider (SigV4). |
| `BEDROCK_SESSION_TOKEN` | string · secret | `""` | Session token for temporary IAM credentials of the bedrock provider. |
| `PROMPT_CACHING` | boolean | `true` | Mark the stable prompt prefix (system prompt, tool list) for caching where the provider needs it marked (Anthropic, Bedrock). OpenAI and Gemini cache automatically. |
| `PROVIDER_ROLES` | string · secret | `""` | JSON map of role (planner, coder, observer, ...) to a provider spec {provider, model, baseUrl, apiKey, fallbacks} or "provider:model". Empty uses the primary endpoint for every role. |
| `PROVIDER_FALLBACKS` | string · secret | `""` | JSON list of provider specs tried in order when the primary still fails after MAX_REQUEST_RETRIES. An entry for another provider must name its own model and key. |
| `ENDPOINT_MAIN_BASE_URL` | string | `""` | Base URL for the root orchestrator. Empty inherits AGENT_BASE_URL. |
| `ENDPOINT_MAIN_API_KEY` | string · secret | `""` | API key for the root orchestrator. Empty inherits AGENT_API_KEY. |
| `ENDPOINT_MAIN_MODEL` | string | `""` | Model for the root orchestrator. Empty inherits the profile's model, then AGENT_MODEL. |
| `ENDPOINT_MAIN_CONTEXT_TOKENS` | number | `0` | Configured token context window for the main endpoint model; 0 inherits CONTEXT_WINDOW_TOKENS. |
| `ENDPOINT_MAIN_TEMPERATURE` | number | `-1` | Temperature for the root orchestrator. Minus one inherits the profile's value, then AGENT_TEMPERATURE. |
| `ENDPOINT_L1_BASE_URL` | string | `""` | Base URL for sub-agents at depth 1. Empty inherits AGENT_BASE_URL. |
| `ENDPOINT_L1_API_KEY` | string · secret | `""` | API key for sub-agents at depth 1. Empty inherits AGENT_API_KEY. |
| `ENDPOINT_L1_MODEL` | string | `""` | Model for sub-agents at depth 1. Empty inherits the profile's model, then AGENT_MODEL. |
| `ENDPOINT_L1_CONTEXT_TOKENS` | number | `0` | Configured token context window for the l1 endpoint model; 0 inherits CONTEXT_WINDOW_TOKENS. |
| `ENDPOINT_L1_TEMPERATURE` | number | `-1` | Temperature for sub-agents at depth 1. Minus one inherits the profile's value, then AGENT_TEMPERATURE. |
| `ENDPOINT_L2_BASE_URL` | string | `""` | Base URL for sub-agents at depth 2. Empty inherits AGENT_BASE_URL. |
| `ENDPOINT_L2_API_KEY` | string · secret | `""` | API key for sub-agents at depth 2. Empty inherits AGENT_API_KEY. |
| `ENDPOINT_L2_MODEL` | string | `""` | Model for sub-agents at depth 2. Empty inherits the profile's model, then AGENT_MODEL. |
| `ENDPOINT_L2_CONTEXT_TOKENS` | number | `0` | Configured token context window for the l2 endpoint model; 0 inherits CONTEXT_WINDOW_TOKENS. |
| `ENDPOINT_L2_TEMPERATURE` | number | `-1` | Temperature for sub-agents at depth 2. Minus one inherits the profile's value, then AGENT_TEMPERATURE. |
| `ENDPOINT_L3_BASE_URL` | string | `""` | Base URL for sub-agents at depth 3 and deeper. Empty inherits AGENT_BASE_URL. |
| `ENDPOINT_L3_API_KEY` | string · secret | `""` | API key for sub-agents at depth 3 and deeper. Empty inherits AGENT_API_KEY. |
| `ENDPOINT_L3_MODEL` | string | `""` | Model for sub-agents at depth 3 and deeper. Empty inherits the profile's model, then AGENT_MODEL. |
| `ENDPOINT_L3_CONTEXT_TOKENS` | number | `0` | Configured token context window for the l3 endpoint model; 0 inherits CONTEXT_WINDOW_TOKENS. |
| `ENDPOINT_L3_TEMPERATURE` | number | `-1` | Temperature for sub-agents at depth 3 and deeper. Minus one inherits the profile's value, then AGENT_TEMPERATURE. |
| `ENDPOINT_SUMMARY_BASE_URL` | string | `""` | Base URL for the context summariser. Empty inherits AGENT_BASE_URL. |
| `ENDPOINT_SUMMARY_API_KEY` | string · secret | `""` | API key for the context summariser. Empty inherits AGENT_API_KEY. |
| `ENDPOINT_SUMMARY_MODEL` | string | `""` | Model for the context summariser. Empty inherits the profile's model, then AGENT_MODEL. |
| `ENDPOINT_SUMMARY_CONTEXT_TOKENS` | number | `0` | Configured token context window for the summary endpoint model; 0 inherits CONTEXT_WINDOW_TOKENS. |
| `ENDPOINT_SUMMARY_TEMPERATURE` | number | `-1` | Temperature for the context summariser. Minus one inherits the profile's value, then AGENT_TEMPERATURE. |
| `MAX_ITERATIONS` | number | `50` | Iterations one agent may spend. |
| `MAX_RUN_MS` | number | `600000` | Wall clock budget for a whole run. |
| `MAX_REQUEST_MS` | number | `120000` | Timeout for a single model request. |
| `MAX_REQUEST_RETRIES` | number | `3` | Retries after a transient endpoint failure. |
| `RETRY_BASE_MS` | number | `500` | Base delay for the retry backoff. |
| `SKILLS_INLINE_FOR_SUBAGENTS` | boolean | `true` | Put a sub-agent's own skills in its prompt in full. Off, it receives the same index the root gets and reads them with skill_get, which is cheaper and one call away from being ignored. |
| `MAX_AGENT_DEPTH` | number | `3` | Hard cap on delegation depth. |
| `MAX_TOTAL_AGENTS` | number | `15` | Sub-agents a single run may spawn. |
| `MAX_PARALLEL_AGENTS` | number | `4` | Sub-agents executed at the same time. |
| `MAX_PARALLEL_TOOLS` | number | `8` | Tools executed at the same time. |
| `RUN_WRAPUP_MS` | number | `60000` | Slice of the run budget reserved for finishing. When this much time is left the agent is told to stop exploring and answer with what it has. 0 disables it, and the run simply hits the deadline. |
| `RUN_WRAPUP_FRACTION` | number | `0.15` | Ceiling on the wrap-up slice as a share of the run budget, so a short run is not asked to finish before it starts. |
| `MAX_RESPONSE_TOKENS` | number | `0` | Ceiling sent as max_tokens on every agent request. 0 leaves it out, which lets the endpoint decide. Raise it when the agent writes large files and the answer is cut off. |
| `MAX_CONTEXT_CHARS` | number | `300000` | Size budget for the whole conversation. |
| `CONTEXT_WINDOW_TOKENS` | number | `0` | Configured context-window size of the active model in tokens. 0 disables token-based context compaction; the runtime uses its character budget instead. Token measurement uses the provider-independent estimator and keeps the safety margin below. |
| `CONTEXT_WINDOW_SAFETY_FRACTION` | number | `0.8` | Fraction of CONTEXT_WINDOW_TOKENS available to the conversation, reserving the remainder for response and estimator variance. |
| `KEEP_RECENT_EXCHANGES` | number | `3` | Most recent tool exchanges that are never compressed. |
| `CONTEXT_LIGHT_FRACTION` | number | `0.4` | Share of the transcript, counted from the newest end, compressed only lightly. |
| `CONTEXT_MEDIUM_FRACTION` | number | `0.6` | Share of the transcript compressed moderately. Everything older is compressed hard. |
| `CONTEXT_LIGHT_CHARS` | number | `2000` | Characters kept from a lightly compressed result. |
| `CONTEXT_MEDIUM_CHARS` | number | `500` | Characters kept from a moderately compressed result. |
| `CONTEXT_COMPACT_AT` | number | `0.7` | Share of the context budget that triggers compaction at the start of an iteration. |
| `AUTO_CONTINUE` | boolean | `false` | In the console, start the next cycle automatically while the plan still has open steps. |
| `CONTEXT_SUMMARY` | boolean | `true` | Ask the model to summarise the oldest exchanges instead of reducing them to one line. |
| `CONTEXT_SUMMARY_MAX_TOKENS` | number | `700` | Upper bound on the digest the summariser may write. |
| `CONTEXT_SUMMARY_MS` | number | `30000` | Timeout for a summariser request, so a slow digest cannot eat the run budget. |
| `CONTEXT_SUMMARY_CHARS` | number | `1500` | Size budget for a generated digest of old exchanges. |
| `MEMORY_ENABLED` | boolean | `true` | Fold old exchanges into a structured working memory instead of only trimming them. |
| `FILE_CHECKPOINT_MAX_FILE_BYTES` | number | `5242880` | Maximum existing file size that automatic file checkpoints may capture before a mutation. Larger writes are refused rather than made irreversible. |
| `FILE_CHECKPOINT_MAX_TOTAL_BYTES` | number | `20971520` | Maximum aggregate original-file bytes in a single checkpoint. Mutations exceeding it are refused before any file is changed. |
| `FILE_CHECKPOINT_MAX_FILES` | number | `64` | Maximum files captured in one atomic patch/checkpoint operation. |
| `FILE_CHECKPOINT_RETENTION` | number | `100` | Maximum automatically retained workspace checkpoint records. |
| `MEMORY_PROVENANCE_MAX_ITEMS` | number | `2000` | Maximum per-item memory provenance records retained in the project memory file. |
| `MEMORY_PROVENANCE_MAX_SOURCE_REFS` | number | `100` | Maximum archive/tool-call source references recorded for each newly folded memory item. |
| `MEMORY_CHUNK_CHARS` | number | `6000` | Largest slice of history handed to the summariser at once. Keep it inside the summariser's context window. |
| `MEMORY_MAX_SUMMARY_CALLS` | number | `4` | Maximum model summariser calls in one memory fold. Extra chunks remain retrievable from the archive instead of causing an unbounded request loop. |
| `MEMORY_SUMMARY_PARALLELISM` | number | `4` | Memory chunks summarised concurrently within the per-fold call cap. |
| `MEMORY_MAX_ITEMS` | number | `12` | Entries kept per memory list before the oldest are dropped. |
| `MEMORY_MAX_CHARS` | number | `4000` | Size at which memory is folded back into itself. |
| `ARCHIVE_ENABLED` | boolean | `true` | Keep every folded exchange as a retrievable record on disk instead of only in working memory. |
| `ARCHIVE_BODY_CHARS` | number | `4000` | Largest body stored for one archived event. |
| `ARCHIVE_SUMMARY_CHARS` | number | `240` | Preview kept in the index, so a search can rank without opening a segment. |
| `ARCHIVE_TITLE_CHARS` | number | `160` | Cap on the title and error text of an archived event. |
| `ARCHIVE_MAX_TAGS` | number | `8` | Tags kept per record for keyword retrieval. |
| `ARCHIVE_SEGMENT_RECORDS` | number | `500` | Records per segment file before a new one is started. |
| `ARCHIVE_MAX_RECORDS` | number | `2000` | Index size at which old low value records are rolled up. |
| `ARCHIVE_KEEP_IMPORTANCE` | number | `0.7` | Records at or above this importance are never rolled up. |
| `ARCHIVE_ROLLUP_BATCH` | number | `100` | Extra records merged beyond the overflow, so a roll up buys room for a while. |
| `ARCHIVE_ROLLUP_BODY_CHARS` | number | `20000` | Size of a rolled up body, which summarises many events and so needs more room than a single one. |
| `ARCHIVE_KEEP_MERGED_BODIES` | boolean | `false` | Keep the bodies of records a roll up merged, so they can still be opened by id. Off, because reclaiming them is the point of rolling up. |
| `ARCHIVE_ROLLUP_IDS` | number | `200` | Original record ids a roll up remembers when their bodies are kept. |
| `ARCHIVE_ROLLUP_SAMPLES` | number | `5` | Titles quoted in the summary of a rolled up group. |
| `ARCHIVE_COMPACT_AT` | number | `0.5` | Share of a segment that must still be live before it is left alone; below it, the file is rewritten. |
| `ARCHIVE_SEARCH_LIMIT` | number | `8` | Records returned by one archive search when the caller does not say. |
| `ARCHIVE_WEIGHT_FAILURE` | number | `0.95` | Importance of an event that failed. |
| `ARCHIVE_WEIGHT_DECISION` | number | `0.9` | Importance of a plan change. |
| `ARCHIVE_WEIGHT_MUTATION` | number | `0.8` | Importance of a write, a move, a delete or a commit. |
| `ARCHIVE_WEIGHT_COMMAND` | number | `0.55` | Importance of a command that ran successfully. |
| `ARCHIVE_WEIGHT_INSPECTION` | number | `0.25` | Importance of a read, a listing or a search. |
| `ARCHIVE_WEIGHT_ROLLUP` | number | `0.35` | Importance of a merged group of old events. |
| `ARCHIVE_SCORE_MATCH` | number | `1` | Weight of keyword overlap when ranking archive results. |
| `ARCHIVE_SCORE_IMPORTANCE` | number | `0.5` | Weight of importance when ranking archive results. |
| `ARCHIVE_SCORE_RECENCY` | number | `0.25` | Weight of recency when ranking archive results. |
| `MAX_TOOL_RESULT_CHARS` | number | `20000` | Cap on a single string inside a tool result. |
| `MAX_TOOL_RESULT_TOTAL_CHARS` | number | `40000` | Cap on a whole tool result; lists are shortened to fit. |
| `MAX_EMPTY_FINAL_NUDGES` | number | `1` | Times a final answer with no work is handed back. |
| `DELEGATION_NUDGE_AFTER` | number | `8` | Iterations the root may work alone, while the plan has open steps and the agent budget is untouched, before it is reminded that sub-agents exist. 0 disables the reminder. |
| `MAX_DELEGATION_NUDGES` | number | `2` | How many times one run may be reminded. A reminder that is ignored twice is not worth a third request. |
| `MAX_PLAN_CONTINUATIONS` | number | `8` | Times per run a final answer is refused while the plan has open steps. |
| `MAX_AUTO_CYCLES` | number | `20` | Safety limit for automatic continuation in the console. |
| `MAX_MALFORMED_RESPONSES` | number | `2` | Unreadable model answers handed back for another attempt before the run fails. |
| `MAX_REPEATED_FAILURES` | number | `3` | Identical consecutive failures before the agent is stopped. |
| `AGENT_APPROVAL` | enum | `"prompt"` | How a call that needs approval is answered. The safe default asks an operator. |
| `ALLOW_PRIVATE_NETWORK` | boolean | `false` | Let net_fetch reach loopback and private addresses. |
| `NET_ALLOWED_HOSTS` | string | `""` | Comma separated hosts exempt from the private network check. |
| `MAX_HTTP_RESPONSE_CHARS` | number | `40000` | Characters kept from an HTTP response body. |
| `MAX_HTTP_REDIRECTS` | number | `5` | Redirects followed by net_fetch. |
| `MAX_PROCESS_BUFFER_CHARS` | number | `200000` | Output buffered per background process. |
| `MAX_HASH_BYTES` | number | `52428800` | Largest file fs_info will hash. |
| `WRITE_SHRINK_WARNING` | number | `0.4` | Share of a file an overwrite may remove before the result carries a warning. 1 disables the warning. |
| `SKILL_RESOURCE_CHARS` | number | `8000` | Cap on one slice of a skill resource, so a house style cannot flood the conversation. |
| `WRITE_EDIT_HINT_BYTES` | number | `4000` | Overwriting an existing file larger than this suggests fs_edit instead. 0 turns the suggestion off. |
| `PROCESS_SANDBOX_MODE` | enum | `"deny"` | Process execution mode. deny is fail-closed; bwrap is Linux-only; docker and podman require a running container engine; test is only for the repository test harness. |
| `PROCESS_SANDBOX_IMAGE` | string | `"node:22-bookworm"` | Container image for Docker/Podman process sandboxes. Repository project files cannot override it. |
| `PROCESS_SANDBOX_NETWORK` | enum | `"none"` | Container network mode. none is isolated; bridge grants general egress and must be explicitly selected by the operator. |
| `PROCESS_SANDBOX_CPUS` | number | `2` | Maximum CPU quota for one Docker/Podman sandbox. |
| `PROCESS_SANDBOX_MEMORY_MB` | number | `2048` | Memory limit in MiB for one Docker/Podman sandbox. |
| `PROCESS_SANDBOX_PIDS_LIMIT` | number | `256` | Maximum process count for one Docker/Podman sandbox. |
| `PROCESS_SANDBOX_TMP_MB` | number | `512` | Size of the writable /tmp tmpfs inside a Docker/Podman sandbox, in MiB. |
| `TERMINAL_TIMEOUT_MS` | number | `30000` | Default timeout for terminal_exec when the call does not set one. |
| `GIT_TIMEOUT_MS` | number | `30000` | Timeout for a single git command. |
| `HOOKS_ENABLED` | boolean | `false` | Run declarative before_task and after_task hooks. Off by default; projects opt in through .agent/project.json. |
| `HOOK_TIMEOUT_MS` | number | `300000` | Independent wall-clock budget for each hook phase, including after_task when the main run deadline was spent. |
| `HOOKS_ON_FAILURE` | enum | `"report"` | Default failure policy for a hook that does not declare on_failure. |
| `PLAN_AUTOROUTE` | boolean | `false` | Automatically delegate the next open plan step to its assigned agent profile. Experimental and off by default. |
| `REPO_DETECT_TIMEOUT_MS` | number | `5000` | Timeout for the repository detection that fills the runtime context. |
| `MAX_SEARCH_SESSIONS` | number | `32` | Search sessions kept before the finished ones are pruned. |
| `BINARY_PROBE_BYTES` | number | `8192` | Bytes inspected when deciding whether a file is binary. |
| `IGNORED_DIRECTORIES` | string | `"node_modules,.git,dist,build,coverage,.cache,.next,.venv,__pycache__"` | Directory names skipped by tree walks and searches. |
| `JOURNAL_ENABLED` | boolean | `true` | Append structured JSONL records for runs, agent thinking, and completed tool calls under .agent/journal. |
| `EVENTSTORE_ENABLED` | boolean | `true` | Persist the full event stream once, keyed by run/turn/scope, under .agent/eventstore. The journal and sessions are derived from this single source of truth. |
| `JOURNAL_MAX_FIELD_CHARS` | number | `12000` | Maximum serialized size of journal thinking, arguments, and result fields before they become a bounded preview. |
| `MAX_RECENT_TOOL_CALLS` | number | `50` | Tool calls kept in the telemetry ring buffer. |
| `MAX_CONSOLE_EVENTS` | number | `500` | Events buffered for a console that connects late. |
| `THINKING_MAX_CHARS` | number | `4000` | How much of a model's reasoning text is reported to the console when the endpoint returns one. |
| `CONSOLE_RESULT_CHARS` | number | `2000` | How much of a tool result is streamed to the console; the full result stays available on demand. |
| `CONSOLE_CALL_HISTORY` | number | `200` | Tool calls whose full arguments and results the console keeps for inspection. |
| `PROJECT_FILE_ENABLED` | boolean | `true` | Remember this project's settings in .agent/project.json and apply them the next time it is opened. |
| `PROJECT_SAVE_SECRETS` | boolean | `false` | Write secrets such as API keys into the project file. Off, because a workspace is usually a repository. |
| `SESSIONS_ENABLED` | boolean | `true` | Keep each conversation, with its events and tool calls, in .agent/sessions so it can be reopened. |
| `SESSION_MAX_KEPT` | number | `50` | Conversations kept on disk before the oldest is removed. |
| `SESSION_MAX_MESSAGES` | number | `400` | Chat entries kept per conversation. |
| `SESSION_MAX_EVENTS` | number | `2000` | Runtime events kept per conversation, so a reopened session redraws the same cards. |
| `SESSION_MAX_CALLS` | number | `300` | Tool calls kept per conversation with their full arguments and results. |
| `SESSION_HISTORY_SIZE` | number | `200` | Lines of input history kept by the interactive session. |
| `AGENT_VERBOSE` | boolean | `true` | Print progress while a run is in flight. |
| `MCP_ENABLED` | boolean | `true` | Connect to the configured MCP servers. Off, no external server is started or contacted and only the built-in tools exist. |
| `MCP_SERVERS` | string | `""` | MCP servers declared as JSON in the environment, in the same shape as .mcp.json. Applied after the files, so it wins. |
| `MCP_EXPOSE_TOOLS` | enum | `"both"` | How an MCP server's tools reach the model. namespaced declares each one as mcp__<server>__<tool>, gateway offers only mcp_call, both does each. |
| `MCP_AUTO_DISCOVER` | boolean | `false` | List configured server tools when a run starts. Disabled by default so workspace configuration cannot execute before explicit review. |
| `MCP_TRUST_PROJECT_CONFIG` | boolean | `false` | Allow stdio MCP commands from project/workspace config. Keep false for untrusted repositories. |
| `MCP_DISCOVERY_TTL_MS` | number | `300000` | How long a discovered tool catalogue is reused before the servers are asked again. |
| `MCP_CALL_TIMEOUT_MS` | number | `60000` | Timeout for one tool call to an MCP server. |
| `MCP_CONNECT_TIMEOUT_MS` | number | `20000` | Timeout for the handshake with an MCP server, and for reading its tool list. |
| `MCP_MAX_TOOLS` | number | `200` | Ceiling on the MCP tools declared to the model, so a large server cannot flood the request. |
| `MCP_EXCERPT_CHARS` | number | `300` | Maximum length of a description or error text in an MCP tool result. |
| `MCP_MAX_MESSAGE_BYTES` | number | `16777216` | Largest single message accepted from an MCP server, so a server cannot exhaust memory with one frame. |
| `MCP_ALLOW_RUNTIME_ADD` | boolean | `true` | Allow a server to be added or removed while the runtime is running, with mcp_add, mcp_remove or the console. |
| `MCP_APPROVAL` | enum | `"inherit"` | Whether calling an MCP tool needs approval. inherit follows the policy rules and each server's trust setting, always asks every time, never asks at all. |
| `MCP_GATEWAY_APPROVAL_TTL_MS` | number | `900000` | How long an approval answer for a global MCP server is reused before the next call asks again (P0-2). 0 asks every time. |
| `WORKSPACE_ROOT` | string · fixed at startup | `تنظیم‌نشده (fallback در مصرف‌کننده)` | Directory the agent may act in. Fixed at startup because every path check depends on it. اگر unset باشد، در runtime به `process.cwd()` برمی‌گردد. |
| `STRUCTURED_AI_DATA_HOME` | string | `تنظیم‌نشده (fallback در مصرف‌کننده)` | Data home for the project registry and per-project state (Phase 2+). Empty means ~/.local/share/structured-ai. اگر unset باشد، مسیر پیش‌فرض کاربر (معمولاً `~/.local/share/structured-ai`) استفاده می‌شود. |
| `STRUCTURED_AI_TRUST_FILE` | string | `تنظیم‌نشده (fallback در مصرف‌کننده)` | File that records which workspaces the operator trusted (roadmap P0-1). Empty means ~/.config/structured-ai/trusted-workspaces.json (~\AppData\Roaming\structured-ai on Windows). Never taken from a project file. اگر unset باشد، مسیر پیش‌فرض trust store سیستم‌عامل استفاده می‌شود. |
| `RUN_HISTORY_LIMIT` | number | `100` | How many settled runs the RunManager keeps queryable after they finish. |
| `APPROVAL_HISTORY_LIMIT` | number | `500` | How many settled approval decisions the ApprovalStore keeps in its bounded in-process history (POL-045). |
| `MAX_CONCURRENT_PROJECT_RUNS` | number | `4` | How many distinct projects may have an active run at once (Phase 10). Extra projects wait on their own queue. |
| `MAX_RUNS_PER_PROJECT` | number | `1` | Active runs allowed inside one project (Phase 10). Default 1 serializes a project's runs. |
| `MAX_WORKERS_PER_USER` | number | `8` | Hard cap on total inflight runs for this process (Phase 10). |
| `RUN_QUEUE_LIMIT` | number | `16` | Per-project waiting-run depth (Phase 10). Overflow is rejected with RUN_QUEUE_FULL rather than hanging. |
| `PROJECT_MEMORY_LIMIT` | number | `0` | Bytes of recorded per-project memory after which new runs are refused (Phase 10). 0 disables the cap; the value is always exposed on /api/metrics. |
| `PROJECT_CPU_LIMIT` | number | `0` | Observational CPU percent ceiling per project (Phase 10). 0 means unlimited; the live percent is reported on /api/metrics. |

این فهرست شامل تمام **تنظیمات قابل پیکربندی runtime (۱۸۶ مورد)** است. علاوه بر آن، کد به چند متغیر عملیاتی/سیستمی که settingهای runtime نیستند نیز مستقیم دسترسی دارد:

| متغیر | مقدار پیش‌فرض/رفتار | محل استفاده و توضیح |
|---|---|---|
| `PORT` | تنظیم‌نشده؛ بدون آن اجرای وب خودکار نمی‌شود | اگر تنظیم شود و command مشخص دیگری داده نشده باشد، CLI کنسول وب را خودکار روی همین port و `0.0.0.0` اجرا می‌کند؛ `--serve <port>` اولویت دارد. |
| `AGENT_TASK` | تنظیم‌نشده | متن تسک جایگزین؛ وقتی در CLI تسکی در آرگومان‌ها داده نشده باشد استفاده می‌شود. |
| `AGENT_LOG_STREAM` | `stdout` | فقط مقدار `stderr` مسیر log را به stderr می‌فرستد. |
| `AGENT_PRINT_FINAL` | فعال (`1`) | پاسخ نهایی چاپ می‌شود؛ مقدار `0` چاپ آن را خاموش می‌کند. |
| `SHELL` | مقدار سیستم؛ fallback برابر `/bin/sh` | shell پیش‌فرض در سیستم‌های Unix برای فرایندها و نشست‌های PTY. |
| `COMSPEC` | مقدار سیستم؛ fallback برابر `cmd.exe` | shell پیش‌فرض Windows برای فرایندها و نشست‌های PTY. |
| `NO_COLOR` | تنظیم‌نشده | اگر مقداردهی شود، رنگ‌های ترمینال غیرفعال می‌شوند. |
| `NODE_ENV` | در Docker برابر `production`؛ خارج Docker تنظیم‌نشده | در Dockerfile مقداردهی می‌شود؛ در محیط‌های دیگر کاربر/پلتفرم می‌تواند آن را تعیین کند. |
| `PATH` | مقدار سیستم‌عامل | مسیر اجرایی میزبان است و در محیط محدودشدهٔ فرایند فرزند allow می‌شود؛ پروژه مقدار ثابت برای آن ندارد. |
| `CI` | مقدار runner؛ `ci/run-tests.js` برای subprocessها fallback برابر `true` دارد | علامت اجرا در CI و برای subprocessهای تست. |
| `GITHUB_OUTPUT` | فقط در GitHub Actions توسط runner تعیین می‌شود | مسیر فایل خروجی step؛ خارج GitHub Actions تعریف پروژه‌ای ندارد. |

### متغیرهای CI و تست

این موارد تنظیم runtime محصول نیستند و فقط smoke-test، تست‌ها یا ابزار stub را کنترل می‌کنند:

| متغیر | مقدار پیش‌فرض/رفتار | توضیح |
|---|---|---|
| `SMOKE_<PROVIDER>_API_KEY` | تنظیم‌نشده | کلید provider برای smoke test؛ برای `OLLAMA` لازم نیست. Prefixهای پشتیبانی‌شده: `OPENAI`, `OPENAI_RESPONSES`, `ANTHROPIC`, `GEMINI`, `AZURE_OPENAI`, `BEDROCK`, `OLLAMA`, `OPENROUTER`. |
| `SMOKE_<PROVIDER>_MODEL` | تنظیم‌نشده | مدل provider؛ برای فعال‌شدن smoke test آن provider لازم است. همان prefixهای بالا. |
| `SMOKE_<PROVIDER>_BASE_URL` | تنظیم‌نشده | آدرس سفارشی اختیاری provider در smoke test. |
| `SMOKE_<PROVIDER>_REGION` | تنظیم‌نشده | منطقهٔ اختیاری provider در smoke test (برای Bedrock). |
| `SMOKE_MIN_PROVIDERS` | `4` | حداقل تعداد provider موفق برای smoke test. |
| `SMOKE_REQUIRED` | unset (`0`) | اگر `1` باشد، نبود credential باعث fail شدن smoke test می‌شود؛ در غیر این صورت بدون credential تست skip می‌شود. |
| `STUB_MODEL_PORT` | `8899` | پورت `tools/stub-model-server.js`. |
| `WEB_TEST_TIMEOUT_MS` | `15000` | سقف انتظار برخی تست‌های وب. |
| `UI_TRACE` | تنظیم‌نشده | فعال‌کردن trace/debug خروجی تست‌های UI. |
| `DEBUG_ARCHIVE` | تنظیم‌نشده | خروجی debug در تست archive/e2e. |
| `P0_MODE` | `dual` | حالت framing در fixture تست MCP: `dual` یا `ndjson-only`. |
| `P0_ASK` | `0` | در fixture تست MCP، با `1` سرور درخواست client-side ارسال می‌کند. |
| `RUN_SANDBOX_INTEGRATION` | unset (`0`) | با `1` تست integration مربوط به sandbox اجرا می‌شود. |

مواردی مثل `${env:NAME}` در تنظیم MCP و `env` صریح ابزارها نام ثابت یا مقدار پیش‌فرضی در برنامه ندارند؛ مقدارشان از environment میزبان گرفته می‌شود و policy مربوط به secretها/فرایند فرزند بر آن اعمال می‌شود. نام‌های تستی `GITHUB_TOKEN`, `OPENAI_API_KEY`, `P05DATA_API_KEY`, `P05DATA_HOST`, `P05_EXPLICIT`, `P05_SERVICE_SECRET`, `P08_TOKEN`, `MCP_TEST_TOKEN`, `SECRET` و `MODEL_MAX_RETRIES` در تست‌ها/fixtureهای ایزوله استفاده می‌شوند؛ خارج از تست unset هستند و setting قابل پیکربندی runtime نیستند. مقادیر جعلی‌اند و برای آزمون redaction، انزوای فرایند و expansion متغیرهای MCP استفاده می‌شوند.


فلگ‌های rollout موقت مراحل قبل (`PROJECT_CONTEXT_MODE`، `RUN_CONTEXT_MODE`،
`PROMPT_BUILDER_MODE`، `RUNTIME_ENGINE_MODE` و
`WEB_SERVER_MODE`) در Phase 30 از schema و runtime حذف شده‌اند؛ همهٔ مسیرها
اکنون implementation canonical را اجرا می‌کنند و setting ناشناخته خطای واضح
می‌دهد. فهرست کامل تنظیمات runtime در جدول بالا آمده و منبع canonical آن `SettingsSchema.js` است.

## ۶. مستندات کامل اندپوینت‌های سرور وب کنسول (Web Server & REST / SSE API)

سرور canonical با `node bin/agent.js --serve <port> -w <path>` اجرا می‌شود.
APIهای runtime token-protected هستند؛ مسیرهای `/auth/status` و `/auth/login`
برای ورود به پنل استثنا هستند. برای فعال‌کردن رمز ورود، پیش از اجرا تنظیم کنید:

```bash
AGENT_CONSOLE_PASSWORD_REQUIRED=true AGENT_CONSOLE_PASSWORD='choose-a-long-password' node bin/agent.js --serve 7777
```

فلگ و رمز در طول عمر process ثابت‌اند؛ صفحهٔ وب پس از ورود یک cookie امنِ
`HttpOnly` می‌گیرد. URL حاوی bearer token برای حالت رمزدار چاپ نمی‌شود.
method/path کامل در
[`test/fixtures/api-surface.json`](test/fixtures/api-surface.json) و
`web/server/RouteInventory.js` ثبت شده‌اند.

### مسیرهای اصلی

| روش | مسیر | پاسخ قراردادی |
|---|---|---|
| `POST` | `/api/tasks` | `202 {"accepted":true}` برای مسیر single-project تاریخی |
| `GET` | `/api/events` | SSE event stream؛ با `projectId` قابل فیلتر است |
| `GET` | `/api/state` | snapshot وضعیت، messages، events، approvals و run |
| `POST` | `/api/cancel` | لغو run جاری |
| `POST` | `/api/approval-mode` | تغییر `auto`/`prompt`/`deny` |
| `GET/POST` | `/api/settings` | مشاهده یا تغییر settingهای schema |
| `GET` | `/api/health`، `/api/metrics`، `/api/stats` | سلامت و metrics gateway/project |
| `GET/POST` | `/api/mcp` | وضعیت یا افزودن MCP server |
| `GET/POST/DELETE` | `/api/sessions` و `/api/sessions/:id` | session persistence و replay |
| `GET` | `/api/calls/:key` | نتیجهٔ کامل یک tool call |

### API پروژه‌ها

| روش | مسیر | توضیح |
|---|---|---|
| `GET` | `/api/projects` | فهرست پروژه‌های ثبت‌شده، با فیلتر token |
| `POST` | `/api/projects` | ثبت پروژه با `rootPath` و permissionهای آن |
| `GET/PATCH/DELETE` | `/api/projects/:projectId` | دریافت، ویرایش یا حذف یک registry record |
| `GET` | `/api/projects/:projectId/state` | snapshot محدود به همان پروژه |
| `GET` | `/api/projects/:projectId/events` | event stream پروژه‌ای |
| `GET` | `/api/projects/:projectId/sessions` | sessionهای همان پروژه |
| `POST` | `/api/projects/:projectId/tasks` یا `/chat` | اجرای task با پاسخ `202 {accepted, project_id}` |
| `POST` | `/api/projects/:projectId/cancel` | لغو فقط runهای همان پروژه |
| `GET` | `/api/projects/:projectId/health` یا `/metrics` | سلامت و metrics همان پروژه |
| `GET/POST` | `/api/projects/:projectId/discussions` | list یا شروع discussion پایدار |
| `GET` | `/api/projects/:projectId/discussions/:discussionId` | replay transcript کامل همان پروژه |

### Discussion و approval

`POST /api/discussion` و `GET /api/discussion/personas` برای مسیر legacy
discussion حفظ شده‌اند. مسیر project-scoped علاوه بر `accepted`، شناسهٔ
پروژه و discussion را برمی‌گرداند:

```json
{
  "accepted": true,
  "id": "discussion-...",
  "project_id": "prj-a"
}
```

رونوشت کامل در `<project dataRoot>/discussion/<discussion-id>.json` با
نوشتار atomic نگه‌داری می‌شود. پروژهٔ دیگر نه در list آن را می‌بیند و نه
می‌تواند replay کند. Eventهای discussion شامل `project_id` هستند.

### استریم و امنیت

`GET /api/events?projectId=<id>` فقط eventهای همان پروژه را می‌فرستد؛ eventهای
global در stream پروژه‌ای صرفاً metadata aggregate هستند. token master یا
توکن scoped با permissionهای `project:read`، `project:write`،
 کنترل می‌شود. خطاهای validation کلید
`error` و در صورت نیاز `code` را به‌صورت additive حفظ می‌کنند.

## ۷. کاتالوگ کامل ابزارها و گروه‌ها (Tools & Tool Groups)

تمامی ابزارهای رجیسترشده دارای اعتبارسنجی دقیق اسکیما، محدودیت مرز ورک‌اسپیس و کنترل دسترسی پالیسی هستند:

```
┌──────────────────┬─────────────────────────────────────────────────────────────┐
│    گروه ابزار    │                           لیست ابزارها                      │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ filesystem.read  │ fs_read, fs_read_many, fs_list, fs_tree, fs_stat, fs_info  │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ filesystem.write │ fs_write, fs_edit, apply_patch, checkpoint_undo, fs_mkdir,  │
│                  │ fs_move, fs_delete                                          │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ search           │ search_start, search_get, search_list, search_stop          │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ process          │ terminal_exec, process_start, process_read, process_write,  │
│                  │ process_terminate, process_list                             │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ git              │ git_status, git_diff, git_log, git_branch, git_checkout,    │
│                  │ git_add, git_commit                                         │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ planning         │ plan_get, plan_set, plan_update                             │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ memory & archive │ memory_get, archive_search, archive_get                     │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ knowledge        │ skill_get, skill_read                                       │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ mcp.inspect      │ mcp_servers, mcp_tools                                      │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ mcp.call         │ mcp_call, و هر ابزار کشف‌شده با نام mcp__<server>__<tool>    │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ mcp.manage       │ mcp_add, mcp_remove                                         │
└──────────────────┴─────────────────────────────────────────────────────────────┘
```

هر ابزار تغییردهندهٔ فایل پیش از mutation یک checkpoint با retention محدود می‌سازد و
`checkpoint_id` برمی‌گرداند. `apply_patch` یک unified diff سخت‌گیرانه را روی چند فایل
UTF-8 اعمال می‌کند: فایل‌های موجود را ویرایش می‌کند، با headerهای `/dev/null` فایل تازه می‌سازد (والد باید از قبل وجود داشته باشد) یا فایل را کامل حذف می‌کند؛ حذف جزئی و rename در diff پشتیبانی نمی‌شوند؛ rename با `fs_move` انجام می‌شود. BOM و line ending فایل‌های ویرایش‌شده حفظ می‌شوند و diff در درخواست approval
نمایش می‌دهد؛ patch نامعتبر پیش از نوشتن رد می‌شود و خطای حین نوشتن باعث rollback
می‌شود. `checkpoint_undo` همان snapshot را بازیابی می‌کند و برای خود عملیات undo نیز
checkpoint جبرانی می‌سازد؛ بنابراین می‌توان آن را دوباره undo کرد. بازیابی به همان workspace محدود است. سقف اندازهٔ هر فایل، مجموع بایت‌ها
و تعداد entryها با `FILE_CHECKPOINT_MAX_FILE_BYTES`،
`FILE_CHECKPOINT_MAX_TOTAL_BYTES` و `FILE_CHECKPOINT_MAX_FILES` کنترل می‌شود؛
اگر snapshot از سقف عبور کند mutation پیش از تغییر رد می‌شود. رکوردها در
`<data-root>/checkpoints` نگهداری می‌شوند و خود مخزن checkpoint قابل تغییر از
filesystem tools نیست.

---

## ۸. خط‌لولهٔ امنیتی، پالیسی و گاردها (Security & Policy Engine)

```text
فراخوانی ابزار توسط ایجنت
       │
       ▼
[ گارد مرز ورک‌اسپیس (Workspace Guard) ] ─── خارج از محدوده؟ ──► خطای رد فوری
       │ (مسدودسازی .. و سیم‌لینک‌های فرار)
       ▼
[ گارد دایرکتوری .git و اسرار ] ─────────── تلاش برای تغییر .git؟ ──► خطای دسترسی
       │
       ▼
[ موتور ارزیابی پالیسی (Policy Engine) ]
       │
       ├─ ابزارهای خواندنی (read-only) ────────────► مجاز فوری (Allow)
       ├─ ابزارهای مخرب (shell/edit/write/rename) ──► توقف و درخواست تأیید کاربر (Prompt)
       └─ فرامین غیرقابل بازگشت (rm -rf /) ────────► رد قطعی (Deny)
```

### محافظت‌های تعبیه‌شده:
1. **Loop Detection (ضد حلقه):** اگر یک ابزار با خطای یکسان بیش از ۳ بار متوالی تکرار شود، ران‌تایم بلافاصله حلقه را متوقف کرده و خطای ساختاریافته به مدل ارسال می‌کند.
2. **Secret Redaction (ماسک خودکار اسرار):** کلیدهای API و رشته‌های محرمانه در هیچ‌یک از لاگ‌ها یا خروجی‌های ارسالی به مدل به صورت خام درج نمی‌شوند.
3. **Strict Shell Isolation:** فرامین ترمینال در زیرپروسه با گروه کاربری ایزوله اجرا شده و در صورت انقضای مهلت (Timeout) کل درخت پروسه کشته می‌شود.

---

## ۹. مدیریت بودجهٔ کانتکست و حافظه (Context Budget & Compaction)

برای جلوگیری از سرریز کانتکست مدل و مدیریت هزینه‌ها، ران‌تایم از مکانیزم **فشرده‌سازی تدریجی (Graduated Compaction)** استفاده می‌کند:
* **پیام‌های جدید:** بدون تغییر و با جزئیات کامل حفظ می‌شوند.
* **پیام‌های میانی:** خروجی‌های حجیم ابزارها خلاصه می‌شوند.
* **پیام‌های قدیمی:** به یک خلاصهٔ فشرده (Summary Digest) تبدیل شده و به دایرکتوری بایگانی منتقل می‌شوند.
* **حافظه کاری (Working Memory):** اطلاعات و یافته‌های کلیدی در طول تسک‌های متعدد در حافظه پایدار ثبت می‌شوند تا در تسک‌های بعدی قابل استفاده باشند.

با `ENDPOINT_<ROLE>_CONTEXT_TOKENS` پنجرهٔ مدل را برای هر endpoint role تنظیم کنید؛ `CONTEXT_WINDOW_TOKENS` fallback سراسری است و `CONTEXT_WINDOW_SAFETY_FRACTION` headroom را تعیین می‌کند. تخمین token شامل پیام‌ها، schema ابزارهای فعال همان agent و response-format schema است و با estimator مشترک انجام می‌شود، نه tokenizer رسمی هر provider؛ پس این سقف همچنان تقریبی است. نتایج `net_*`، `browser_*` و `mcp_*` از memory fold قرنطینه می‌شوند، در transcript می‌مانند و مانع fold شدن exchangeهای محلی بعدی نمی‌شوند؛ ممکن است برای بازیابی در archive بمانند. محتوای memory و archive دادهٔ تاریخیِ غیرقابل‌اعتماد است، نه دستور یا منبع authority؛ working memory به‌صورت پیام user ارسال می‌شود و ادعاهای مهم باید با ابزارها راستی‌آزمایی شوند. اگر نوشتن archive شکست بخورد، exchange حذف نمی‌شود. فایل memory provenance دسته‌ای و per-item را نگه می‌دارد؛ `memory_get` آن را برمی‌گرداند.

---

## ۱۰. لایهٔ اتصال به MCP و پروتکل‌های چهارگانه

ران‌تایم می‌تواند به هر سرور **Model Context Protocol** وصل شود و ابزارهای آن را در اختیار ایجنت‌ها بگذارد. کل این لایه در `agent/mcp/` است و هیچ وابستگی خارجی ندارد؛ حتی WebSocket مستقیماً پیاده‌سازی شده است.

### ۱۰.۱ پروتکل‌های پشتیبانی‌شده

| ترنسپورت | چطور کار می‌کند | چه زمانی انتخاب می‌شود |
|---|---|---|
| `stdio` | سرور به‌عنوان زیرپروسه اجرا می‌شود؛ پیام‌ها روی stdin/stdout با فریمینگ `Content-Length` یا NDJSON | وقتی `command` تعریف شده باشد |
| `http` | Streamable HTTP؛ هر پیام یک POST، پاسخ به‌صورت JSON یا استریم رویداد | آدرس `http(s)://` بدون مسیر `/sse` |
| `sse` | جفت قدیمی HTTP+SSE؛ یک استریم برای دریافت و یک مسیر POST برای ارسال | آدرسی که به `/sse` ختم شود |
| `websocket` | یک سوکت دوطرفه؛ هر پیام یک فریم متنی (RFC 6455) | آدرس `ws://` یا `wss://` |

ترنسپورت معمولاً از روی خود تعریف حدس زده می‌شود و نوشتنش اختیاری است.

### ۱۰.۲ محل تعریف سرورها

لایه‌های زیر به ترتیب خوانده می‌شوند و لایهٔ بعدی بر قبلی اولویت دارد:

```text
agent/registry/mcp_servers.json   سرورهای همراه ران‌تایم
<workspace>/.mcp.json             سرورهای پروژه (قابل کامیت)
<workspace>/.agent/mcp.json       سرورهای همین ورک‌اسپیس
MCP_SERVERS                       متغیر محیطی، بالاترین اولویت
```

هر سه شکل رایج پذیرفته می‌شود: `{"mcpServers": {...}}`، آبجکت ساده، و آرایه.

```jsonc
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${env:GITHUB_TOKEN}" }
    },
    "docs": {
      "url": "https://mcp.example.com/mcp",
      "headers": { "authorization": "Bearer ${env:DOCS_TOKEN}" }
    },
    "events": { "url": "wss://mcp.example.com/ws", "trust": "restricted" }
  }
}
```

مقدارهایی مثل `${env:TOKEN}` هنگام بارگذاری از محیط خوانده می‌شوند، بنابراین هیچ کلیدی داخل فایلی که در ریپازیتوری است نوشته نمی‌شود.

### ۱۰.۳ معرفی ابزارها به مدل

هر ابزار با فضای‌نام `mcp__<server>__<tool>` ثبت می‌شود تا دو سرور بتوانند ابزار هم‌نام داشته باشند. `MCP_EXPOSE_TOOLS` تعیین می‌کند مدل از کدام مسیر استفاده کند:

* **`namespaced`** — هر ابزار سرور مستقیماً به‌عنوان یک تابع با اسکیمای خودش اعلام می‌شود.
* **`gateway`** — فقط سه ابزار عمومی `mcp_servers`، `mcp_tools` و `mcp_call` وجود دارند.
* **`both`** (پیش‌فرض) — هر دو مسیر باز است.

| ابزار | کار |
|---|---|
| `mcp_servers` | فهرست سرورها با ترنسپورت، وضعیت اتصال و دلیل خطا |
| `mcp_tools` | کاتالوگ ابزارها به همراه پارامترهای هرکدام |
| `mcp_call` | فراخوانی هر ابزار روی هر سرور |
| `mcp_add` / `mcp_remove` | افزودن یا حذف سرور در حین اجرا (نیازمند تأیید) |

### ۱۰.۴ ایمنی و تخریب‌ناپذیری

* سروری که در دسترس نیست، **یک قابلیت کم‌شده است، نه یک ران شکست‌خورده**: ابزارهایش از کاتالوگ حذف می‌شوند، دلیلش نگه داشته می‌شود و بقیه به کار خود ادامه می‌دهند.
* ابزار یک سرور MCP بیرون از این ران‌تایم اجرا می‌شود، پس مرز ورک‌اسپیس شامل آن نمی‌شود. سرور با `trust: "restricted"` برای هر فراخوانی تأیید می‌خواهد و `MCP_APPROVAL=always` این را برای همهٔ سرورها اعمال می‌کند. هیچ‌کدام از این دو نمی‌توانند یک `deny` را باز کنند.
* annotation سرور با `destructiveHint: true` برای فراخوانی namespaced و `mcp_call` approval الزامی می‌کند، حتی اگر `MCP_APPROVAL=never` تنظیم شده باشد؛ annotation فقط می‌تواند سخت‌گیری را بیشتر کند.
* با `include` و `exclude` می‌توان کاتالوگ یک سرور را قبل از رسیدن به مدل محدود کرد.

### ۱۰.۵ کنسول وب

دکمهٔ **MCP** در هدر کنسول، وضعیت زندهٔ سرورها را نشان می‌دهد و امکان اتصال سرور جدید، فعال/غیرفعال کردن و حذف را می‌دهد. همین کارها از طریق REST هم در دسترس‌اند:

* `GET /api/mcp` · `GET /api/mcp?refresh=1`
* `POST /api/mcp` — افزودن سرور
* `POST /api/mcp/:name/enabled` — روشن یا خاموش کردن
* `DELETE /api/mcp/:name` — حذف

---

### ۱۰.۶ پیکربندی سرورهای خارجی از طریق MCP استاندارد

Structured AI کدکلاینت اختصاصی برای ابزارهای بیرونی حمل یا اجرا نمی‌کند.
قابلیت‌های خارجی فقط از طریق MCP عمومی به دست می‌آیند؛ هر سروری که قرارداد MCP
را پیاده‌سازی کند می‌تواند با همین سازوکار استفاده شود.

سرورها را در `.mcp.json` پروژه یا از طریق `mcp_add` تعریف کنید. نمونهٔ stdio:

```json
{
  "mcpServers": {
    "code-tools": {
      "transport": "stdio",
      "command": "node",
      "args": ["/path/to/your-mcp-server.js"]
    }
  }
}
```

برای استفاده، ابتدا `mcp_servers` وضعیت سرورها را نشان می‌دهد و `mcp_tools`
فهرست ابزارها و schema آن‌ها را می‌خواند؛ سپس ابزار را با `mcp_call` یا نام
مستقیم کشف‌شدهٔ `mcp__<server>__<tool>` فراخوانی کنید. MCP ابزارهای خارجی را
از مرز workspace بیرون اجرا می‌کند؛ سرورها را فقط پس از بررسی و اعتماد لازم
فعال کنید.

## ۱۱. آزمون‌ها و ارزیابی کیفیت

سوئیت با Node scriptهای مستقل و بدون dependency تست‌رانر اجرا می‌شود. ساختار
domain-based و contractهای عمومی در [`test/README.md`](test/README.md) ثبت شده‌اند.

```bash
npm run check
npm test
npm run test:contracts
npm run test:tools
npm run test:mcp
npm run test:runtime
npm run test:context
npm run test:persistence
npm run test:projects
npm run test:discussion
npm run test:web
npm run test:ui
npm run test:e2e
```

`npm test` ترتیب serial را حفظ می‌کند و testهای contract پیش از
integration/e2e اجرا می‌شوند. برای وضعیت جاری، خروجی CI شاخه را بررسی کنید.

## ۱۲. راهنمای توسعهٔ canonical

### افزودن tool

1. declaration را در schema گروه متناظر زیر `agent/registry/tool-schemas/` اضافه کنید.
2. implementation را در گروه canonical زیر `agent/tools/<group>/` قرار دهید و
   آن را از `index.js` همان گروه export کنید.
3. `ToolRuntime.js` را برای اتصال نام model-facing به implementation به‌روز
   کنید و policy/group مربوط را در registry ثبت کنید.
4. برای schema و اجرای واقعی، contract/unit test در `test/contracts/` و
   `test/tools/` اضافه کنید؛ `ToolRegistryAdapter.assertParity()` باید سبز بماند.

### افزودن skill یا agent

- skillهای declarative در `agent/registry/skills.json` و منابع حجیم در
  `agent/skills/<name>/` قرار می‌گیرند؛ `SkillTools` آن‌ها را lazy می‌خواند.
- agent profile در `agent/registry/agents.json` و personaهای discussion در
  `agent/registry/personas.json` ثبت می‌شوند. toolها و policy آن profile باید
  هم‌زمان contract-tested باشند.

### تغییر prompt یا event

- sectionهای prompt در builderهای `agent/prompt/` اضافه می‌شوند و request
  contract باید در `test/contracts/prompt.contract.test.js` و differential
  test به‌روزرسانی شود.
- event جدید باید در `agent/events/EventTypes.js` و producer/consumer متناظر
  ثبت شود. event durable خام می‌ماند؛ redaction فقط برای log/external
  projection است و contract test isolation الزامی است.

### افزودن یا اجرای project

پروژه از طریق `ProjectRegistry` یا `POST /api/projects` ثبت می‌شود؛ root از
registry خوانده می‌شود و هویت از model/tool arguments پذیرفته نمی‌شود. state
پایدار project در `STRUCTURED_AI_DATA_HOME/projects/<id>/` قرار می‌گیرد و
synthetic default برای سازگاری از `<workspace>/.agent/` استفاده می‌کند.
برای اجرای پروژهٔ مشخص:

```bash
node bin/agent.js --project <project-id> "task"
```

هیچ rollout flag یا compatibility facade دیگری برای فعال‌سازی این مسیر لازم
نیست.

## مجوز (License)
این پروژه تحت مجوز **MIT** منتشر شده است.
