# پلن Reactive کردن پنل وب (`web/public`)

> **وضعیت پیاده‌سازی (۲۰۲۶-۱۱-۲۵):** فازهای ۰ تا ۷ پیاده شده‌اند و باگ‌های B1 تا B18 هر کدام تست دارند (`test/ui/reactive.test.js`).
> تفاوت‌ها با این طرح:
> - ماژول‌ها به‌جای پوشه‌های `lib/`، `ui/` و `views/` در همان `web/public/app/` قرار گرفتند. فایل‌های موجود بازنویسی شدند، هم برای اینکه فهرست ماژول‌های `modules.test.js` حفظ شود و هم طبق قاعدهٔ «ویرایش فایل موجود» در CLAUDE.md.
> - `console.js` حذف نشد. این فایل اکنون یک کنترلر ESM است که رویدادها و درخواست‌ها را به store و viewها وصل می‌کند. `rollout.contract` وجودش را لازم می‌داند.
> - به‌جای تست تفاضلی با legacy، ۴۵ سناریوی `ui.test.js` روی DOM واقعی و تست‌های رفتاری و ایستای `reactive.test.js` معیار قرار گرفتند. fixture نسخهٔ legacy حذف شد.
> - stubهای قدیمی `api.js`، `event-stream.js`، `task-runner.js`، `modal-manager.js` و `project-state.js` حذف شدند. `rollout.contract` جلوی برگشتنشان را می‌گیرد.
> - `console.js` به ۱۲ ماژول جدا برای هر بخش (`console-core.js`، `*-controller.js`، `project-*.js`) شکسته شد و فقط اتصال کنترل‌های صفحه در آن ماند. هیچ ماژولی بیش از ۵۰۰ خط ندارد و یک تست جلوی import حلقوی را می‌گیرد.
> - ردیف پنهان `#rowTwo` حذف شد. Execution و Events دیگر نسخهٔ صفحه ندارند و فقط وقتی مودالشان باز است رسم می‌شوند.
> - تست‌های UI به گروه‌های جدا در `test/ui/scenarios/` تقسیم شدند (همان ترتیب و همان خروجی)، و `app.css` به یک فایل پایه و پنج فایل در `web/public/styles/` که به همان ترتیب لینک می‌شوند.
> - سرور: `web/server/ServerImplementation.js` (۳۵۳۶ خط) شکسته شد. مسیرهای API در هفت گروه مرتب در `web/server/routes/` قرار گرفتند و handler آن‌ها را به همان ترتیب صدا می‌زند. state و helperهای closure در factoryهای `web/server/console/` هستند و سرو فایل‌های ایستا، همراه با `MIME`، در `console/static-files.js`. کد منتقل‌شده token به token با نسخهٔ قبل یکی است.
> - Projects manager و فرم New Project هنوز به‌صورت imperative ساخته می‌شوند، ولی خطاهای آن‌ها گزارش می‌شود.
> - کارایی: replay یک snapshot با ۵۰۰ رویداد روی happy-dom حدود ۲۴۰ms طول می‌کشد، در برابر حدود ۶۰۰۰ms در نسخهٔ legacy. خود reduce حدود ۲ms است و بقیه هزینهٔ DOM شبیه‌سازی‌شده است. سقف تست ۱۵۰۰ms گذاشته شد تا CI ناپایدار نشود.


> وضعیت اولیهٔ این سند: پیشنهاد، پیش از هر تغییری در کد.
> پایهٔ بررسی: commit `2f8b236` روی `main`.
> دامنه: فقط فرانت‌اند کنسول وب (`web/public/**`) و تست‌های آن. API سرور و قرارداد رویدادها تغییر نمی‌کنند.

---

## ۰. خلاصهٔ اجرایی

| موضوع | پیشنهاد |
|---|---|
| کتابخانهٔ رندر | **Preact 10.29.8 + htm 3.1.1** (سینتکس شبیه JSX با tagged template، بدون build) |
| لایهٔ reactivity | **@preact/signals-core 1.14.5** (نه `@preact/signals`) |
| نحوهٔ بارگذاری | فایل‌های ESM محلیِ vendor‌شده در `web/public/vendor/`؛ **بدون CDN، بدون import map، بدون bundler** (هیچ‌کدام از این سه فایل import خارجی ندارند) |
| حجم | حدود ۷.۵KB gzip در مجموع (preact ≈ 4.9KB، signals-core ≈ 2.1KB، htm ≈ 0.7KB) |
| مدل رندر | یک store واحد مبتنی بر signal ← reducer خالص ← effectهای جدا ← viewهایی که با `render()` سطح‌بالای Preact داخل `effect()` **همگام (synchronous)** mount می‌شوند |
| استراتژی مهاجرت | strangler تدریجی، یک view در هر PR، با **تست تفاضلی (differential)**: نسخهٔ legacy و نسخهٔ جدید روی یک سناریوی رویداد یکسان اجرا و DOM آن‌ها مقایسه می‌شود |
| محیط تست | `happy-dom` (به‌عنوان devDependency) به‌جای shim دست‌ساز فعلی |

دلیل اصلی: کنسول امروز ۶۷۶۳ خط کد imperative در `app/console.js` است که با هر رویداد بخش‌های کاملی از DOM را از نو می‌سازد. بخشی از state هم فقط در خود DOM نگه داشته می‌شود. این دو باعث از دست رفتن فیلترها، فرم‌های نیمه‌پر، وضعیت باز/بسته‌ها و فوکوس می‌شوند. replay یک snapshot هم هزینهٔ O(n²) دارد. Preact+htm diff کلیددار (keyed) و escape پیش‌فرض می‌دهد و بدون build کار می‌کند. signals-core هم reactivity همگام و قطعی می‌دهد، چیزی که هم تست‌ها و هم پردازش SSE به آن نیاز دارند.

---

## ۱. وضعیت فعلی (یافته‌های بررسی)

### ۱.۱ فایل‌ها

| فایل | خط | نقش واقعی |
|---|---:|---|
| `index.html` | 184 | پوستهٔ صفحه: همهٔ idها، ردیف مخفی `#rowTwo` (Execution/Events)، `#policyHome`، فرم ورود، داشبورد پروژه |
| `modal.js` | 387 | سرویس `Modal` (اسکریپت classic، global، با خروجی CommonJS برای تست). پشته، Escape، backdrop، بازگرداندن فوکوس |
| `auth-gate.js` | 61 | بررسی `/auth/status` ← فرم ورود یا `import("/app/main.js")` |
| `app/main.js` | 67 | ورودی ESM. ماژول‌های Phase 24 را import می‌کند و بعد `import "./console.js"` را صرفاً برای side effectهایش اجرا می‌کند |
| **`app/console.js`** | **6763** | **renderer واقعی و تنها منبع رفتار**. اسکریپت classic است (بدون import/export) و تست‌ها آن را با `require()` بار می‌کنند |
| `app/store.js` و `chat.js`، `execution-view.js`، `event-view.js`، `settings-view.js`، `mcp-view.js`، `history-view.js`، `plan-view.js`، `project-view.js`، `*-state.js`، `api.js`، `event-stream.js`، `task-runner.js`، `markdown.js` و غیره | 9 تا 241 | **اسکلت/کد مرده**. `main.js` یک `store` و `eventStream` می‌سازد ولی `connect()` هرگز صدا زده نمی‌شود. reducerِ `store.js` با `apply()` در console.js **هم‌خوان نیست**. مثلاً `agent:response` را پیام چت حساب می‌کند و plan را جور دیگری می‌خواند. نسخهٔ `markdown.js` هم فقط `textContent` است |
| `app.css` | 1839 | تمام کلاس‌هایی که JS می‌سازد به آن‌ها وابسته‌اند |

