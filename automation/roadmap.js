children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('۷. نقشه راه اولویت‌بندی‌شده'));
children.push(p('هر آیتم شامل شناسه، شرح، فایل‌های اصلی، تلاش تخمینی (S: کمتر از ۳ روز، M: ۱ تا ۲ هفته، L: ۳ تا ۶ هفته، XL: بیش از ۶ هفته)، وابستگی و **معیار پذیرش** قابل تست است. یک آیتم فقط وقتی «انجام‌شده» است که همه معیارهایش با تست خودکار در CI اثبات شوند.'));
function item(it) {
  children.push(h3(it[0] + ' — ' + it[1]));
  children.push(p(it[2]));
  children.push(p('**فایل‌ها:** ' + it[3] + '   |   **تلاش:** ' + it[4] + '   |   **وابستگی:** ' + it[5]));
  children.push(p('**معیارهای پذیرش:**'));
  it[6].forEach(a => children.push(li(a)));
}
var phases = [
 ['P0 — امن‌سازی و ترمیم بحرانی (هفته ۱ تا ۶)', 'هیچ انتشار عمومی قبل از بستن این فاز. هدف: هیچ یافته بحرانی یا بالای امنیتی باز نماند.', [
  ['P0-1', 'Workspace Trust و قفل تنظیمات حساس', 'تفکیک تنظیمات کاربر از تنظیمات ریپو. کلیدهایی مثل AGENT_APPROVAL، base URL، API key، sandbox mode و MCP trust هرگز از .agent/project.json قابل override نیستند. اولین باز کردن هر پوشه نیاز به تأیید trust دارد.', 'agent/cli/Cli.js، agent/projects/WorkspaceProfile.js، agent/config/SettingsResolver.js', 'M', '—',
   ['ریپوی تستی با project.json که approval=auto و baseUrl مهاجم دارد، هیچ‌کدام را اعمال نمی‌کند و هشدار ثبت می‌شود.', 'پوشه untrusted بدون تأیید کاربر هیچ MCP stdio و hook ای اجرا نمی‌کند.', 'trust store در مسیر کاربر (~/.config یا %APPDATA%) ذخیره و قابل لغو است.']],
  ['P0-2', 'اعمال Policy در تمام مسیرها و deny-by-default', 'یک choke point واحد برای اجرای ابزار؛ mcp_call، mcp_add، process_write و delegation همگی از PolicyEngine عبور کنند. default_action=ask؛ MCP پیش‌فرض restricted؛ approval کش‌شده TTL دارد و حالت deny را نقض نمی‌کند.', 'agent/policy/*، agent/registry/policy.json، agent/mcp/McpManager.js، agent/tools/mcp/McpTools.js', 'M', 'P0-1',
   ['تست contract: هر ابزار ثبت‌شده بدون قاعده صریح → ask.', 'mcp_call روی سرور restricted همیشه approval می‌خواهد؛ mcp_add نمی‌تواند trust=trusted تعیین کند.', 'با AGENT_APPROVAL=deny هیچ approval کش‌شده‌ای اجرا را مجاز نمی‌کند.', 'process_write روی shell باز، هر خط را از policy فرمان عبور می‌دهد.']],
  ['P0-3', 'نرمال‌سازی مسیر و ایمنی symlink', 'canonicalize همه مسیرها (realpath روی والد برای فایل‌های جدید)، تطبیق case-insensitive در Windows، رد symlink معلق و اجرای delete/move روی خود لینک.', 'agent/context/WorkspaceBoundary.js، agent/tools/filesystem/*', 'M', '—',
   ['symlink معلق به خارج workspace: fs_write رد می‌شود.', 'مسیر src\\.git\\hooks\\x در Windows توسط قاعده deny گرفته می‌شود.', 'fs_delete روی لینک فقط لینک را حذف می‌کند (تست روی هر سه OS).']],
  ['P0-4', 'ایمنی وب‌سرور و مجوزها', 'جلوگیری از کرش با ورودی خراب؛ مجوزهای scope‌دار برای settings، approvals، sessions و MCP؛ تغییرات حساس فقط برای admin.', 'web/server/Router.js، web/server/ServerImplementation.js', 'M', 'P0-2',
   ['fuzz test با ۱۰۰۰ مسیر و Host خراب: سرور زنده می‌ماند و 400 برمی‌گرداند.', 'توکن project:read برای settings، approvals پروژه دیگر و افزودن MCP پاسخ 403 می‌گیرد.', 'هیچ endpoint داده پروژه دیگر را برنمی‌گرداند (تست ماتریسی توکن × endpoint).']],
  ['P0-5', 'جداسازی اسرار', 'محیط فرزندان (MCP، shell، hook) فقط از allowlist ساخته شود؛ redact مقداری اسرار پیش از ذخیره؛ مجوز 0600 فایل‌ها؛ ممنوعیت ${ENV} در config ریپو.', 'agent/mcp/transports/StdioTransport.js، agent/tools/process/ProcessManager.js، agent/persistence/*، agent/events/EventRedactor.js', 'M', 'P0-1',
   ['سرور MCP تستی env را چاپ می‌کند: هیچ *_API_KEY یا GITHUB_TOKEN دیده نمی‌شود.', 'جستجو در data root پس از اجرا با کلید ساختگی هیچ تطابقی ندارد.', 'url حاوی ${OPENAI_API_KEY} در .mcp.json ریپو رد می‌شود.']],
  ['P0-6', 'سازگاری MCP stdio با spec و مقاومت stream', 'پیش‌فرض NDJSON؛ پاسخ به roots/list و ping؛ handler خطا روی stdin/stdout همه فرزندان؛ پاک‌سازی نام ابزارها برای پروایدرها.', 'agent/mcp/transports/StdioTransport.js، agent/mcp/McpConnection.js، agent/mcp/McpCatalogue.js، agent/tools/process/BackgroundSession.js', 'S–M', '—',
   ['اتصال موفق به @modelcontextprotocol/server-filesystem و server-everything در CI.', 'kill کردن سرور حین نوشتن، runtime را کرش نمی‌دهد (تست EPIPE).', 'همه نام ابزارها با الگوی ^[a-zA-Z0-9_-]{1,64}$ مطابق‌اند.']],
  ['P0-7', 'رفع باگ‌های پایداری runtime', 'توقف اجرای وابسته‌ها پس از شکست dependency؛ حفظ لغو پیش از startRun؛ await کامل shutdown؛ مدیریت خطای REPL؛ اعتبارسنجی CLI پیش از اجرا.', 'agent/runtime/ToolGraphExecutor.js، agent/runtime/RunCancellation.js، agent/cli/Cli.js، agent/interactive/Repl.js', 'M', '—',
   ['گراف A→B که A شکست می‌خورد: B با وضعیت skipped گزارش می‌شود.', 'cancel بین admission و start اجرا را متوقف می‌کند.', '--temperature 3 بلافاصله خطای استفاده می‌دهد.', 'پس از SIGINT همه زیرفرایندها و سرورهای MCP بسته و journal کامل flush شده است.']]
 ]],
 ['P1 — پایه چندسکویی و چندپروایدری (هفته ۶ تا ۱۶)', 'هدف: اجرای کامل و امن روی Windows، macOS و Linux با هر پروایدر LLM.', [
  ['P1-1', 'لایه Provider Abstraction', 'interface واحد LLMProvider با adapterهای OpenAI (Chat و Responses)، Anthropic Messages، Gemini، Azure OpenAI، AWS Bedrock، Ollama، OpenRouter و Generic OpenAI-compatible؛ پشتیبانی streaming، native tool calling، vision، prompt caching و شمارش توکن. ProviderRouter با fallback، retry و مدل جدا برای هر نقش (planner، coder، observer).', 'agent/agent.js (استخراج transport)، agent/config/SettingsSchema.js، agent/providers/* (جدید)', 'L', 'P0-7',
   ['تست contract با fixture ضبط‌شده برای هر ۸ پروایدر: chat، stream، tool call و خطاهای 429/5xx.', 'تغییر پروایدر فقط با config و بدون تغییر کد.', 'یک سناریوی e2e ثابت روی حداقل ۴ پروایدر واقعی (nightly) موفق است.', 'خروجی دارای preamble برای همه پروایدرها توسط ResponseRepair بازیابی می‌شود.']],
  ['P1-2', 'SandboxProvider چندسکویی', 'انتزاع اجرای فرمان با پیاده‌سازی‌های docker/podman (پیش‌فرض)، macOS seatbelt، Windows AppContainer/Job Object یا WSL، bwrap اصلاح‌شده و none (با هشدار صریح)؛ محدودیت CPU، حافظه، pids و زمان؛ سیاست egress شبکه.', 'agent/tools/process/*، agent/runtime/*', 'XL', 'P0-2، P0-5',
   ['تست isolation در CI روی هر سه OS: خواندن ~/.ssh، نوشتن خارج workspace و شبکه ممنوع رد می‌شوند.', 'npm install، pip install و git clone در sandbox پیش‌فرض کار می‌کنند.', 'فرمان runaway پس از timeout با کل درخت پروسه kill می‌شود (Windows: taskkill /T).', 'agent doctor نوع sandbox فعال و قابلیت‌ها را گزارش می‌دهد.']],
  ['P1-3', 'ترمینال تعاملی (PTY)', 'node-pty و ConPTY، نشست shell پایدار با حفظ cwd و env، پشتیبانی bash، zsh، PowerShell و cmd، stream زنده به UI، interrupt و resize.', 'agent/tools/process/*، web/server/*', 'M', 'P1-2',
   ['اجرای برنامه تعاملی (مثل python REPL) و ارسال ورودی روی هر سه OS.', 'Ctrl-C فرمان طولانی را قطع می‌کند بی‌آنکه نشست از بین برود.', 'خروجی با تأخیر کمتر از ۲۰۰ms در UI دیده می‌شود.']],
  ['P1-4', 'Policy چندسکویی', 'قواعد مسیر بر اساس مسیر نرمال‌شده؛ rule set برای PowerShell و cmd؛ طبقه‌بندی ریسک فرمان با parser به‌جای regex.', 'agent/registry/policy.json، agent/policy/PolicyMatcher.js', 'M', 'P0-3',
   ['Remove-Item -Recurse -Force C:\\ و rm -rf / هر دو high-risk و نیازمند approval هستند.', 'مجموعه ۲۰۰ فرمان مرجع با دقت بیش از ۹۵٪ طبقه‌بندی می‌شود.']],
  ['P1-5', 'CI ماتریسی و تست‌های قابل‌حمل', 'GitHub Actions روی ubuntu، windows و macos با Node 20/22/24؛ حذف وابستگی تست‌ها به sleep و cat؛ خروجی JUnit و coverage؛ test runner واحد به‌جای زنجیره بلند && .', 'ci/*، .github/workflows/*، test/*، package.json', 'M', '—',
   ['npm test روی هر سه OS سبز است.', 'coverage خط برای agent/policy، agent/mcp و agent/tools بیش از ۸۰٪.', 'زمان کل CI کمتر از ۱۵ دقیقه.']],
  ['P1-6', 'شکستن agent.js و حذف کارهای همگام', 'تقسیم فایل ۹۶KB به AgentLoop، LLMClient، PromptAssembler و غیره؛ حذف execSync/spawnSync از مسیر داغ (git status کش‌شده و async)؛ اجرای regex جستجو در worker با timeout.', 'agent/agent.js، agent/prompt/RuntimeContextBuilder.js، agent/tools/search/SearchTools.js', 'L', 'P1-1',
   ['هیچ فایل منبع در agent/ بزرگ‌تر از ۱۵KB نیست (به‌جز داده).', 'lag event loop با ۱۰ عامل هم‌زمان کمتر از ۱۰۰ms (p99).', 'regex (a+)+$ روی فایل ۱۰MB پس از ۲ ثانیه قطع می‌شود و runtime پاسخ‌گو می‌ماند.']]
 ]],
 ['P2 — عامل همه‌فن‌حریف (هفته ۱۶ تا ۳۰)', 'هدف: برابری و سپس برتری بر OpenHands در قابلیت‌ها.', [
  ['P2-1', 'یکپارچگی GitHub (و GitLab)', 'clone، fetch، push و branch؛ ایجاد و بازبینی PR، issue، کامنت و بررسی CI checks؛ احراز هویت با GitHub App یا OAuth device flow و ذخیره در keychain سیستم؛ امکان استفاده از سرور MCP رسمی GitHub.', 'agent/tools/git/*، agent/tools/github/* (جدید)، agent/registry/tool-schemas/*', 'L', 'P0-2، P1-2',
   ['سناریوی e2e: از روی issue، branch بسازد، کد را اصلاح کند، تست بگیرد و PR باز کند (روی ریپوی تستی).', 'push به branch محافظت‌شده یا force-push همیشه approval می‌خواهد.', 'توکن هرگز در لاگ، event store یا prompt دیده نمی‌شود.']],
  ['P2-2', 'ابزار Browser', 'Playwright داخل sandbox: navigate، click، type، scroll، screenshot، استخراج accessibility tree و markdown؛ محافظ SSRF کامل (IPv6 mapped و redirect).', 'agent/tools/browser/* (جدید)، agent/tools/network/NetworkTools.js', 'L', 'P1-2',
   ['عامل یک فرم تستی محلی را پر و ارسال می‌کند و screenshot برمی‌گرداند.', 'دسترسی به 169.254.169.254 و [::ffff:a9fe:a9fe] رد می‌شود.', 'header Authorization در redirect بین‌دامنه‌ای حذف می‌شود.']],
  ['P2-3', 'MCP کامل', 'sampling، elicitation، progress، cancellation، tools/list_changed؛ OAuth 2.1 + PKCE برای سرورهای راه دور؛ تبدیل schema به dialect هر پروایدر؛ policy per-tool و استفاده از annotation destructiveHint.', 'agent/mcp/*', 'L', 'P0-6، P1-1',
   ['اتصال موفق به سرورهای مرجع (filesystem، github، playwright، everything) در CI.', 'اتصال به سرور راه دور با OAuth بدون کپی دستی توکن.', 'ابزار با destructiveHint=true بدون approval اجرا نمی‌شود.']],
  ['P2-4', 'ویرایش کد پیشرفته و Checkpoint', 'apply_patch با unified diff، چند ویرایش اتمیک، حفظ EOL و BOM، checkpoint خودکار پیش از هر تغییر و undo؛ نمایش diff در approval.', 'agent/tools/filesystem/*، agent/persistence/*', 'M', 'P0-3',
   ['patch ناسازگار بدون تغییر فایل رد می‌شود.', 'undo به هر checkpoint فایل‌ها را بایت‌به‌بایت بازمی‌گرداند.', 'فایل CRLF پس از ویرایش CRLF باقی می‌ماند.']],
  ['P2-5', 'Security Risk Analyzer', 'برچسب ریسک low/medium/high برای هر اکشن با قاعده و (اختیاری) LLM؛ approval بر اساس سطح ریسک؛ audit log ضد دست‌کاری (hash chain).', 'agent/policy/*', 'M', 'P1-4',
   ['benchmark اکشن‌های خطرناک: recall بیش از ۹۵٪.', 'هر approval با شناسه run، هش آرگومان‌ها و هویت تأییدکننده در audit ثبت می‌شود.']],
  ['P2-6', 'حافظه و context هوشمند', 'بودجه توکن بر اساس پنجره مدل؛ provenance حافظه و قرنطینه منابع غیرقابل‌اعتماد؛ عدم حذف exchange در صورت شکست آرشیو؛ اتصال semantic-engine برای درک کد.', 'agent/context/*، agent/mcp/semantic.js', 'M', 'P1-1',
   ['جلسه ۲۰۰ مرحله‌ای روی مدل 32k بدون context overflow اجرا می‌شود.', 'متن تزریق‌شده از صفحه وب بدون تأیید وارد حافظه دائمی نمی‌شود.', 'شکست آرشیو هیچ داده‌ای را از بین نمی‌برد (تست fault injection).']],
  ['P2-7', 'Observability و کنترل هزینه', 'OpenTelemetry trace برای هر run، ابزار و فراخوانی LLM؛ شمارش توکن و هزینه برای هر پروایدر؛ بودجه هزینه؛ replay جلسه از event store.', 'agent/runtime/Telemetry.js، agent/runtime/Observability.js', 'M', 'P1-1',
   ['trace کامل یک run در Jaeger قابل مشاهده است.', 'اجرا پس از عبور از بودجه هزینه متوقف و گزارش می‌شود.', 'replay یک جلسه همان دنباله رویدادها را بازتولید می‌کند.']]
 ]],
 ['P3 — توزیع، تجربه کاربری و اکوسیستم (هفته ۳۰ تا ۴۴)', 'هدف: نصب یک‌دستوری روی هر OS و اکوسیستم قابل گسترش.', [
  ['P3-1', 'نصب‌کننده‌های چندسکویی', 'انتشار npm عمومی با نام یکتا (به‌جای agent که تداخل دارد)، باینری مستقل (Node SEA)، Homebrew، winget و Scoop، deb و rpm، اسکریپت install.sh و install.ps1، تصویر Docker کامل و به‌روزرسانی خودکار امضاشده.', 'package.json، Dockerfile، ci/release/* (جدید)', 'L', 'P1-5',
   ['نصب و agent doctor روی ماشین تمیز Windows 11، macOS 14 و Ubuntu 24.04 در کمتر از ۲ دقیقه.', 'هر release با checksum و امضا منتشر می‌شود.', 'تصویر Docker شامل git و sandbox کارا است و smoke test را پاس می‌کند.']],
  ['P3-2', 'Onboarding و پیکربندی', 'دستور agent init (انتخاب پروایدر، کلید و sandbox)، ذخیره کلید در keychain سیستم، config در مسیر استاندارد هر OS و agent doctor.', 'agent/cli/*، agent/config/*', 'M', 'P1-1، P1-2',
   ['کاربر جدید بدون ویرایش دستی فایل در کمتر از ۵ دقیقه اولین تسک را اجرا می‌کند.', 'کلید API هرگز به‌صورت متن ساده روی دیسک نیست.']],
  ['P3-3', 'UI کامل', 'بازطراحی وب‌کنسول: ترمینال زنده، درخت فایل، diff viewer، نمای browser، مدیریت پروایدر و MCP، approval با جزئیات کامل؛ اپ دسکتاپ (Tauri یا Electron) و افزونه VS Code روی همان Agent Server.', 'web/*، clients/* (جدید)', 'XL', 'P1-3، P2',
   ['همه عملیات CLI از UI هم قابل انجام است.', 'approval آرگومان کامل و diff را نشان می‌دهد (بدون برش ۲۰۰ کاراکتری).', 'امتیاز accessibility در Lighthouse بیش از ۹۰.']],
  ['P3-4', 'سیستم پلاگین و Marketplace', 'پلاگین برای ابزار، پروایدر، sandbox، skill و persona با manifest و نسخه‌گذاری؛ نصب یک‌کلیکی سرورهای MCP محبوب؛ امضا و sandbox پلاگین‌ها.', 'agent/registry/*', 'L', 'P2-3',
   ['یک پلاگین ابزار نمونه بدون تغییر کد هسته نصب و استفاده می‌شود.', 'پلاگین بدون امضا فقط با تأیید صریح نصب می‌شود.']],
  ['P3-5', 'حالت چندکاربره و راه دور', 'TLS، OIDC، جلسات جدا برای هر کاربر، rate limit و حالت headless برای CI (اجرای عامل در GitHub Actions).', 'web/server/*', 'L', 'P0-4',
   ['دو کاربر هم‌زمان هیچ داده‌ای از یکدیگر نمی‌بینند (تست ماتریسی).', 'workflow نمونه GitHub Actions عامل را روی PR اجرا و نتیجه را کامنت می‌کند.']]
 ]]
];
phases.forEach(ph => { children.push(h2(ph[0])); children.push(p(ph[1])); ph[2].forEach(item); });
children.push(h2('جدول خلاصه زمان‌بندی'));
children.push(table(['فاز', 'بازه', 'خروجی کلیدی', 'معیار خروج فاز'], [
  ['P0', 'هفته ۱–۶', 'سیستم امن روی Linux', 'صفر یافته بحرانی یا بالای امنیتی باز؛ تست‌های امنیتی سبز'],
  ['P1', 'هفته ۶–۱۶', 'اجرای امن روی ۳ OS با ۸ پروایدر', 'CI ماتریسی سبز؛ sandbox فعال روی هر OS'],
  ['P2', 'هفته ۱۶–۳۰', 'GitHub، Browser، PTY و MCP کامل', 'سناریوی خودکار issue→PR موفق؛ اجرای benchmark SWE-bench Lite'],
  ['P3', 'هفته ۳۰–۴۴', 'نصب یک‌دستوری، UI و پلاگین', 'نصب روی ماشین تمیز هر OS زیر ۲ دقیقه؛ نسخه 1.0']
], [900, 1400, 3200, 3500]));

