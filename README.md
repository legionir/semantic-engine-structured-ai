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
│   │   └── archive/            # store، classifier، roll-up و search زیر ArchiveRepository
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
│   └── */*-cases/              # گروه‌های تست بزرگ؛ runner آن‌ها را به ترتیب با ctx اجرا می‌کند
```

در rollout نهایی Phase 30 هیچ facade انتخاب‌کننده‌ای برای حالت legacy وجود
ندارد. `agent/config`، `agent/persistence`، `agent/mcp`، `agent/tools` و
`web/server` مسیرهای canonical هستند. ریشهٔ `.agent/` فقط به‌عنوان data layout
سازگار برای synthetic default خوانده می‌شود؛ این موضوع با نگه‌داشتن کد legacy
یا flag اجرایی تفاوت دارد.

## ۳. پیش‌نیازها و راه‌اندازی سریع

### پیش‌نیازها
* **Node.js:** نسخهٔ `>= 20` (همان `engines` در `package.json`)
* **git:** برای ابزارهای git و ساختن پروژه از URL
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

### نصب روی سرور (VPS) به‌عنوان سرویس

این مراحل روی Ubuntu 22.04/24.04 یا Debian 12 تازه حدود ده دقیقه طول می‌کشد. فایل‌های آماده در پوشهٔ `deploy/` هستند.

**۱. پیش‌نیازها** (Node.js 22، git و ابزار build برای `node-pty`):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git build-essential python3
```

**۲. کاربر، کد و پوشه‌ها:**

```bash
sudo useradd --system --create-home --home-dir /var/lib/structured-ai --shell /usr/sbin/nologin structured-ai
sudo git clone https://github.com/legionir/semantic-engine-structured-ai /opt/structured-ai
cd /opt/structured-ai && sudo npm ci --omit=dev
sudo mkdir -p /srv/projects && sudo chown structured-ai: /srv/projects
```

**۳. تنظیمات:** فایل نمونه را کپی کنید و دست‌کم `AGENT_CONSOLE_TOKEN` (مثلاً خروجی `openssl rand -base64 32`) و اندپوینت مدل را در آن بنویسید.

```bash
sudo cp deploy/structured-ai.env.example /etc/structured-ai.env
sudo chmod 600 /etc/structured-ai.env
sudo nano /etc/structured-ai.env
```

**۴. بررسی با `doctor`:** نسخهٔ Node، git، npx/uvx/python، آزاد بودن پورت، قابل نوشتن بودن پوشهٔ داده و ورک‌اسپیس و پروژه‌ها، مجوز فایل‌های secret، token کنسول، اندپوینت مدل، حافظه و دیسک و sandbox را بررسی می‌کند. هر مورد مشکل‌دار با راه‌حلش چاپ می‌شود و اگر چیزی مانع اجرا باشد، کد خروج 1 است.

```bash
sudo bash -c 'set -a; . /etc/structured-ai.env; set +a; cd /opt/structured-ai &&
  exec sudo -E -u structured-ai node bin/agent.js doctor -s 7777 --host 127.0.0.1 -w /srv/projects'
```

**۵. سرویس systemd** (با ری‌استارت خودکار):

```bash
sudo cp deploy/structured-ai.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now structured-ai
journalctl -u structured-ai -f
```

**۶. HTTPS با reverse proxy:** کنسول فقط روی `127.0.0.1:7777` گوش می‌دهد. ساده‌ترین راه Caddy است که گواهی Let's Encrypt را خودش می‌گیرد:

```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile   # دامنه را عوض کنید
sudo systemctl reload caddy
```

برای nginx از `deploy/nginx.conf.example` استفاده کنید. دو نکته لازم است: هدر `Host` باید دست‌نخورده برسد، چون کنسول درخواستی را که `Origin` آن با `Host` نخواند رد می‌کند؛ و `proxy_buffering off` لازم است، چون نمای زنده با server-sent events کار می‌کند.

پس از ری‌استارت سرویس، گفتگویی که وسط اجرا قطع شده با وضعیت «قطع‌شده» و دکمهٔ **Continue** در کنسول دیده می‌شود. از خط فرمان هم می‌توان آن را ادامه داد: `agent resume [session-id] [پیام]`.

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

حالت headless برای CI (roadmap P3-07):

```bash
# پاسخ نهایی باید با JSON Schema بخواند؛ فقط همان JSON روی stdout می‌آید
node bin/agent.js -w . --json-schema out.schema.json "فایل‌های تغییرکرده را فهرست کن"

# سقف هزینه، هدف (پایان فقط وقتی هدف برآورده شد) و حالت برنامه‌ریزی
node bin/agent.js -w . --max-cost 0.50 --goal "npm test سبز است" "تست‌ها را درست کن"
node bin/agent.js -w . --plan "کش را اضافه کن"

# بازبینی کد: diff (پیش‌فرض)، staged، branch <ref>، commit <ref>، pr <n>
node bin/agent.js -w . review branch --base main --json
node bin/agent.js -w . review pr 42 --post
```

| کد خروج | معنی |
|---|---|
| `0` | موفق |
| `1` | شکست اجرا؛ در `review`: یافتهٔ high یا critical |
| `2` | خطای استفاده (پرچم نامعتبر، پروژهٔ بدون git در review) |
| `3` | پاسخ نهایی با `--json-schema` نخواند (تخلف‌ها روی stdout) |
| `4` | بودجه تمام شد (`--max-cost`، `MAX_RUN_MS`، سقف توکن) |
| `130` | قطع با سیگنال |

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
* `/init` — بررسی پروژه و نوشتن یا به‌روزکردن `AGENTS.md` (معادل `node bin/agent.js init`)

**دستورالعمل پروژه (`AGENTS.md` / `CLAUDE.md`):** اگر ریشهٔ پروژه `AGENTS.md` یا `CLAUDE.md` داشته باشد، متن آن (حداکثر `PROJECT_INSTRUCTIONS_MAX_CHARS` نویسه) در هر درخواست به ایجنت اصلی و زیرایجنت‌ها می‌رسد؛ `AGENTS.override.md` جای هر دو را می‌گیرد. فایل‌های هم‌نام در زیرپوشه‌ها (تا عمق `PROJECT_INSTRUCTIONS_SCAN_DEPTH`) فقط فهرست می‌شوند تا ایجنت هنگام کار در آن پوشه بخواندشان. symlinkی که به بیرون پروژه اشاره کند خوانده نمی‌شود.

**اشاره به فایل و تصویر:** `@مسیر` در متن تسک (مثلاً `@src/app.js` یا `@docs/`) هنگام ارسال خوانده و به پیام افزوده می‌شود (مجموعاً تا `TASK_MENTION_MAX_CHARS`)؛ پوشه به‌صورت فهرست و تصویر به‌صورت تصویر. فقط مسیرهای داخل پروژه پذیرفته می‌شوند. در کنسول وب، تایپ `@` فهرست فایل‌ها را پیشنهاد می‌دهد و اسکرین‌شاتِ paste‌شده پیوست می‌شود؛ تصویرهای پیوست و تصویرهایی که ابزارهای MCP برمی‌گردانند به مدل نشان داده می‌شوند، مگر `MODEL_IMAGE_INPUT=off` باشد.

**گفتگوهای موازی پروژه‌ها:** هر پروژه گفتگوی زندهٔ خودش را دارد (transcript، وضعیت، رویدادها و approvalها) و چند پروژه هم‌زمان اجرا می‌شوند؛ در کنسول وب هر گفتگو یک تب با نشان وضعیت (running، awaiting approval، done، failed) دارد و انتخاب تب استریم همان پروژه را با snapshot کاملش باز می‌کند. پیامی که به پروژهٔ مشغول فرستاده شود در صف نوبت بعد می‌نشیند (زیر composer قابل ویرایش، حذف و ادامه است) و دکمهٔ «Correct now» متن را پیش از قدم بعدی به همان run می‌رساند. Stop صف را پاک نمی‌کند. با دکمهٔ «Notify» اعلان مرورگر برای پایان، خطا یا انتظار approval فقط وقتی صفحه در پس‌زمینه است فعال می‌شود؛ کلیک روی اعلان همان گفتگو را باز می‌کند و عنوان صفحه تعداد گفتگوهای نیازمند توجه را نشان می‌دهد.

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
`project-*.js`) و `console.js` فقط کنترل‌های صفحه را به آن‌ها وصل می‌کند.
دکمه‌های **Logs**، **Terminal** و **Files** در هدر سه ابزار عملیاتی را باز می‌کنند:
لاگ سراسری برنامه (به‌ویژه خطاهای درخواست به مدل با status، endpoint و بدنهٔ پاسخ
redact‌شده، به‌صورت زنده و با نشان تعداد خطاهای جدید روی دکمه)، ترمینال سیستم با
xterm.js (چند تب، اتصال مجدد با scrollback) و مدیریت فایل (مرور، ساخت، ویرایش،
تغییر نام، حذف و دانلود با جلوگیری از بازنویسی تغییرات هم‌زمان). لاگ در
`<data home>/logs/structured-ai.jsonl` هم با rotate نوشته می‌شود. xterm.js استایل
پویای خود را از طریق CSSOM (`csp-style-bridge.js`) اعمال می‌کند تا CSP شل نشود. صفحه با یک
Content-Security-Policy سخت‌گیر سرو می‌شود: اسکریپت، استایل و اتصال فقط از همان origin مجازند و
اسکریپت inline خود صفحه با sha256 مجاز می‌شود که سرور هنگام سرو کردن حساب می‌کند. تست‌های UI روی happy-dom با
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
| `CONSOLE_PASSWORD_SESSION_TTL_MS` | number | `86400000` | How long one password sign-in stays valid when AGENT_CONSOLE_PASSWORD_REQUIRED is on, in milliseconds. Each sign-in gets its own session; a restart ends all of them. |
| `CONSOLE_PASSWORD_SESSIONS_MAX` | number | `500` | Most password sign-in sessions kept at once. Expired sessions go first, then the oldest is dropped to make room for a new sign-in. |
| `TRUSTED_PROXIES` | string · fixed at startup | `""` | Comma-separated list of trusted reverse proxy IP addresses (for example 127.0.0.1,::1). Empty ignores X-Forwarded-Host and X-Forwarded-Proto headers. |
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
| `PROCESS_ORPHAN_SWEEP` | boolean | `true` | When the console starts, stop the background processes a previous runtime started and could not stop because it was killed (recorded in `<data home>/processes.json`; on Linux a process is stopped only when its start time still matches). |
| `TERMINAL_TIMEOUT_MS` | number | `30000` | Default timeout for terminal_exec when the call does not set one. |
| `TERMINAL_CANCEL_GRACE_MS` | number | `2000` | When a run is stopped, a running terminal_exec command gets SIGTERM and, after this many milliseconds, SIGKILL. |
| `TOOL_CANCEL_WAIT_MS` | number | `3000` | When a run is stopped, how long the runtime waits for a running tool to stop on its own before it abandons the call and ends the run. |
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
| `SESSION_CHECKPOINT_MS` | number | `3000` | While a turn runs, its conversation (with the agent's progress so far) is saved at most this often, so a server restart loses at most this much and the turn can be continued (roadmap P1-06). 0 saves only when a turn ends. |
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
| `SECRET_STORE_KEY` | string | `""` | Passphrase that encrypts the secret store (`<data home>/secrets.enc`). Empty: a random key is kept in `<data home>/secrets.key`. Set through the environment and restart to change it. |
| `MCP_RECONNECT_ENABLED` | boolean | `true` | Start an MCP server again on its own when it exits unexpectedly, waiting longer after each failed attempt. |
| `MCP_RECONNECT_BASE_MS` | number | `1000` | Wait before the first reconnect attempt; each further attempt doubles it (±20% jitter), up to `MCP_RECONNECT_MAX_MS`. |
| `MCP_RECONNECT_MAX_MS` | number | `60000` | Longest wait between two reconnect attempts. |
| `MCP_RECONNECT_MAX_ATTEMPTS` | number | `10` | Reconnect attempts before a server is marked unreachable; the next tool call or Reconnect in the console tries again. |
| `MCP_TOOL_LOADING` | enum | `auto` | How MCP tool definitions reach the model (roadmap P4-06). eager declares tools until MCP_TOOL_DEFINITIONS_BUDGET is spent; lazy declares none and lists each by name and one line, loaded on demand with mcp_search_tools and called with mcp_call; auto is eager while everything fits the budget and lazy once it does not. |
| `MCP_TOOL_DEFINITIONS_BUDGET` | number | `24000` | Ceiling, in characters of JSON, on the MCP tool definitions declared in one model request (roadmap P4-06). The rest are listed by name and loaded with mcp_search_tools. |
| `MCP_OAUTH_REDIRECT_BASE` | string | `""` | The console's public address (https://host:port) an OAuth provider redirects back to after an MCP sign-in, ending in /api/mcp/oauth/callback (roadmap P4-08). Empty: the address the panel was opened at. |
| `MCP_SAMPLING_ENABLED` | boolean | `false` | Whether an MCP server whose definition says sampling: true may ask this runtime's model for a completion (sampling/createMessage, roadmap P4-10). Off: the capability is not advertised and every request is refused. |
| `MCP_SAMPLING_MAX_TOKENS` | number | `1024` | Largest completion one sampling request may produce; a server asking for more gets this many (roadmap P4-10). |
| `MCP_SAMPLING_BUDGET_TOKENS` | number | `20000` | Tokens (prompt plus completion) each MCP server may spend on sampling while this process runs; a request beyond it is refused (roadmap P4-10). 0 refuses every request. |
| `MCP_ELICITATION_TIMEOUT_MS` | number | `300000` | How long a server's question to the user (elicitation/create) waits in the panel before it is answered with cancel (roadmap P4-10). |
| `MCP_SERVE_ENABLED` | boolean | `true` | Whether this console answers MCP clients at /mcp (and agent mcp-serve over stdio), offering list_projects, run_task and task_status to a caller holding a console or project token (roadmap P4-11). |
| `MCP_REGISTRY_URL` | string | `https://registry.modelcontextprotocol.io` | The MCP registry the console searches for servers that are not in the bundled catalogue (roadmap P4-12). Empty: registry search is off. |
| `MCP_OAUTH_REFRESH_MARGIN_MS` | number | `60000` | How long before an MCP server's OAuth access token expires it is refreshed (roadmap P4-08); a refused call also refreshes it once. |
| `MCP_OAUTH_FLOW_TTL_MS` | number | `600000` | How long an MCP OAuth sign-in started from the console may take before its one-time state expires (roadmap P4-08). |
| `MCP_OPENAPI_MAX_OPERATIONS` | number | `64` | Most operations of an OpenAPI document mcp_build turns into tools of one generated MCP server (roadmap P4-09); the rest are left out. |
| `MCP_DEFERRED_LINE_CHARS` | number | `120` | Length of the one-line description each deferred MCP tool gets in the model's index when tool definitions are loaded lazily (roadmap P4-06). |
| `MCP_OAUTH_TIMEOUT_MS` | number | `15000` | Time limit for one OAuth request to an MCP authorization server (metadata discovery, client registration, token exchange and refresh), in milliseconds. MAX_REQUEST_MS caps it when smaller. |
| `MCP_OAUTH_MAX_RESPONSE_BYTES` | number | `262144` | Largest OAuth metadata or token response, in bytes, read from an MCP authorization server; a bigger one is refused. |
| `PLAYWRIGHT_BROWSERS_PATH` | string | `""` | Where the headless Chromium for browser MCP servers is installed and looked for. Empty: Playwright's default cache (`~/.cache/ms-playwright` on Linux). |
| `WORKSPACE_ROOT` | string · fixed at startup | `تنظیم‌نشده (fallback در مصرف‌کننده)` | Directory the agent may act in. Fixed at startup because every path check depends on it. اگر unset باشد، در runtime به `process.cwd()` برمی‌گردد. |
| `STRUCTURED_AI_DATA_HOME` | string | `تنظیم‌نشده (fallback در مصرف‌کننده)` | Data home for the project registry and per-project state (Phase 2+). Empty means ~/.local/share/structured-ai. اگر unset باشد، مسیر پیش‌فرض کاربر (معمولاً `~/.local/share/structured-ai`) استفاده می‌شود. |
| `STRUCTURED_AI_TRUST_FILE` | string | `تنظیم‌نشده (fallback در مصرف‌کننده)` | File that records which workspaces the operator trusted (roadmap P0-1). Empty means ~/.config/structured-ai/trusted-workspaces.json (~\AppData\Roaming\structured-ai on Windows). Never taken from a project file. اگر unset باشد، مسیر پیش‌فرض trust store سیستم‌عامل استفاده می‌شود. |
| `RUN_HISTORY_LIMIT` | number | `100` | How many settled runs the RunManager keeps queryable after they finish. |
| `APPROVAL_HISTORY_LIMIT` | number | `500` | How many settled approval decisions the ApprovalStore keeps in its bounded in-process history (POL-045). |
| `MAX_CONCURRENT_PROJECT_RUNS` | number | `4` | How many distinct projects may have an active run at once (Phase 10). Extra projects wait on their own queue instead of being refused; their tab says "waiting for a slot" (`run:queued`). On a 1 vCPU / 2 GB server keep it at 4–5. |
| `MAX_RUNS_PER_PROJECT` | number | `1` | Active runs allowed inside one project (Phase 10). Default 1 serializes a project's runs. |
| `MAX_WORKERS_PER_USER` | number | `8` | Hard cap on total inflight runs for this process (Phase 10). |
| `RUN_QUEUE_LIMIT` | number | `16` | Per-project waiting-run depth (Phase 10). Overflow is rejected with RUN_QUEUE_FULL rather than hanging. |
| `PROJECT_MEMORY_LIMIT` | number | `0` | Bytes of recorded per-project memory after which new runs are refused (Phase 10). 0 disables the cap; the value is always exposed on /api/metrics. |
| `PROJECT_CPU_LIMIT` | number | `0` | Observational CPU percent ceiling per project (Phase 10). 0 means unlimited; the live percent is reported on /api/metrics. |
| `RESOURCE_MONITOR_INTERVAL_MS` | number | `30000` | How often the console samples CPU, memory and disk and checks the low-memory and low-disk limits (roadmap P1-07). 0 turns the warnings off; the System view still samples on demand. |
| `RESOURCE_MIN_FREE_MEMORY_MB` | number | `200` | Available memory in MB below which a warning goes to the global log and the System view. 0 disables the memory warning. |
| `RESOURCE_MIN_FREE_DISK_MB` | number | `1024` | Free disk space in MB (where the data home and the workspace live) below which a warning goes to the global log and the System view. 0 disables the disk warning. |
| `PROJECTS_ROOT` | string | `""` | Folder that projects cloned from a git URL are created in (roadmap P1-02). Empty: `<data home>/projects`. A clone can never be placed outside it. |
| `GIT_CLONE_TOKEN` | string · secret | `""` | Access token for cloning private repositories over https when no secret is named in the clone form. Read from the environment; prefer a secret in the secret store (`GITHUB_PAT` for github.com, `GITLAB_TOKEN` for gitlab.com are used automatically). |
| `GIT_CLONE_TIMEOUT_MS` | number | `900000` | Longest a clone may run before it is stopped and its half-written folder removed. |
| `LOG_LEVEL` | enum | `"info"` | Lowest level kept in the application log (Logs in the console): failed AI requests and retries, run, tool, hook and MCP failures, server errors and crashes. |
| `LOG_BUFFER_ENTRIES` | number | `2000` | Application log entries kept in memory for the console. |
| `LOG_FILE_ENABLED` | boolean | `true` | When the console is served, also append the application log to <data home>/logs/structured-ai.jsonl. |
| `LOG_FILE_MAX_MB` | number | `10` | Size at which the application log file is rotated. |
| `LOG_FILE_KEEP` | number | `3` | Rotated application log files kept next to the current one (.1 is the newest). |
| `LOG_MAX_FIELD_CHARS` | number | `8000` | Longest message or detail text (such as a model's error response) kept in one log entry before it is clipped. |
| `CONSOLE_TERMINAL_ENABLED` | boolean · fixed at startup | `true` | Allow the admin console token to open system terminals (an unsandboxed shell in the workspace, running as the server's user). Set through the environment and restart to change it. |
| `CONSOLE_TERMINAL_MAX_SESSIONS` | number | `4` | Terminals that may be open at the same time. |
| `CONSOLE_TERMINAL_SCROLLBACK_CHARS` | number | `262144` | Terminal output the server keeps per terminal, replayed when the console reconnects or reopens it. |
| `CONSOLE_FILE_MANAGER_ENABLED` | boolean · fixed at startup | `true` | Allow the admin console token to browse, create, edit, rename and delete files inside the workspace. Set through the environment and restart to change it. |
| `CONSOLE_FILE_MAX_BYTES` | number | `2097152` | Largest file the console file manager opens or saves as text. |
| `CONSOLE_FILE_UPLOAD_MAX_BYTES` | number | `52428800` | Largest file the console file manager accepts as an upload (any file type). The body is streamed to disk, so this is not held in memory. |
| `CONSOLE_FILE_LIST_MAX` | number | `5000` | Entries the console file manager lists in one folder; a larger folder is shown truncated. |
| `AGENT_REASONING_EFFORT` | enum | `"inherit"` | Default reasoning effort inherited by layer models whose effort is set to inherit. |
| `ENDPOINT_MAIN_REASONING_EFFORT` | enum | `"inherit"` | Reasoning effort for the root orchestrator. Inherit uses AGENT_REASONING_EFFORT. |
| `ENDPOINT_L1_REASONING_EFFORT` | enum | `"inherit"` | Reasoning effort for depth-1 agents. Inherit uses AGENT_REASONING_EFFORT. |
| `ENDPOINT_L2_REASONING_EFFORT` | enum | `"inherit"` | Reasoning effort for depth-2 agents. Inherit uses AGENT_REASONING_EFFORT. |
| `ENDPOINT_L3_REASONING_EFFORT` | enum | `"inherit"` | Reasoning effort for depth-3+ agents. Inherit uses AGENT_REASONING_EFFORT. |
| `ENDPOINT_SUMMARY_REASONING_EFFORT` | enum | `"inherit"` | Reasoning effort for the context summariser. Inherit uses AGENT_REASONING_EFFORT. |
| `UPLOAD_MAX_REQUEST_BYTES` | number | `41943040` | Maximum size of one multipart upload request in bytes. |
| `UPLOAD_MAX_FILE_BYTES` | number | `20971520` | Maximum size of one uploaded file in bytes. |
| `UPLOAD_MAX_FILES` | number | `8` | Maximum number of files accepted in one upload request. |
| `PROJECT_INSTRUCTIONS_ENABLED` | boolean | `true` | Put the workspace's AGENTS.md / CLAUDE.md (AGENTS.override.md wins) into every prompt, and list the instruction files of sub-directories for the agent to read (roadmap P1-01). |
| `PROJECT_INSTRUCTIONS_MAX_CHARS` | number | `32768` | How many characters of the root instruction files reach the model; the rest is cut and the cut is reported once to the application log. |
| `PROJECT_INSTRUCTIONS_SCAN_DEPTH` | number | `3` | How many directory levels below the workspace root are searched for AGENTS.md / CLAUDE.md files to list. 0 lists none. |
| `CHILD_ENV_PASSTHROUGH` | string | `""` | Extra environment variable names (comma or space separated) passed to processes started for the model: terminal, background processes, git, stdio MCP servers. A name that looks like a credential (KEY, TOKEN, SECRET, PASSWORD, AUTH...) is never passed, even when listed (roadmap P2-02). |
| `MODEL_IMAGE_INPUT` | enum | `"on"` | Whether pictures reach the model: screenshots and other images returned by MCP tools, and images attached to a message. off keeps a text placeholder, for a model that cannot read images (roadmap P3-01, P1-09). |
| `MODEL_IMAGE_MAX_BYTES` | number | `3932160` | Largest picture (decoded bytes) sent to the model; a larger one is replaced by a note saying why. |
| `IMAGE_CONTEXT_CHARS` | number | `3000` | How many characters one image part counts as when the conversation size is measured for compaction; its base64 text is not counted. |
| `SKILLS_MARKDOWN_ENABLED` | boolean | `true` | Load SKILL.md skills from .agent/skills and .claude/skills of the project, <data home>/skills and agent/skills, next to the registry skills (roadmap P3-02). |
| `TASK_MENTION_MAX_CHARS` | number | `40000` | How many characters of the files named with @path in a message are read into it, for all mentions together; the rest is named but not inlined (roadmap P1-09). |
| `SKILL_COMMANDS` | enum | `"read-only"` | Whether !`command` in a SKILL.md body is replaced by its output when the skill is loaded: read-only runs commands CommandRisk rates low, from shipped or operator skills and trusted workspaces only; off runs none. |
| `PROJECT_QUEUE_MAX` | number | `20` | Messages a project's conversation keeps queued while its run is busy; each starts as the next turn when the run ends. 0 turns the queue off and a busy project answers 409 as before (roadmap P1-04). |
| `GIT_ALLOW_FORCE_PUSH` | boolean | `false` | Whether git_push may be asked for force: true (sent as --force-with-lease). Off: every force push is refused, approved or not (roadmap P3-04). |
| `GIT_WORKTREE_ROOTS` | string | `""` | Comma-separated absolute folders git_worktree may create worktrees in, besides the workspace itself (roadmap P3-04). A path outside both is refused. |
| `RUN_SNAPSHOTS` | boolean | `true` | Before and after every run in a git workspace, record the whole working tree under refs/structured-ai/runs/<run> without touching the branch or the index, so a task can be diffed and reverted as a unit (roadmap P3-09). |
| `MAX_RUN_COST_USD` | number | `0` | Dollar cap for one run, from the token usage the endpoint reports and the model's price (roadmap P3-05). 0: no cap; the cost is still counted and shown. |
| `MODEL_PRICES` | string | `""` | JSON object of extra or corrected prices in dollars per million tokens, by model name or prefix: {"my-model": {"input": 0.5, "output": 1.5}}. Merged over the built-in table. |
| `GOAL_MAX_CHECKS` | number | `3` | How many times a run with a goal is sent back to work when its final answer does not meet the goal (roadmap P3-05). 0 checks the goal but never sends it back. |
| `PROJECT_RULES_ENABLED` | boolean | `true` | Read rule files from .agent/rules, .claude/rules and .cursor/rules (roadmap P3-06). A rule with globs front matter reaches the model only once the agent works on a matching file; one without globs always applies. |
| `PROJECT_RULES_MAX_CHARS` | number | `12000` | Most characters of project rules placed in one request. |
| `REVIEW_MAX_DIFF_CHARS` | number | `60000` | Longest diff the reviewer reads in one review (roadmap P3-08); a longer one is cut and the cut is reported. |

این فهرست شامل تمام **تنظیمات قابل پیکربندی runtime (۲۶۲ مورد)** است. علاوه بر آن، کد به چند متغیر عملیاتی/سیستمی که settingهای runtime نیستند نیز مستقیم دسترسی دارد:

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
APIهای runtime token-protected هستند؛ مسیرهای `/auth/status`، `/auth/login` و `/auth/logout`
برای ورود به پنل و خروج از آن استثنا هستند. برای فعال‌کردن رمز ورود، پیش از اجرا تنظیم کنید:

```bash
AGENT_CONSOLE_PASSWORD_REQUIRED=true AGENT_CONSOLE_PASSWORD='choose-a-long-password' node bin/agent.js --serve 7777
```

فلگ و رمز در طول عمر process ثابت‌اند؛ صفحهٔ وب پس از ورود یک cookie امنِ
`HttpOnly` می‌گیرد. URL حاوی bearer token برای حالت رمزدار چاپ نمی‌شود.

**ورود، iframe و reverse proxy:**

- بدون رمز، صفحهٔ ورود token کنسول را می‌گیرد و `POST /auth/login` با
  `{token}` آن را بررسی و cookie را تنظیم می‌کند. `/auth/status` وضعیت واقعی
  ورود را برمی‌گرداند.
- با رمز، هر ورود یک نشست جدا با عمر `CONSOLE_PASSWORD_SESSION_TTL_MS` می‌سازد
  (حداکثر `CONSOLE_PASSWORD_SESSIONS_MAX` نشست هم‌زمان).
- **خروج:** دکمهٔ **Sign out** آخرین گزینهٔ منوی بالای پنل است و در پالت فرمان هم هست. بعد از تأیید، `POST /auth/logout` فرستاده می‌شود:
  - نشست رمزدار همان مرورگر در سرور باطل می‌شود، پس کپی cookie هم دیگر کار نمی‌کند.
  - هر دو cookie کنسول با `Max-Age=0` منقضی می‌شوند.
  - token یا نشستی که در حافظهٔ تب بوده پاک می‌شود و صفحه بدون query دوباره بارگذاری می‌شود تا صفحهٔ ورود بیاید.
  - این مسیر فقط از همان origin پذیرفته می‌شود و بدون اعتبار معتبر هم پاسخ `200 {ok, revoked}` می‌دهد، پس تکرارش بی‌خطر است. اگر سرور خروج را تأیید نکند، کاربر وارد می‌ماند و خطا نمایش داده می‌شود.
  - تسک‌های در حال اجرا متوقف نمی‌شوند. token کنسول هم باطل نمی‌شود، چون جزو تنظیمات است نه نشست.
- روی HTTPS cookie با `Secure; SameSite=None; Partitioned` صادر می‌شود تا پنل
  داخل iframe هم کار کند. روی HTTP همان `SameSite=Strict` می‌ماند.
- اگر مرورگر cookie را در iframe مسدود کند، صفحه token یا نشست را فقط در
  حافظهٔ همان تب نگه می‌دارد و با هدر (`Authorization` یا `x-console-session`)
  می‌فرستد. فقط EventSource و لینک دانلود، که هدر نمی‌پذیرند، آن را در آدرس
  می‌گذارند. سرور `?session=` را فقط برای `GET` و `HEAD` می‌پذیرد.
- `X-Forwarded-Host` و `X-Forwarded-Proto` فقط وقتی درخواست از نشانی‌ای در
  `TRUSTED_PROXIES` بیاید حساب می‌شوند: در بررسی Origin (کنسول و `/mcp`)، در
  تشخیص HTTPS برای cookie و در آدرس بازگشت OAuth. اگر خالی باشد، نادیده گرفته
  می‌شوند.
method/path کامل در
[`test/fixtures/api-surface.json`](test/fixtures/api-surface.json) و
`web/server/RouteInventory.js` ثبت شده‌اند.

### مسیرهای اصلی

| روش | مسیر | پاسخ قراردادی |
|---|---|---|
| `POST` | `/api/tasks` | `202 {"accepted":true}` برای مسیر single-project تاریخی |
| `GET` | `/api/mentions?q=&projectId=` | تا ۳۰ فایل/پوشهٔ داخل پروژه برای تکمیل `@` در composer (دسترسی `project:read`) |
| `GET` | `/api/events` | SSE event stream؛ با `projectId` قابل فیلتر است |
| `GET` | `/api/state` | snapshot وضعیت، messages، events، approvals و run |
| `POST` | `/api/cancel` | لغو run جاری |
| `POST` | `/api/approval-mode` | تغییر `auto`/`prompt`/`deny` |
| `GET/POST` | `/api/settings` | مشاهده یا تغییر settingهای schema |
| `GET` | `/api/health`، `/api/metrics`، `/api/stats` | سلامت و metrics gateway/project |
| `GET/POST` | `/api/mcp` | وضعیت یا افزودن MCP server |
| `POST` | `/api/mcp/:name/reconnect` | اتصال دوباره به یک سرور MCP و صفر کردن شمارش تلاش‌ها |
| `GET` | `/api/mcp/catalog` | کاتالوگ سرورهای MCP با پیش‌نیازها، ورودی‌ها و نصب‌های فعلی (ادمین) |
| `POST` | `/api/mcp/catalog/:id/activate` | فعال‌سازی یک مدخل کاتالوگ: ذخیرهٔ توکن، نوشتن config، اتصال و فهرست ابزارها (ادمین) |
| `POST` | `/api/mcp/catalog/:name/deactivate` | غیرفعال‌سازی و برگرداندن config، با `forget_secrets` اختیاری (ادمین) |
| `GET` | `/api/mcp/prerequisites` | بررسی npx/uvx/python/chromium با راهنمای نصب (ادمین) |
| `GET/POST` | `/api/mcp/prerequisites/:id/install` | نصب یک‌کلیکی Chromium و پیگیری پیشرفت آن (ادمین) |
| `POST` | `/api/mcp/import/preview` | پیش‌نمایش ادغام config یک کلاینت دیگر (Claude Desktop، Cursor، VS Code، Zed): وضعیت هر سرور `new`/`identical`/`conflict`/`invalid` (ادمین) |
| `POST` | `/api/mcp/import` | ادغام با `{text, target: user\|workspace, resolutions: {name: skip\|replace\|rename:<new>}}`؛ تا تعارضی بی‌تصمیم بماند `409` و هیچ چیز نوشته نمی‌شود (ادمین) |
| `PATCH` | `/api/mcp/:name/controls` | کنترل هر ابزار `{tool, enabled}`، `approval: {read, write}` (`inherit`/`always`/`never`)، `agents`، `projects`؛ در `<data home>/mcp-overrides.json` (ادمین) |
| `POST` | `/api/mcp/:name/oauth/start` | شروع ورود OAuth 2.1 (PKCE S256، ثبت پویای client)؛ آدرس صفحهٔ ورود را برمی‌گرداند (ادمین) |
| `GET` | `/api/mcp/oauth/callback` | بازگشت از provider؛ بدون token کنسول، با `state` یک‌بارمصرف محافظت می‌شود |
| `POST` | `/api/mcp/:name/oauth/signout` | خروج و پاک کردن tokenها، با `forget_client` اختیاری (ادمین) |
| `GET` | `/api/mcp/elicitations` | سؤال‌هایی که سرورهای MCP منتظر پاسخشان هستند |
| `POST` | `/api/mcp/elicitations/:id` | پاسخ `{action: accept\|decline\|cancel, content}`؛ محتوا با schema سرور بررسی می‌شود |
| `GET` | `/api/mcp/:name/resources[?uri=]` | فهرست resourceها و templateها، یا خواندن یکی |
| `GET` | `/api/mcp/prompts` | promptهای همهٔ سرورهای آماده (دستورهای `/` در کادر پیام) |
| `GET`/`POST` | `/api/mcp/:name/prompts[/:prompt]` | فهرست promptهای یک سرور، یا رندر یکی با `{arguments}` |
| `GET` | `/api/mcp/registry?q=&cursor=` | جست‌وجو در MCP registry رسمی (`MCP_REGISTRY_URL`) همراه با هشدار اعتماد (ادمین) |
| `POST` | `/api/mcp/registry/add` | افزودن از registry با `{name, inputs, acknowledge_untrusted: true}`؛ بدون تأیید `428`؛ سرور `restricted` اضافه می‌شود و secretها به secret store می‌روند (ادمین) |
| `POST` | `/mcp` | خود structured-ai به‌عنوان سرور MCP (Streamable HTTP)؛ فقط `Authorization: Bearer` با token کنسول یا پروژه؛ ابزارهای `list_projects`، `run_task`، `task_status` |
| `GET` | `/api/secrets` | فهرست نام secretها و محل استفاده؛ مقدار هرگز برنمی‌گردد (ادمین) |
| `PUT/DELETE` | `/api/secrets/:name` | ذخیره یا حذف یک secret (ادمین) |
| `GET` | `/api/interrupted` | گفتگوهایی که ری‌استارت سرور وسط اجرا قطع کرد (P1-06)، با فیلتر token |
| `POST` | `/api/interrupted/:id/resume` | ادامهٔ یک گفتگوی قطع‌شده با همان context، با `{message}` اختیاری؛ پاسخ `202 {where: foreground\|background}`، اگر پروژه مشغول باشد `409` |
| `DELETE` | `/api/interrupted/:id` | کنار گذاشتن؛ وضعیت گفتگو «stopped» (`cancelled`) می‌شود |
| `GET/POST/DELETE` | `/api/sessions` و `/api/sessions/:id` | session persistence و replay |
| `GET` | `/api/calls/:key` | نتیجهٔ کامل یک tool call |

### لاگ، ترمینال و مدیریت فایل (فقط token ادمین)

این سه گروه فقط با token master کار می‌کنند؛ token محدود به پروژه پاسخ `403`
می‌گیرد. ترمینال و مدیریت فایل با `CONSOLE_TERMINAL_ENABLED=false` و
`CONSOLE_FILE_MANAGER_ENABLED=false` (فقط از محیط و با restart) خاموش می‌شوند.

| روش | مسیر | توضیح |
|---|---|---|
| `GET` | `/api/logs` | ورودی‌های لاگ با فیلتر `level` (حداقل سطح)، `source`، `q`، `after` (خواندن افزایشی) و `limit`، به‌همراه `summary` |
| `POST` | `/api/logs` | ثبت خطای مرورگر پنل `{level, message, details}` با منبع `panel` |
| `DELETE` | `/api/logs` | پاک کردن لاگ؛ فایل جاری rotate می‌شود و حذف نمی‌شود |
| `GET` | `/api/logs/stream` | SSE ورودی‌های جدید (`snapshot`، `entry`، `cleared`) |
| `GET` | `/api/logs/download` | دانلود کل فایل JSONL |
| `GET` | `/api/system` | CPU، حافظه، دیسک، runهای در حال اجرا و در صف، پردازه‌های پس‌زمینه و هشدارها (P1-07) |
| `POST` | `/api/system/processes/:id/stop` | توقف یک پردازهٔ پس‌زمینه |
| `GET` | `/api/snapshots` | تسک‌های ثبت‌شده با snapshot گیت (P3-09)، با `projectId` اختیاری؛ پروژهٔ بدون git پاسخ `409 NOT_A_REPOSITORY` |
| `GET` | `/api/snapshots/:runId` | فایل‌های تغییرکردهٔ یک تسک `{status, path}` و patch آن |
| `POST` | `/api/snapshots/:runId/revert` | برگرداندن کل تسک `{projectId?, force?}`؛ فایلی که بعد از تسک دوباره تغییر کرده `409 SNAPSHOT_CONFLICT` با فهرست `conflicts` می‌دهد مگر `force: true` |
| `POST` | `/api/review` | بازبینی ساختاریافته (P3-08) `{projectId?, target: diff\|staged\|branch\|commit\|pr, ref?, base?, number?, focus?, post?}`؛ پاسخ `{summary, findings[], fix_task}` |
| `GET/POST` | `/api/terminal` | وضعیت و فهرست ترمینال‌ها / باز کردن ترمینال `{cols, rows}` |
| `GET` | `/api/terminal/:id/stream` | SSE خروجی (`snapshot` با scrollback، `output`، `exit`) |
| `POST` | `/api/terminal/:id/input` و `/resize` | ورودی صفحه‌کلید `{data}` / تغییر اندازه `{cols, rows}` |
| `DELETE` | `/api/terminal/:id` | بستن ترمینال |
| `GET/POST/DELETE` | `/api/files` | فهرست پوشه (`path`) / ساخت `{path, type: file\|directory}` / حذف (`recursive=1` برای پوشه) |
| `GET/PUT` | `/api/files/content` | خواندن / ذخیرهٔ atomic `{path, content, expected_mtime_ms}`؛ اگر فایل در این فاصله تغییر کرده باشد `409` |
| `POST` | `/api/files/rename` | تغییر نام یا جابه‌جایی `{from, to}` |
| `GET` | `/api/files/download` | دانلود فایل |
| `PUT` | `/api/files/upload?path=&overwrite=1` | آپلود مستقیم: بدنهٔ خام درخواست (هر نوع فایل، متنی یا باینری) در `path` ذخیره می‌شود؛ streaming و atomic (فایل موقت + rename). اگر فایل وجود داشته باشد `409` با `exists: true`، مگر با `overwrite=1`. سقف حجم `CONSOLE_FILE_UPLOAD_MAX_BYTES` (پیش‌فرض ۵۰MB)؛ بیشتر از آن `413` و هیچ فایلی باقی نمی‌ماند |

همهٔ مسیرهای `/api/files` پارامتر اختیاری `projectId` را می‌پذیرند (ریشهٔ همان پروژه)؛ هیچ مسیری، حتی از طریق symlink، از ریشه خارج نمی‌شود.

### ابزارهای کار سریع در پنل

این بخش‌ها فقط در مرورگر کار می‌کنند و API تازه‌ای ندارند:

- **منوی بالای پنل** بر اساس کاربرد و اهمیت در چهار گروه چیده شده است. در منوی کشویی موبایل هر گروه یک عنوان کوچک دارد و در دسکتاپ گروه‌ها با خط عمودی جدا می‌شوند:
  - **Work:** Commands، History، Templates، Files، Terminal
  - **Monitor:** Plan، Execution، Events، Logs، System
  - **Configure:** Settings، LLM settings، MCP، Notify
  - **Account:** Sign out
- **پالت فرمان:** با `Ctrl+K` (یا `Cmd+K`) یا از نوار ناوبری باز می‌شود و همهٔ نماها، پنجره‌ها و کارها را جست‌وجو می‌کند.
- **دستورهای `/` در کادر پیام:**
  - دستورهای داخلی `/raw` (نمایش متن خام یا Markdown) و `/templates`
  - promptهای سرورهای MCP به شکل `/server:prompt`
  - قالب‌های ذخیره‌شده به شکل `/tpl:<نام>`
  - ماژول‌های دیگر با `registerCommandProvider` دستور اضافه می‌کنند.
- **قالب‌های تسک:** شرح تسک‌های پرتکرار در `localStorage` همان مرورگر ذخیره می‌شود. جست‌وجو، ویرایش و حذف (با تأیید) دارد و با JSON وارد و صادر می‌شود. در ورود قالبی با نام تکراری، بین بازنویسی و رد کردن انتخاب می‌کنید.
  - **قالب‌های نمونه:** در اولین بازدید هر مرورگر شش قالب آماده اضافه می‌شود: Fix failing tests، Review changes، Add tests for a module، Explain the codebase، Refactor safely و Security audit. هر کدام mode و effort مناسب خودش را دارد (مثلاً بازبینی و ممیزی امنیتی در `plan` و فقط‌خواندنی). این‌ها قالب معمولی‌اند و ویرایش یا حذف می‌شوند. قالب حذف‌شده دوباره برنمی‌گردد (کلید `structured-ai.taskTemplates.samplesSeeded`). دکمهٔ **Samples** در پنجرهٔ Templates فقط نمونه‌های جاافتاده را اضافه می‌کند و به قالبی با همان نام دست نمی‌زند.
- **ردیف زیر کادر پیام:** به ترتیب **Mode** (auto / prompt / deny / plan)، **Changes** و **Review**. سوییچ **Raw** (نمایش متن خام یا Markdown پاسخ‌ها) کنار Effort و Cap $ در **Options** است.
- **Discussion** در یک پنجرهٔ جدا اجرا می‌شود: موضوع، persona و تعداد دورها در همان‌جا انتخاب می‌شود و گفتگوی زنده همان‌جا نمایش داده می‌شود.
- **ویرایش فایل** در پنجره‌ای جدا از فهرست فایل‌ها انجام می‌شود. ساخت، تغییر نام، حذف و تعارض ذخیره با دیالوگ‌های داخل پنل پرسیده می‌شوند، نه `confirm()` مرورگر.
- **آپلود در Files:** دکمهٔ **⇪ Upload** در نوار ابزار Files یک یا چند فایل از هر نوعی را در پوشهٔ فعلی آپلود می‌کند. کشیدن و رها کردن فایل روی فهرست هم همین کار را می‌کند. فایل‌ها یکی‌یکی و به‌صورت خام با `PUT /api/files/upload` فرستاده می‌شوند و پیشرفت و خطاها زیر نوار ابزار نمایش داده می‌شوند. اگر نامی از قبل وجود داشته باشد، پیش از جایگزینی تأیید گرفته می‌شود.

### API پروژه‌ها

| روش | مسیر | توضیح |
|---|---|---|
| `GET` | `/api/projects` | فهرست پروژه‌های ثبت‌شده، با فیلتر token |
| `POST` | `/api/projects` | ثبت پروژه با `rootPath` و permissionهای آن |
| `GET/POST` | `/api/project-clones` | ریشهٔ پروژه‌ها و jobهای clone / ساخت پروژه از git URL با `{url, branch, shallow, folder, name, secret}` (P1-02)؛ پاسخ `202 {job}`، پوشهٔ موجود `409`. token از secret نام‌برده، سپس `GIT_CLONE_TOKEN`، سپس `GITHUB_PAT`/`GITLAB_TOKEN` خوانده و فقط به‌صورت header به git داده می‌شود. فقط tokenی که به همهٔ پروژه‌ها دسترسی دارد |
| `GET` | `/api/project-clones/:id` | پیشرفت clone (`phase`، `percent`، خروجی git) و پروژهٔ ثبت‌شده پس از پایان |
| `GET/PATCH/DELETE` | `/api/projects/:projectId` | دریافت، ویرایش یا حذف یک registry record |
| `GET` | `/api/projects/:projectId/state` | snapshot محدود به همان پروژه |
| `GET` | `/api/projects/:projectId/events` | event stream پروژه‌ای |
| `GET` | `/api/projects/:projectId/sessions` | sessionهای همان پروژه |
| `POST` | `/api/projects/:projectId/tasks` یا `/chat` | اجرای task با پاسخ `202 {accepted, project_id}`؛ اگر پروژه مشغول باشد پیام در صف نوبت بعد می‌نشیند: `202 {queued:true, queued_message, queue_length}` (با `queue:false` یا `PROJECT_QUEUE_MAX=0` همان `409` تاریخی؛ صف پر: `429 PROJECT_QUEUE_FULL`) |
| `POST` | `/api/projects/:projectId/cancel` | لغو فقط runهای همان پروژه؛ صف پیام‌ها پاک نمی‌شود و فقط متوقف (paused) می‌شود مگر بدنه `{clear_queue:true}` باشد (پاسخ: `queue_cleared`) |
| `GET` | `/api/projects/:projectId/run` | وضعیت گفتگوی پروژه: `status`، `task`، `background`، `turn_id`، `pending_approvals`، `queue_length`، `queue_paused` |
| `GET/POST/DELETE` | `/api/projects/:projectId/queue` | صف پیام‌های نوبت بعد: خواندن، افزودن (`text`، اختیاری `reasoning_effort`؛ پروژهٔ بیکار فوراً شروع می‌کند) و پاک‌کردن کامل |
| `PATCH/DELETE` | `/api/projects/:projectId/queue/:itemId` | ویرایش متن یا حذف یک پیام صف |
| `POST` | `/api/projects/:projectId/queue/resume` | ادامهٔ صفی که با Stop متوقف شده |
| `POST` | `/api/projects/:projectId/correction` | پیام اصلاحی وسط اجرا: پیش از قدم بعدی مدل تزریق و در journal ثبت می‌شود (`run:correction`)؛ اگر run تمام شده باشد به صف یا اجرای جدید می‌رود |
| `POST` | `/api/projects/:projectId/clear` | شروع دوبارهٔ گفتگوی همان پروژه (بدون اثر روی گفتگوهای دیگر) |
| `GET` | `/api/conversations` | یک خط برای هر گفتگوی زنده (پیش‌فرض و هر پروژه): وضعیت، approvalهای منتظر، طول صف؛ همین خلاصه با پیام `{type:"conversations"}` روی هر event stream هم ارسال می‌شود |
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
* `POST /api/mcp/:name/reconnect` — اتصال دوباره (همان دکمهٔ Reconnect)

#### کاتالوگ، secretها و پیش‌نیازها

زبانهٔ **Catalogue** فهرست سرورهای آماده (`agent/registry/mcp_catalog.json`) را با نسخهٔ pin‌شده، پیش‌نیازها و سطح اعتماد نشان می‌دهد. **Activate** فرم توکن را باز می‌کند؛ توکن در secret store رمزنگاری‌شده (`<data home>/secrets.enc`، AES-256-GCM) ذخیره می‌شود، config با ارجاع `${secret:NAME}` در `<data home>/mcp.json` (سراسری یا فقط برای پروژهٔ جاری) نوشته می‌شود، سرور وصل و ابزارهایش فهرست می‌شوند. اگر اتصال شکست بخورد config و secret تازه برگردانده می‌شوند. **Deactivate** config را برمی‌گرداند و می‌تواند secretی را که دیگر استفاده نمی‌شود پاک کند.

* `${secret:NAME}` فقط در config اپراتور (registry، `<data home>/mcp.json`، `MCP_SERVERS` و افزودن از کنسول) پذیرفته می‌شود؛ در فایل‌های مخزن، `mcp_add` و config ورک‌اسپیس رد می‌شود.
* مقدار secretها هرگز از API برنمی‌گردد و در لاگ، journal و پاسخ‌های API ماسک می‌شود. هیچ ابزار agent آن را نمی‌خواند و ابزارهای فایل به `secrets.enc`/`secrets.key` دسترسی ندارند.
* پیش از هر اتصال، npx/uvx/python و Chromium بررسی می‌شوند و نبودشان با راهنمای نصب گزارش می‌شود (کد 412). Chromium را می‌توان با یک کلیک (`playwright-mcp install-browser chromium`) نصب کرد و پیشرفتش را دید.
* اگر سرور به‌طور غیرمنتظره قطع شود، با backoff نمایی دوباره وصل می‌شود (`MCP_RECONNECT_*`)؛ وضعیت و آخرین خطا کنار هر سرور و در لاگ سراسری (`source=mcp`) دیده می‌شود.

#### تکمیل MCP (گروه ۶ نقشهٔ راه)

* **Import:** config کلاینت‌های دیگر را paste کنید؛ پیش‌نمایش نشان می‌دهد کدام سرور تازه، یکسان، متعارض یا نامعتبر است. برای هر تعارض skip، replace یا نام تازه انتخاب می‌شود. JSONC (کامنت و ویرگول آخر) و `${input:…}` پذیرفته و گزارش می‌شوند.
* **بارگذاری تنبل ابزارها:** `MCP_TOOL_LOADING` (`auto`/`eager`/`lazy`) و `MCP_TOOL_DEFINITIONS_BUDGET`. ابزارهایی که در سقف جا نشوند با نام و یک خط در context می‌آیند و agent با `mcp_search_tools` تعریف کاملشان را می‌گیرد و با `mcp_call` صدا می‌زند.
* **کنترل هر ابزار:** کلید روشن/خاموش هر ابزار، تأیید جدا برای ابزارهای فقط‌خواندنی (`readOnlyHint`) و نویسنده، و محدود کردن سرور به چند agent (`agents`) یا پروژه. ابزار خاموش از فهرست مدل حذف و فراخوانی مستقیمش رد می‌شود.
* **OAuth 2.1:** برای سرورهای راه دور با `oauth: true` (یا `{client_id, client_secret, scopes, authorization_server}`): کشف از `WWW-Authenticate`/`.well-known`، ثبت پویای client، PKCE، ذخیرهٔ token در secret store، refresh خودکار پیش از انقضا و پس از 401. دکمهٔ **Sign in** کنار سرور.
* **ساخت سرور توسط agent:** `mcp_build` یک سرور Node یا Python بدون وابستگی در `.agent/mcp-servers/<name>/` می‌سازد (یا از یک سند OpenAPI)، ثبت و بی‌ری‌استارت بارگذاری می‌کند؛ پس از ویرایش `tools.js` با `action: reload` دوباره بالا می‌آید.
* **پروتکل کامل:** resourceها و promptها هم ابزار agent‌اند (`mcp_resources`، `mcp_prompts`) و هم در پنل؛ promptها با تایپ `/` در کادر پیام دستورند. سؤال سرور (elicitation) در پنجره‌ای در کنسول پرسیده می‌شود (بدون کنسول فوراً cancel)، پیشرفت فراخوانی‌ها کنار سرور دیده می‌شود، و sampling فقط با `MCP_SAMPLING_ENABLED` و `sampling: true` سرور و در بودجهٔ `MCP_SAMPLING_BUDGET_TOKENS` مجاز است.
* **structured-ai به‌عنوان سرور MCP:** `POST /mcp` روی کنسول، یا برای کلاینت‌های stdio: `AGENT_CONSOLE_TOKEN=<token> agent mcp-serve http://host:7777`. token پروژه فقط پروژهٔ خودش را می‌بیند. خاموش کردن: `MCP_SERVE_ENABLED=false`.
* **Registry:** زبانهٔ **Registry** در MCP registry رسمی جست‌وجو می‌کند؛ هشدار «بررسی‌نشده» پیش از نتایج می‌آید، افزودن تأیید صریح می‌خواهد و سرور با trust `restricted` (هر فراخوانی تأیید) اضافه می‌شود.

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
- skill با فرمت استاندارد `SKILL.md` (front matter با `name`، `description`،
  و اختیاری `triggers` و `mcp_server`) از `.agent/skills/<dir>/` و
  `.claude/skills/<dir>/` پروژه، `<data home>/skills/<dir>/` و
  `agent/skills/<dir>/` خوانده می‌شود؛ بقیهٔ فایل‌های پوشه منابع آن‌اند و
  تغییرها بدون ری‌استارت دیده می‌شوند. نام skillهای registry قابل جایگزینی
  نیست. `` !`command` `` در متن skill هنگام `skill_get` با خروجی دستور جایگزین
  می‌شود، فقط برای دستورهای فقط‌خواندنی و skillهای خود سرور یا workspace
  مورد اعتماد (`SKILL_COMMANDS`).
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