### ۱.۲ جریان داده امروز

```
auth-gate.js ─► import /app/main.js ─► import ./console.js (side effects)
   console.js:  connect()  ─► EventSource(/api/events[?projectId])
                 onmessage ─► snapshot ? applySnapshot(s) : apply(event)
                 apply()    ─► mutate global `state`  ─►  renderTree()/renderChat()/renderPlan()/log()/... (DOM مستقیم)
   + loadSettings() و initProjects() در بوت، و listenerهای تک‌تک دکمه‌ها با el("id")
```

### ۱.۳ مشکل state

- شیء سراسری `state` (حدود ۶۰ فیلد، خط 21 تا 79) چهار نوع چیز را با هم قاطی کرده است:
  - **دادهٔ دامنه**: agents، graphs، calls، messages، events، plan، approvals، discussion، settings، projects
  - **state رابط کاربری**: logFilter، mcpTab، openExecutionKeys، dashboard، taskScopeMode
  - **handleها**: modalها، تایمرها، eventSource
  - **فلگ‌های in-flight**: historyOpening، mcpOpening، stopPending
- **بخشی از حقیقت فقط در DOM است:**
  - لاگ رویدادها: ردیف‌ها، `dataset.text`، سقف 400 ردیف در خود DOM، و لیست typeها که از روی `list.children` ساخته می‌شود (`log()`، `logTypesPresent()`)
  - آرشیو اجرا: گره‌های DOM جابه‌جا می‌شوند (`archiveCurrentExecution()`)
  - نمای زندهٔ discussion: فقط append می‌شود
  - وضعیت باز بودن `<details>`ها در plan و thinking
  - متن فیلتر Settings
- دو مسیر state موازی وجود دارد: `state` در console.js و `store.js`. اگر کسی `store.js` را هم وصل کند، دو منبع حقیقت خواهیم داشت.

### ۱.۴ الگوهای رندر و هزینه‌شان

| تابع (خط) | راهبرد | محرک | پیامد |
|---|---|---|---|
| `renderTree` (364) | `innerHTML=""` و بازسازی کامل | تقریباً هر رویداد agent/tool/hook | O(n) DOM به ازای هر رویداد. scroll داخل modal می‌پرد |
| `renderPlan` (605) | بازسازی کامل | هر رویدادی که فیلد `plan` دارد | فازی که کاربر باز کرده دوباره بسته می‌شود |
| `renderChat` (1017) | بازسازی کامل + وصلهٔ `openExecutionKeys` | `session:message`، `request:start/end`، `run:status` | thinkingها همیشه `open=true` می‌شوند و collapse کاربر از بین می‌رود. اجباراً به انتهای چت scroll می‌کند. selection متن از بین می‌رود |
| `refreshTurnExecution` (1331) | وصلهٔ درجا با querySelector | رویدادهای tool/iteration | اولین تلاش دستی برای «reactive». شکننده است |
| `log` (3884) | append و DOM به‌عنوان حقیقت | همهٔ رویدادها | فیلتر/شمارش از روی DOM محاسبه می‌شود |
| `loadSettings` (5248) | `setBody` کامل modal | `settings:changed` و بعد از هر ذخیره | متن فیلتر، scroll، فوکوس و ورودی‌های ذخیره‌نشده از بین می‌روند |
| `openMcp().refresh` (2501) | `setBody(mcpBody(...))` کامل | Enable/Disable/Remove/Save/Reconnect | فرم «Connect a server» و پیش‌نویس Raw JSON ذخیره‌نشده پاک می‌شوند |
| `applySnapshot` (4758) | برای هر رویداد `apply(e)` صدا می‌زند | هر (باز)اتصال SSE | با `MAX_CONSOLE_EVENTS=500`، تا ۵۰۰ بار بازسازی کامل tree/chat و **side effectها** را دوباره اجرا می‌کند (بند ۱.۶) |
| `borrow()` (3215) و policy borrow (4863) | جابه‌جا کردن گره‌های زنده بین صفحه و modal | باز/بسته شدن modal | پیچیده و پرباگ (توضیح خود کد دربارهٔ باگ قبلی `#rowTwo`). در معماری reactive دیگر لازم نیست |

### ۱.۵ تست‌های موجود (همه سبز: ui 45/45، modules 10/10، web 30/30، navigation)

- `test/ui/ui.test.js` (2927 خط) روی یک **DOM shim دست‌ساز** اجرا می‌شود. این shim text node و comment node ندارد. `querySelectorAll("bubble")` را بر اساس نام کلاس و بدون نقطه جست‌وجو می‌کند و `querySelector` فقط با نام تگ کار می‌کند. یعنی **هیچ فریم‌ورکی روی آن اجرا نمی‌شود** و خود تست‌ها به این رفتارهای غیراستاندارد وابسته‌اند.
- تست‌ها **همگام** هستند: بلافاصله بعد از `send(event)` روی DOM assert می‌کنند. به **ساختار DOM** هم وابسته‌اند، مثلاً `bubble.children[0].tagName === "DETAILS"` و `bubble.children[1].children[0].tagName === "H1"`. همچنین **هویت گره** را چک می‌کنند ("the waiting timer rebuilt the conversation").
- `test/ui/modules.test.js`: فهرست ماژول‌ها، اینکه هر idِ خوانده‌شده در `console.js` در `index.html` وجود داشته باشد، نبودِ id تکراری، و syntax check به‌صورت `.mjs`.
- `test/web/console-navigation.test.js` **متن سورس** بین `function navigateConsole(` و `function projectById(` را برش می‌زند. با جابه‌جایی کد می‌شکند.
- `test/contracts/rollout.contract.test.js` وجود `web/public/app/console.js` را الزامی می‌داند.
- `test/web/web.test.js` سرو شدن `/app/main.js`، `/modal.js` و `/auth-gate.js` را چک می‌کند.
- **امکان‌سنجی انجام شد:** همین `console.js` legacy روی `happy-dom` با `index.html` واقعی بدون تغییر بالا آمد. bubble با `dir=rtl` و `<h1>`، ردیف tool در tree، ردیف‌های لاگ و status=running همه درست بودند. پس می‌توان پیش از هر تغییری روی DOM واقعی شبکهٔ ایمنی ساخت.

### ۱.۶ باگ‌ها و ریسک‌های موجود که در بررسی پیدا شدند

> هر مورد باید در فاز مربوط **عمداً** یا «حفظ» شود یا «اصلاح». بازنویسی نباید بی‌صدا رفتار را عوض کند (بند ۹).