children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('۸. ریسک‌ها و پیوست'));
children.push(h2('ریسک‌ها'));
['**محدودیت این ممیزی:** بازبینی ایستا بود؛ پیش از شروع P0 باید npm test روی هر سه OS اجرا و یافته‌ها با تست بازتولید شوند.',
 '**sandbox در Windows** پیچیده‌ترین بخش است؛ پیشنهاد: Docker Desktop یا WSL به‌عنوان مسیر اصلی و AppContainer در مرحله بعد.',
 '**تفاوت رفتار پروایدرها** در tool calling و فرمت خروجی؛ تست contract با fixture ضبط‌شده ضروری است.',
 '**هزینه نگهداری adapterهای native**؛ می‌توان LiteLLM یا Vercel AI SDK را هم به‌عنوان adapter عمومی پشتیبانی کرد.',
 '**پیچیدگی موجود** (agent.js بزرگ و رجیستری ۲۰۰KB)؛ refactor باید با تست‌های contract فعلی محافظت شود.'].forEach(x => children.push(li(x)));
children.push(h2('پیوست: فهرست یافته‌های متوسط و پایین'));
var rest = findings.filter(x => x.severity === 'medium' || x.severity === 'low');
children.push(table(['شدت', 'حوزه', 'عنوان', 'فایل:خط'], rest.map(x => [sevFa[x.severity], x.area, x.title, x.file + (x.line ? ':' + x.line : '')]), [900, 1700, 4300, 2100]));