| # | محل | شرح |
|---|---|---|
| B1 | submit فرم task (6418 به بعد) | `setStatus("running")` و بعد `await fetch` **بدون try/catch**. با خطای شبکه، دکمه‌ها در حالت running قفل می‌مانند تا snapshot بعدی |
| B2 | submit discussion | همین مشکل. `runButton.disabled=true` ممکن است برنگردد |
| B3 | `answerApproval` (3627) و `approveAll` (3641) | حذف optimistic بدون rollback در صورت شکست POST. در `approveAll` یک شکست باقی ارسال‌ها را رها می‌کند |
| B4 | `renderApprovals` (3473) | اگر کاربر modal تأیید را ببندد، رویداد approval بعدی آن را دوباره باز می‌کند. **باید روشن شود عمدی است یا نه** |
| B5 | `loadSettings` (5248) | بازسازی کامل modal باعث از دست رفتن فیلتر، فوکوس، scroll و ورودی تایپ‌شده می‌شود (هم Settings هم LLM settings) |
| B6 | MCP (2183، 2422، 2501) | refresh فرم افزودن سرور و پیش‌نویس JSON را پاک می‌کند. `load()` مقدار `response.ok` را چک نمی‌کند. Enable/Remove مدیریت خطا و غیرفعال‌سازی حین درخواست ندارند |
| B7 | `renderPlan` (605) | باز/بسته بودن فازها با هر به‌روزرسانی ریست می‌شود |
| B8 | `apply` و `applySnapshot` | replay برابر است با N بار بازسازی کامل، یعنی O(n²) |
| B9 | `renderChat` و `bubble` (1785) | scroll اجباری به پایین حتی وقتی کاربر بالا را می‌خواند. thinkingهای بسته‌شده دوباره باز می‌شوند |
| B10 | `clearLog` (6669) | فقط DOM لاگ پاک می‌شود و `state.events` (سقف 5000) دست نمی‌خورد. ناسازگار است ولی بی‌خطر |
| B11 | `renderDashboardBody` (5844) | async و **بدون لغو**. اگر سریع بین تب‌ها جابه‌جا شوید، پاسخ قدیمی محتوای تب جدید را بازنویسی می‌کند (race) |
| B12 | `applySnapshot` | replay **side effectها را دوباره اجرا می‌کند**: `session:switched` ← `refreshSession` (fetch)، `settings:changed` ← `loadSettings`، `run:status` ← `drainProjectTaskQueue`، و `request:start` تایمر می‌سازد |
| B13 | Discussion (3055 و 2741) | نمای زنده تصمیم‌های observer را بین پیام‌ها و به ترتیب رسیدن append می‌کند، ولی نمای history اول همهٔ roundها و بعد همهٔ تصمیم‌ها را نشان می‌دهد. با باز کردن دوبارهٔ modal ترتیب عوض می‌شود |
| B14 | صف چندپروژه‌ای (5633، 5648) | SSE فقط به `ids[0]` وصل است. سرور (`EventProjector.visibleOnProjectStream`) و کلاینت (`eventVisibleForCurrentProject`) رویدادهای پروژه‌های دیگر را حذف می‌کنند، پس `run:status`ِ پروژهٔ دوم به بعد احتمالاً هرگز نمی‌رسد و status/صف گیر می‌کند. **نیاز به تأیید در محیط واقعی دارد** |
| B15 | `approvalMode` و `autoContinue` | fire-and-forget هستند. اگر سرور رد کند، UI مقدار اشتباه را تا اتصال مجدد نشان می‌دهد |
| B16 | `clearButton` و «New conversation» در History | مدیریت خطا ندارند. «0 turns» بدون شرط نوشته می‌شود |
| B17 | سرور: `MIME` در `ServerImplementation.js` (اکنون `web/server/console/static-files.js`) | پسوند `.mjs` در نگاشت MIME نیست و به‌صورت `application/octet-stream` سرو می‌شود، که مرورگر برای module script رد می‌کند. فایل‌های vendor باید با پسوند `.js` ذخیره شوند |
| B18 | `store.js` و `main.js` | state موازی و استفاده‌نشده با reducer واگرا |

---

## ۲. انتخاب کتابخانه

### ۲.۱ معیارها (به ترتیب اهمیت)

1. بدون build: ESM بومی مرورگر، قابل vendor کردن محلی (کنسول یک control plane است و ممکن است بدون اینترنت اجرا شود)
2. **رندر همگام و قطعی**: تست‌ها همگام‌اند و هر پیام SSE باید پیش از پیام بعدی روی صفحه باشد
3. diff کلیددار با حفظ هویت گره (برای فوکوس، selection، `<details>` و scroll)
4. escape پیش‌فرض و بدون `innerHTML`، بدون نیاز به `unsafe-eval` (برای CSP آینده)
5. اجرا در DOM تستیِ Node
6. کوچک، بالغ، پرکاربر، با مسیر مهاجرت آسان به build در آینده

### ۲.۲ مقایسه

| گزینه | بدون build | رندر همگام | diff کلیددار | CSP-safe | حجم gzip | ارزیابی |
|---|---|---|---|---|---|---|
| **Preact 10 + htm + signals-core** | ✅ (سه فایل بدون import) | ✅ `render()` سطح‌بالا داخل `effect()` | ✅ | ✅ | ~7.5KB | **پیشنهاد اول** |
| lit-html 3 | ✅ | ✅ `render()` همگام است | ✅ (`repeat`) | ✅ | ~3.2KB | گزینهٔ دوم و خیلی خوب. در linkedom کار نکرد (فقط happy-dom/jsdom). برای ساخت درخت‌های بازگشتی (markdown، execution tree) کمی کم‌انعطاف‌تر است |
| `@preact/signals` (نسخهٔ یکپارچه با Preact) | ⚠️ import‌های bare، پس import map لازم دارد | ❌ در آزمایش، به‌روزرسانی DOM فقط بعد از `setTimeout` دیده شد | ✅ | ✅ | +1.8KB | استفاده نشود. signals-core کافی است |
| Alpine.js | ✅ | ❌ (`nextTick`) | ضعیف | ❌ (`new Function`؛ نسخهٔ CSP محدود است) | ~15KB | برای ۶۷۰۰ خط منطق imperative، markdown و درخت بازگشتی مناسب نیست. تست در Node هم سخت است |
| petite-vue | ✅ | ❌ | ✅ | ❌ | ~7KB | از ۲۰۲۲ نگهداری نمی‌شود. رد شد |
| Vue 3 (ESM browser build) | ✅ | ❌ (`nextTick`) | ✅ | ❌ با compiler زمان اجرا | ~40KB+ | برای این حجم کار بیش از حد سنگین است |
| Solid + `solid-js/html` | ✅ | ✅ | ✅ | ✅ | ~8KB | مسیر tagged-template آن مسیر دست‌دوم است و مستندات و جامعهٔ کمی دارد |
| VanJS | ✅ | ❌ (batch با setTimeout) | ❌ | ✅ | ~1KB | لیست کلیددار ندارد و برای چت و لاگ ضعیف است |
| نوشتن signal و reconciler دست‌ساز | ✅ | ✅ | باید نوشته شود | ✅ | — | ساختن reconciler همان جایی است که باگ تولید می‌شود. رد شد |

### ۲.۳ شواهد آزمایشی (در sandbox و خارج از repo)

- Preact 10.29.8 + htm + signals-core روی happy-dom:
  - تغییر signal در همان tick DOM را به‌روز کرد (`sync bubbles: 2`)
  - هویت گره حفظ شد (`identity: true`)
  - `<details>` که کاربر بسته بود بسته ماند
  - `batch()` چند تغییر را به یک رندر تبدیل کرد
  - رشتهٔ `<img onerror>` به‌صورت متن escape شد
- `@preact/signals` (یکپارچه با کامپوننت) در Preact 11 به‌روزرسانی را async انجام داد (`sync: 0`، `microtask: 0`، `timeout: 5`). به همین دلیل signals-core پیشنهاد شده است.
- `preact.module.js` (نسخهٔ 10)، `htm.module.js` و `signals-core.module.js` **هیچ import ندارند**، پس import map لازم نیست.
- Preact 11.0.0 در ۲۰۲۶-۰۹-۳۰ منتشر شده و جوان است. نسخهٔ **10.29.8** پیشنهاد می‌شود و ارتقا به 11 بعداً و جداگانه انجام شود. نسخهٔ 11 فقط فایل `.mjs` دارد (بند B17).
- `linkedom` setter برای `select.value` ندارد. کنسول این setter را زیاد استفاده می‌کند، پس linkedom رد شد و **happy-dom** پیشنهاد می‌شود.

---

## ۳. معماری هدف

### ۳.۱ ساختار پوشه‌ها

```
web/public/
  vendor/
    preact.module.js          # preact@10.29.8  dist/preact.module.js
    htm.module.js             # htm@3.1.1       dist/htm.module.js
    signals-core.module.js    # @preact/signals-core@1.14.5
    manifest.json             # نسخه، آدرس منبع، sha256 هر فایل
    LICENSES.md               # متن MIT هر سه کتابخانه
  app/
    main.js                   # بوت: ساخت store، اتصال stream، mount کردن viewها
    core/
      store.js                # signalها و action dispatcher (جایگزین store.js فعلی)
      reducers/               # توابع خالص per-domain: run, execution, conversation, log,
                              #   approvals, plan, discussion, session, project
      effects.js              # side effectهای «فقط live» (بند ۳.۳)
      actions.js              # همهٔ فراخوانی‌های API کاربر (submit, cancel, approve, ...)
      api.js                  # همان api.js با ApiError و مسیرهای نسبی
      event-stream.js         # EventSource و reconnect
      clock.js                # signal زمان، فقط وقتی لازم است tick می‌زند
    lib/                      # منطق خالص استخراج‌شده از console.js بدون تغییر رفتار
      markdown.js             # خروجی vnode، همان تگ‌ها و کلاس‌ها، و safeMarkdownHref
      direction.js  formatters.js  describe-event.js  execution-keys.js  intervals.js
      router.js               # parseProjectRoute, navigateConsole (برای تست navigation)
    ui/
      html.js                 # export const html = htm.bind(h)
      mount.js                # mount(container, view) / unmount
      modal-view.js           # openViewModal({ title, view, ... }) روی Modal موجود
    views/
      header.js  composer.js  chat.js  plan.js  execution.js  log.js  approvals.js
      settings.js  mcp.js  history.js  call-detail.js  discussion.js
      projects.js  dashboard.js
    console.js                # در پایان: facade نازک یا حذف (بند فاز ۷)
```

### ۳.۲ هستهٔ رندر همگام

```js
// ui/mount.js
import { render, h } from "../../vendor/preact.module.js";
import { effect } from "../../vendor/signals-core.module.js";

export function mount(container, View, select) {
  if (!container) return () => {};               // قرارداد فعلی: نبودِ container نباید throw کند
  const dispose = effect(() => {
    const props = select();                      // signalها فقط اینجا خوانده می‌شوند
    try { render(h(View, props), container); }
    catch (error) { reportViewError(View, error); } // خطای یک view نباید stream را بکشد
  });
  return () => { dispose(); render(null, container); };
}
```

- signalها **فقط در `select()`** خوانده می‌شوند و کامپوننت‌ها توابع خالص با props ساده هستند. چون Preact کامپوننت‌ها را همگام در `render()` اجرا می‌کند، اگر داخل کامپوننت `.value` خوانده شود وابستگیِ پنهان ساخته می‌شود. این کار ممنوع است.
- از hookهای state مثل `useState` برای state برنامه استفاده نمی‌شود، چون به‌روزرسانی‌شان async است. stateِ محلی رابط کاربری هم در signal نگه داشته می‌شود.
- هر پیام SSE داخل یک `batch()` پردازش می‌شود: reduce ← یک رندر همگام. snapshot هم یعنی reduce همهٔ رویدادها ← **یک** رندر.

### ۳.۳ reducer خالص و effectهای جدا

```js
// core/store.js
export const state = { run: signal(...), execution: signal(...), conversation: signal(...), log: signal(...),
                       approvals: signal(...), plan: signal(...), discussion: signal(...), session: signal(...),
                       projects: signal(...), ui: signal(...) };

export function dispatch(event, { live }) {
  if (!eventVisibleForCurrentProject(event)) return;
  batch(() => { for (const slice of SLICES) slice.signal.value = slice.reduce(slice.signal.value, event); });
  if (live) runEffects(event);        // refreshSession, loadSettings, drainQueue, timers
}
export function applySnapshot(snapshot) {
  batch(() => { resetAll(snapshot); for (const e of snapshot.events) if (e.type !== "session:message") dispatch(e, { live: false }); });
}
```

- reducerها **منطق `apply()` را خط به خط حفظ می‌کنند**: همان کلیدها (`${phase}:${id}` برای hook، `${agent}#${depth+1}` برای delegation)، همان وضعیت‌ها (`failed/exit/warned/done`)، همان سقف‌ها (events: 5000، log: 400، archive: 50).
- reducerها state جدید می‌سازند (immutable). Mapها با Map جدید جایگزین می‌شوند یا ساختار به آرایه/شیء ساده تغییر می‌کند. هیچ reducerی DOM یا fetch را لمس نمی‌کند.
- لاگ رویداد و آرشیو اجرا **به داده تبدیل می‌شوند**. آرشیو یعنی `{ task, summary, executionSnapshot }[]` با سقف ۵۰.
- رفع B12: در replay، `live=false` است و effectها اجرا نمی‌شوند.

### ۳.۴ modalها

`Modal` فعلی (`modal.js`) دست نمی‌خورد. adapter جدید یک container می‌سازد، view را در آن mount می‌کند و در `onClose` آن را unmount می‌کند:

```js
export function openViewModal({ title, subtitle, view, select, footer, ...rest }) {
  const body = document.createElement("div");
  const unmount = mount(body, view, select);
  return Modal.open({ title, subtitle, body, footer, ...rest, onClose: r => { unmount(); rest.onClose?.(r); } });
}
```

- در این مدل `borrow()` و policy borrow دیگر لازم نیستند. هر view هر جایی mount می‌شود و state مشترک دارد. **ولی** تا وقتی تست‌های borrow (بند ۱.۵) جایگزین نشده‌اند، مکانیزم borrow حفظ می‌شود. جابه‌جا کردن container ریشهٔ Preact بی‌خطر است.
- **id تکراری ممنوع است.** اگر view لاگ هم در `#rowTwo` و هم در modal mount شود، idهای `log`، `logFilter` و غیره تکراری می‌شوند. قاعده: هر view دارای id در هر لحظه فقط یک mount فعال دارد.

### ۳.۵ قواعد کدنویسی viewها

1. هیچ `innerHTML` یا `dangerouslySetInnerHTML`. markdown مستقیماً vnode تولید می‌کند (پورت `renderMarkdown` و `appendInlineMarkdown` با همان تگ‌ها، کلاس‌ها، `target=_blank` و `rel=noopener noreferrer` و همان `safeMarkdownHref`).
2. key پایدار: کلید پیام برای پیام‌ها (همان `messageExecutionKey` و `message_id`)، `scope` برای agent، `graph.id`، `call.id`، `seq` یا اندیس یکتا برای لاگ، و `phase.id` و `step.id` برای plan.
3. **ورودی‌های متنی uncontrolled** (task، فیلترها، فرم MCP، Raw JSON): مقدار با `onInput` در signal ذخیره می‌شود ولی `value` در هر رندر روی DOM نوشته نمی‌شود. این کار برای **IME فارسی** و جلوگیری از پرش مکان‌نما حیاتی است.
4. `<details>`: وضعیت open در state نگه داشته می‌شود و با `onToggle` sync می‌شود (`openExecutionKeys` و معادل آن برای plan، thinking و آرشیو).
5. جهت متن: همان `applyBubbleDirection`، یعنی `dir` و کلاس `rtl`/`ltr` روی bubble.
6. تایمرها: یک signal `clock` که فقط وقتی `status==="running"` یا `waiting!=null` است tick می‌زند. فقط گره‌های متنی `#runTimer` و زمان سپری‌شدهٔ bubble انتظار به آن وابسته‌اند، و این قرارداد «تایمر نباید چت را بازسازی کند» را حفظ می‌کند.
7. هر action شبکه‌ای این شکل را دارد: in-flight flag ← try/catch/finally ← rollback یا پیام خطا. این بند B1، B2، B3، B6، B15 و B16 را پوشش می‌دهد (اصلاح فقط با تأیید، بند ۹).
8. درخواست‌های async وابسته به view (مثل داشبورد) یک token یا `AbortController` دارند و پاسخ کهنه دور ریخته می‌شود (B11).
9. کامپوننت‌ها و فایل‌ها زیر ۵۰۰ خط بمانند (قانون `CLAUDE.md`).

---

## ۴. قراردادهایی که نباید شکسته شوند (Invariants)

- **همهٔ idهای `index.html`** و idهایی که JS می‌سازد (`discussionRounds`، `discussionStatusLine`، `discussionStatus`، `dashboardPlan`): همان نام‌ها و یکتا.
- **همهٔ کلاس‌های CSS** که امروز ساخته می‌شوند. هیچ تغییری در `app.css` لازم نباشد. هر تغییر کلاس یعنی تغییر عمدی و ثبت‌شده.
- ساختار DOMی که تست‌ها و CSS به آن وابسته‌اند:
  - `.bubble > details` (اولین فرزند thinking)
  - `.bubble > .message-content > h1|ul|p > a|strong`
  - `details.turn-execution[data-execution-key][data-turn-id] > summary + .turn-execution-body`
  - `.node.depth-N` با `margin-left`
  - `button.tool.<status>`
  - `.wave-label`، `.routine > .hook`
  - `details.execution-run` در `#executionArchive`
  - `li.bad|warn|clickable` در `#log`
- **API و payloadها بدون تغییر**: `/api/tasks`، `/api/projects/:id/tasks|cancel|discussions|state|metrics|health|sessions`، `/api/cancel`، `/api/clear`، `/api/settings` (`{key,value}` و `{key,reset:true}`)، `/api/approval-mode`، `/api/approvals/:id`، `/api/sessions[/:id]` (GET/POST)، `/api/mcp[?refresh=1]`، `/api/mcp/:name/enabled`، `DELETE /api/mcp/:name`، `/api/mcp/config` (GET/PUT)، `/api/models`، `/api/uploads[?projectId]`، `/api/calls/:key`، `/api/discussion[/personas]`، `/api/health`، `/api/state`، `/api/events[?projectId]`. همچنین `reasoning_effort` فقط وقتی `inherit` نباشد ارسال می‌شود.
- مسیرها و تاریخچه: `/projects/:id[?tab=]` و `/?project=` با `pushState`/`replaceState` و **هرگز** با انتساب به `location`، به‌همراه `popstate`.
- کلید localStorage: `structured-ai.currentProjectId`.
- میانبر Ctrl/Cmd+Enter، منوی موبایل (`menu-open` و `aria-expanded`)، و Plan در modal فقط در ویوپورت ≤900px.
- معنای snapshot: `snapshot.messages` مرجع است و `session:message` در replay نادیده گرفته می‌شود.
- فیلتر پروژه: رویداد پروژهٔ دیگر وارد view نمی‌شود.
- سقف‌ها: 5000 رویداد در state، 400 ردیف لاگ، 50 اجرای آرشیوشده.
- «نبود container نباید throw کند» و «خطای یک view نباید handler بقیهٔ رویدادها را بشکند».
- کش مدل‌ها: ۱۰ ثانیه برای خطا و بی‌نهایت برای موفقیت، و پاک شدن کش با کلیدهای `modelCatalogConfigChanged`.
- امنیت: لینک markdown فقط با `http`، `https`، `mailto` یا مسیر نسبی. `//` ممنوع است.

---

## ۵. فازبندی اجرا

> هر فاز یک PR مستقل است. شرط merge: **همهٔ تست‌های موجود سبز** + تست‌های جدید همان فاز + چک‌لیست QA دستی همان بخش. rollback هر فاز با `git revert` همان PR انجام می‌شود، چون کد legacy یک view تنها در همان PRی حذف می‌شود که جایگزینش سبز شده است.

### فاز ۰: شبکهٔ ایمنی (بدون تغییر رفتار محصول)

1. افزودن `happy-dom` به `devDependencies` (نسخه طبق تصمیم بند ۹-۱). Dockerfile با `--omit=dev` تحت تأثیر قرار نمی‌گیرد.
2. ساخت `test/helpers/browser-env.js`:
   - بارگذاری `index.html` واقعی (بدون scriptها) در happy-dom
   - stub برای `fetch` (با ثبت درخواست‌ها و پاسخ‌های قابل تنظیم) و `EventSource` (با `send` و `snapshot`)
   - ساعت قابل کنترل
   - سپس بارگذاری `modal.js` و `console.js`
3. **پورت `ui.test.js` به harness جدید** با همان ۴۵ سناریو. selectorهای shim‌مخصوص (`querySelectorAll("bubble")`) به CSS استاندارد (`.bubble`) تبدیل می‌شوند. معیار: ۴۵/۴۵ سبز روی **کد فعلی**. shim قدیمی تا پایان فاز ۷ برای تست‌های `Modal` می‌ماند یا آن تست‌ها هم پورت می‌شوند.
4. **تست‌های characterization** برای بخش‌هایی که امروز پوشش ندارند (هر کدام روی کد فعلی سبز):
   - MCP: افزودن (stdio/http، پارس env به‌صورت JSON و KEY=VALUE)، Enable/Disable، Remove، Reconnect all، ذخیرهٔ JSON نامعتبر و معتبر
   - History: لیست، انتخاب، New conversation
   - Call detail: پیش‌نمایش و بعد دریافت کامل از `/api/calls/:key`، Copy as JSON
   - Stop/Cancel: `Stopping…`، شکست درخواست و برگشت دکمه، پاک شدن `multiQueue`
   - Clear و `session:cleared`
   - پیوست‌ها: افزودن، حذف، خطای آپلود، ضمیمه شدن مسیر فایل به متن task، و آپلود یک‌باره برای هر پروژه (`uploaded` Map)
   - LLM settings: پر شدن لیست مدل بر اساس role، خطای catalog، invalidation کش
   - Setting رد شده (`rejected` و برگشت مقدار)، source=override و reset
   - داشبورد: همهٔ ۱۰ تب و ذخیرهٔ تب Settings
   - `session:switched` از کنسول دیگر، `run:auto_continue`، `settings:changed`
   - replay snapshot شامل `request:start` بدون `request:end`
5. **ضبط سناریوهای مرجع**: `test/fixtures/console-scenarios/*.json`، دنباله‌ای از رویدادهای واقعی (run ساده، run موازی با چند wave، delegation تودرتو، hook، loop/malformed، approval، discussion کامل، چندپروژه‌ای، و ۵۰۰ رویداد برای کارایی). `test/fixtures/events.json` موجود نقطهٔ شروع است.
6. **فریز legacy برای تست تفاضلی**: کپی `console.js` فعلی در `test/fixtures/legacy-console/console.js`، فقط برای تست و حذف در فاز ۷. helper `renderRegions(impl, scenario)` HTML نرمال‌شدهٔ `#chat`، `#tree`، `#executionArchive`، `#plan`، `#log`، چیپ‌های header و `#activeProjectName` را برمی‌گرداند (با حذف زمان‌ها و فاصله‌ها).
7. تصمیم دربارهٔ B4 و B14 با بازتولید در محیط واقعی.

**معیار پذیرش:** همهٔ تست‌ها سبز روی کد بدون تغییر، تست‌های جدید سبز، و harness تفاضلی برای legacy در برابر خودش «برابر» گزارش کند.

### فاز ۱: استخراج منطق خالص (refactor بدون تغییر رفتار)

- انتقال به `app/lib/`: `shorten`، `singleLine`، `statusIcon`، `SHAPE_LABEL`، `intervalOf`، `ranAlongside`، `messageExecutionKey`، `normalizeConversationMessage(s)`، `turnEventsOf`، `turnSummaryText`، `eventLabel`، `describeEvent`، `containsRtlText`، `safeMarkdownHref`، parser markdown (ابتدا با همان خروجی DOM)، `parseEnvInput`، `isLlmSetting`، `modelCatalogConfigChanged`، `GROUP_ORDER`، `parseProjectRoute`، `navigateConsole`، و `taskWithAttachments`.
- `console.js` به ماژول ESM تبدیل می‌شود که این‌ها را import می‌کند. harness فاز ۰ آن را با `import()` بار می‌کند.
- به‌روزرسانی `console-navigation.test.js` تا به‌جای برش متن، `lib/router.js` را import کند.
- به‌روزرسانی `modules.test.js`: فهرست جدید، اسکن idها روی **همهٔ** فایل‌های `app/**`، و syntax check همهٔ فایل‌ها.
- unit test برای هر تابع `lib/` (به‌خصوص markdown: جدول، fence، نقل‌قول تودرتو، لیست، لینک ناامن، عمق ۸).
- حذف/جایگزینی ماژول‌های اسکلتی Phase 24 که کد مرده‌اند، یا پر کردن آن‌ها با همین منطق واقعی. رفع B18.

**پذیرش:** تست تفاضلی روی همهٔ سناریوها «برابر»، و حجم `console.js` حدود ۱۵۰۰ خط کمتر.

### فاز ۲: store واحد و reducer خالص

- `core/store.js` با signals-core (vendor در این فاز اضافه می‌شود، بند فاز ۳-۱) و `core/reducers/*`.
- پورت **همهٔ ۳۴ حالت `switch` در `apply()`** و منطق `applySnapshot`، `applySession`، `resetRun`، `setCurrentProject` (بخش reset) و `pushDiscussionEvent` (بخش داده).
- `core/effects.js` شامل `refreshSession`، `loadSettings`، `drainProjectTaskQueue`، تایمر waiting و تایمر run. همه فقط وقتی `live` باشد اجرا می‌شوند (رفع B12).
- در این فاز **رندررهای legacy همچنان DOM را می‌سازند** ولی از store می‌خوانند: `state.*` در console.js به getterهای store وصل می‌شود و `apply()` به این شکل درمی‌آید: `dispatch(event)` ← فراخوانی renderهای legacy.
- unit test برای reducerها (بدون DOM) روی سناریوهای مرجع: state نهایی، سقف‌ها، فیلتر پروژه، و idempotent بودن replay.
- تست: `applySnapshot` با ۵۰۰ رویداد هیچ fetchی نمی‌زند و هیچ تایمری نمی‌سازد.

**پذیرش:** تست تفاضلی «برابر»، همهٔ تست‌های UI سبز، و یک منبع حقیقت.

### فاز ۳: زیرساخت رندر

1. vendor کردن سه فایل از npm با نسخهٔ دقیق، `manifest.json` (شامل sha256) و `LICENSES.md`. پسوند `.js` به‌خاطر B17. تست `vendor.test.js` checksumها را با manifest مقایسه می‌کند و تأیید می‌کند فایل‌ها import خارجی ندارند. اسکریپت `tools/vendor-ui.js` برای به‌روزرسانی کنترل‌شده.
2. `ui/html.js`، `ui/mount.js` (با گزارش خطای view)، و `ui/modal-view.js`.
3. تست‌های زیرساخت: mount همگام، unmount تمیز (بدون نشت effect)، throw در view که view‌های دیگر و stream را نشکند، batch به معنای یک رندر، و escape.
4. اضافه کردن قواعد ایستا به `modules.test.js`: ممنوعیت `innerHTML` و `dangerouslySetInnerHTML` در `views/`، ممنوعیت import با URL مطلق یا bare specifier، و import فقط از `vendor/` و مسیرهای نسبی.
5. (اختیاری) اضافه کردن `.mjs` به نگاشت MIME سرور، صرفاً برای ایمنی آینده.

### فاز ۴: مهاجرت viewها (یک PR برای هر ردیف، از کم‌ریسک به پرریسک)

| ترتیب | view | نکات حساس | بستن باگ |
|---|---|---|---|
| 4.1 | header و status strip: `statusDot`، `statusText`، `workspace`، `model`، `autoSwitchStatus`، `turns`، `gatewayHealth`، `approvalsButton`/`approvalsCount`، `runTimer` | «reconnecting» در `onerror`. `turns` از سه منبع به‌روز می‌شود (snapshot، `run:auto_continue` و پاسخ `/api/state` بعد از submit) و همین رفتار حفظ شود | — |
| 4.2 | plan (کارت و modal موبایل) | `details.open` بر اساس `phase.id` در state. پیش‌فرض: فاز `in_progress` یا اولین فاز | B7 |
| 4.3 | پیوست‌ها و برچسب پروژه | `File` در signal نگه داشته می‌شود (غیرقابل serialize ولی مشکلی نیست) | — |
| 4.4 | لاگ رویدادها | داده‌محور با سقف ۴۰۰. `logTypes` و شمارش با `computed`. نوع انتخاب‌شده‌ای که ناپدید شده در لیست بماند. کلیک روی ردیف `call_key` جزئیات را باز کند. scroll به پایین. فیلتر در رفت‌وبرگشت modal حفظ شود | B10 (تصمیم) |
| 4.5 | execution tree و آرشیو | خلاصهٔ `execSummary`، برچسب wave با محاسبهٔ overlap واقعی، depth، badgeها، hook routine، و آرشیو داده‌محور با سقف ۵۰ که به‌صورت `<details>` بسته رندر شود | B8 |
| 4.6 | **چت** | کلید پایدار bubble. بلوک `turn-execution` قبل از پیام reasoning و fallback `turn|all` برای sessionهای قدیمی. پیام‌های `kind=model` رندر نمی‌شوند. bubble انتظار با `clock`. RTL. timestamp با `en-GB`. حفظ `refreshTurnExecution` دیگر لازم نیست چون diff خودش درجا است | B9 (تصمیم scroll) |
| 4.7 | approvals | یک modal، `1/N pending`، صف «Also waiting»، Approve all، و بسته شدن خودکار وقتی صف خالی شد | B3 و B4 (تصمیم) |
| 4.8 | Settings و LLM settings | ردیف‌های کلیددار با `setting.key`. فیلتر به‌عنوان state محلی که بعد از `settings:changed` حفظ شود. `saved` به مدت 800ms. `rejected` و پیام خطا. select مدل با catalog. کنترل‌های policy (`approvalMode`، `autoContinue`) به یک کامپوننت متصل به store تبدیل شوند و به‌جای borrow فقط در یک جا mount شوند (id یکتا) | B5، B15 |
| 4.9 | MCP | تب‌ها. پیش‌نویس فرم و Raw JSON در state که با refresh پاک نشود. پیام‌های `connecting…`، `Saving…` و خطا. subtitle شمار ابزار و سرور | B6 |
| 4.10 | History و Call detail | جلوگیری از باز شدن دوباره (`historyOpening`). دریافت تنبل نتیجهٔ کامل | B16 |
| 4.11 | Discussion (گزینه‌های composer و modal) | پیش‌انتخاب ۵ persona، all/none، max rounds بین ۱ و ۱۰، برچسب دکمهٔ Run (`Start discussion`، `Discussion running…`)، `dataset.discussionBusy`، و **یک ترتیب واحد** برای نمای زنده و history | B13 (تصمیم) |
| 4.12 | Projects، New Project و داشبورد | چندانتخابی و رادیوی workspace، Delete که دوباره modal را باز کند، ۱۰ تب، deep-link، `popstate`، و لغو درخواست تب قبلی | B11 |
| 4.13 | composer و actionها | submit (task، discussion و چندپروژه‌ای)، Stop، Clear، effort، Ctrl+Enter. همه با try/finally | B1، B2، B14 (اگر تأیید شد) |

برای هر ردیف:
- (الف) view جدید پشت همان idها mount می‌شود.
- (ب) تابع legacy و فراخوانی‌هایش حذف می‌شود.
- (ج) تست تفاضلی آن ناحیه «برابر» است، یا تفاوت‌ها دقیقاً همان باگ‌هایی‌اند که اصلاحشان تأیید شده و هر تفاوت یک تست جدید دارد.
- (د) تست‌های رفتاری جدید: حفظ فوکوس، حفظ متن فیلتر، حفظ `<details>`، حفظ ورودی‌های فرم، و حفظ هویت گره هنگام رویداد جدید.
- (ه) QA دستی همان بخش در مرورگر (Chrome و Firefox، دسکتاپ و موبایل، متن فارسی).

### فاز ۵: حذف borrow و ساده‌سازی modalها

- Execution و Events به‌جای قرض گرفتن گره‌ها، view را در body modal mount می‌کنند و در ردیف مخفی unmount می‌شوند تا id یکتا بماند. Settings هم دیگر chipهای policy را قرض نمی‌گیرد.
- تست‌های «cards borrowed by a modal…» با تست‌های معادل رفتاری جایگزین می‌شوند. هدف آن تست‌ها این بود که «بعد از بستن modal، stream هنوز رسم کند و فیلتر حفظ شود» و همین هدف حفظ می‌شود.

### فاز ۶: کارایی و مقاوم‌سازی

- بنچمارک: replay snapshot با ۵۰۰ رویداد کمتر از ۵۰ms در happy-dom و **دقیقاً یک** رندر برای هر ناحیه. stream با ۲۰ رویداد در ثانیه نباید باعث بازسازی کامل چت شود.
- reconnect: `EventSource` خودش reconnect می‌کند و snapshot جدید state را کامل جایگزین می‌کند، بدون تکرار bubble.
- خطای render یک view در گوشهٔ همان view یک پیام کوچک نشان می‌دهد و بقیه کار می‌کنند.

### فاز ۷: پاک‌سازی

- حذف `console.js` legacy (یا تبدیل آن به facade نازک برای سازگاری) و به‌روزرسانی `rollout.contract.test.js` و `main.js`.
- حذف `test/fixtures/legacy-console` و تبدیل تست تفاضلی به snapshotهای ثابت HTML (golden files).
- حذف کد مرده و به‌روزرسانی README بخش کنسول.

---

## ۶. استراتژی تست (خلاصه)

| لایه | ابزار | چه چیزی |
|---|---|---|
| reducer | Node خالص | همهٔ نوع رویدادها، سقف‌ها، فیلتر پروژه، replay بدون side effect |
| lib | Node خالص | markdown (امنیت و ساختار)، describeEvent، کلیدهای اجرا، intervalها، router |
| view | happy-dom | ساختار DOM، کلاس‌ها، idها، هویت گره، فوکوس، `<details>`، ورودی‌ها، RTL |
| تفاضلی | happy-dom + legacy فریزشده | برابری HTML نرمال‌شدهٔ هر ناحیه روی همهٔ سناریوهای مرجع |
| یکپارچه | `web.test.js` موجود + چک سرو شدن `/vendor/*.js` | دارایی‌ها و MIME درست |
| ایستا | `modules.test.js` | فهرست ماژول‌ها، idها، نبود innerHTML، checksum وندور، importهای مجاز |
| دستی | چک‌لیست بند ۷ | مرورگر واقعی، موبایل، فارسی، دو تب هم‌زمان (`session:switched`) |
| اختیاری | Playwright در CI (نه در sandbox) | smoke end-to-end روی سرور واقعی |

همهٔ تست‌های جدید به اسکریپت‌های `test`، `test:ui` و `test:web` در `package.json` و به `ci/run-tests.js` (برای coverage) اضافه می‌شوند.

---

## ۷. چک‌لیست برابری قابلیت‌ها (Feature parity)

**Header و وضعیت**
- [ ] نقطه و متن وضعیت (`idle`/`running`/`done`/`failed`/`reconnecting`)
- [ ] چیپ health (کلاس‌های ok/degraded/down و لینک به داشبورد پروژه)
- [ ] workspace و model
- [ ] auto-switch on/off
- [ ] turns/cycle
- [ ] دکمهٔ approvals با شمارنده
- [ ] منوی موبایل
- [ ] تایمر run (۰.۱ ثانیه)

**Composer**
- [ ] textarea
- [ ] Ctrl/Cmd+Enter
- [ ] effort (inherit/low/medium/high/xhigh)
- [ ] پیوست چندفایلی، حذف، خطا، «Uploading files…»، و متن پیش‌فرض وقتی فقط فایل هست
- [ ] Run/Stop (`Stopping…`)
- [ ] حالت Discussion: personaها، all/none، max rounds، خط وضعیت، لینک view، و دکمهٔ `Discussion running…`

**چت**
- [ ] bubbleهای user/assistant/system/error/git-report/thinking
- [ ] markdown کامل (عنوان، لیست، جدول، کد، نقل‌قول، hr، لینک امن، inline)
- [ ] RTL خودکار
- [ ] timestamp
- [ ] بلوک اجرای هر iteration با خلاصه (`N tool call(s) · success · fail · retried`) و حفظ وضعیت باز
- [ ] fallback sessionهای قدیمی
- [ ] bubble انتظار با زمان زنده
- [ ] برچسب `Project · name` در اجرای پروژه‌ای
- [ ] پیام «No messages yet»

**Plan**
- [ ] objective، فازها و گام‌ها، badgeها، `@agent`، evidence، خلاصهٔ `done/steps · blocked`، routine، خطای plan
- [ ] modal موبایل

**Execution**
- [ ] درخت agentها با depth، parent، persona، task، iteration و status
- [ ] skillها
- [ ] loop/malformed/mismatch/خطای delegation
- [ ] گراف با shape و waveها و شمار «in parallel» واقعی
- [ ] ردیف tool با exit و warning و ms و depends
- [ ] hook routine
- [ ] خلاصه
- [ ] آرشیو ۵۰ اجرای قبلی
- [ ] modal جزئیات call (Arguments/Result/Error، دریافت کامل، Copy as JSON)

**Events**
- [ ] رنگ‌بندی bad/warn
- [ ] زمان، نوع و توضیح (۴۱ نوع اختصاصی در `describeEvent` به‌علاوهٔ حالت پیش‌فرض)
- [ ] فیلتر متنی و نوع
- [ ] شمارش `N of M`
- [ ] clear
- [ ] کلیک روی ردیف برای جزئیات call
- [ ] سقف ۴۰۰
- [ ] modal

**Approvals**
- [ ] modal خودکار، جزئیات، صف، Approve/Deny/Approve all، بسته شدن خودکار

**Settings و LLM settings**
- [ ] گروه‌بندی با `GROUP_ORDER`
- [ ] فیلتر (کلید و توضیح، شامل بخش policy)
- [ ] انواع ورودی (boolean، enum، number، secret با placeholder، model select با catalog)
- [ ] fixed
- [ ] saved/rejected
- [ ] reset override
- [ ] Reload
- [ ] کنترل‌های approval mode و until done

**MCP**
- [ ] لیست سرورها با وضعیت و facts و خطا
- [ ] Enable/Disable/Remove
- [ ] ابزارها
- [ ] problems
- [ ] فرم Connect با transportها و env
- [ ] Raw JSON و ذخیره
- [ ] Reconnect all
- [ ] حالت MCP خاموش

**History و session**
- [ ] لیست و current
- [ ] باز کردن session (rebuild همهٔ کارت‌ها از رویدادها و calls)
- [ ] New conversation
- [ ] `session:switched` و `session:cleared`

**Discussion**
- [ ] modal زنده، roundها، observer، گزارش نهایی (agreed/unresolved/next steps)، خطا
- [ ] ادامه پس از reload از snapshot

**پروژه‌ها**
- [ ] Projects manager (workspace و چندانتخابی، Open، Delete، Confirm)
- [ ] New Project
- [ ] برچسب پروژهٔ فعال
- [ ] اجرای چندپروژه‌ای به‌ترتیب
- [ ] داشبورد با ۱۰ تب، deep-link و Back
- [ ] `popstate` و localStorage
- [ ] SSE مخصوص پروژه
- [ ] فیلتر رویداد پروژه

**سراسری**
- [ ] ورود با رمز (auth-gate)
- [ ] Escape و backdrop و فوکوس modalها
- [ ] reconnect SSE
- [ ] نبود container بدون throw

---

## ۸. ریسک‌ها و کاهش آن‌ها

| ریسک | احتمال | اثر | کاهش |
|---|---|---|---|
| تغییر ناخواستهٔ ساختار DOM یا کلاس که CSS را خراب کند | متوسط | متوسط | تست تفاضلی HTML و QA بصری هر PR |
| رندر async که باعث تست‌های flaky یا جاافتادن رویداد شود | کم | زیاد | فقط signals-core و `render()` سطح‌بالا. hookهای state ممنوع. تست زیرساخت «همگام بودن» |
| side effect در replay | متوسط امروز | زیاد | تفکیک `live`. تست «snapshot هیچ fetch یا timerی نمی‌سازد» |
| مشکل IME فارسی یا پرش مکان‌نما در ورودی‌ها | متوسط | زیاد | ورودی‌های uncontrolled و QA با کیبورد فارسی |
| id تکراری هنگام mount در modal | متوسط | زیاد | قاعدهٔ «یک mount فعال» و تست ایستای idها روی DOM زنده |
| کارایی چت یا لاگ طولانی | کم | متوسط | key پایدار، سقف‌ها و بنچمارک فاز ۶. در صورت نیاز virtualization فقط برای لاگ |
| زنجیرهٔ تأمین (supply chain) وندور | کم | زیاد | نسخهٔ دقیق، sha256 در manifest، تست checksum و بدون CDN |
| ناسازگاری happy-dom با Node 18 در CI | قطعی برای ≥20 | متوسط | تصمیم ۹-۱ |
| بزرگ شدن PRها و سختی review | متوسط | متوسط | یک view در هر PR. legacy تا سبز شدن جایگزین حذف نمی‌شود |

---

## ۹. تصمیم‌هایی که پیش از شروع لازم است

1. **Node 18 در CI**: `happy-dom@20` به Node 20 یا بالاتر نیاز دارد. Node 18 از آوریل ۲۰۲۵ EOL است. گزینه‌ها:
   - (الف) حذف Node 18 از ماتریس CI و تغییر `engines` به `>=20` (پیشنهادی)
   - (ب) pin کردن `happy-dom@15.11.7` (آخرین نسخه با پشتیبانی Node 18، بعد از اصلاح CVE معروف)
2. **اصلاح یا حفظ باگ‌ها**: B1، B2، B3، B5، B6، B7، B11، B12 و B16 پیشنهاد اصلاح دارند (بی‌خطر و هم‌جهت با هدف). B4، B9 (scroll هوشمند: فقط وقتی کاربر در انتهای چت است)، B10، B13 و B14 نیاز به نظر صاحب محصول دارند.
3. Preact 10.29.8 (پیشنهادی) یا 11.x.
4. نگه داشتن یک toggle موقت `?ui=legacy` برای چت و execution در یک release؟ پیشنهاد: لازم نیست، چون rollback در سطح PR است.
5. اضافه شدن Playwright به CI (اختیاری).

---

## ۱۰. برآورد (برای یک توسعه‌دهنده)

| فاز | روز کاری |
|---|---:|
| ۰: شبکهٔ ایمنی، پورت تست‌ها، characterization و سناریوها | 3 تا 4 |
| ۱: استخراج lib | 2 |
| ۲: store و reducer و effects | 3 تا 4 |
| ۳: وندور و زیرساخت رندر | 1 |
| ۴: ۱۳ view | 9 تا 12 |
| ۵: حذف borrow | 1 |
| ۶: کارایی و مقاوم‌سازی | 1 |
| ۷: پاک‌سازی | 1 |
| **جمع** | **۲۱ تا ۲۶ روز (حدود ۴ تا ۵ هفته)** |
