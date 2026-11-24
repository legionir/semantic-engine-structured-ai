ممیزی کدبیس Structured AI

و نقشه راه تبدیل آن به یک عامل هوش مصنوعی همه‌فن‌حریف، چندسکویی و مستقل از پروایدر

مخزن: legionir/semantic-engine-structured-ai — پوشه structured-ai

تهیه‌شده برای: پویا رحیمی — آذر ۱۴۰۵ (نوامبر ۲۰۲۶)

روش: بازبینی ایستای کد (Static Review) توسط ۱۱ بازبین موازی؛ کد و تست‌ها اجرا نشده‌اند.

# ۱. خلاصه مدیریتی

structured-ai یک runtime چندعاملی سلسله‌مراتبی روی Node.js است که حدود ۳۱۷ فایل JavaScript دارد و از نظر معماری پیشرفته‌تر از یک MVP است: قرارداد اکشن ساخت‌یافته (JSON schema)، اجرای گراف ابزارها با وابستگی، Policy Engine و Approval، Hookها، کلاینت MCP با چهار transport، حافظه و فشرده‌سازی context، Event Store، CLI و REPL، کنسول وب و مجموعه تست گسترده. پایه برای ساخت یک عامل شبیه OpenHands مناسب است.

اما در وضعیت فعلی برای انتشار عمومی آماده نیست. سه مانع اصلی وجود دارد: (۱) **مدل اعتماد شکسته** — هر ریپوی کلون‌شده می‌تواند از طریق .agent/project.json و .mcp.json تنظیمات امنیتی را عوض کند یا فرمان دلخواه اجرا کند؛ (۲) **وابستگی به Linux** — sandbox فقط bwrap است، قواعد policy فقط مسیرهای «/» را می‌فهمند و CI فقط روی Ubuntu اجرا می‌شود؛ (۳) **قفل‌شدن روی یک پروایدر** — لایه LLM به‌صورت سخت به OpenAI Chat Completions گره خورده است.

| **شاخص**                      | **مقدار**                             |
| ----------------------------- | ------------------------------------- |
| کل یافته‌ها                   | ۲۳۶ (۲۲۹ مورد با خواندن کد تأیید شده) |
| بحرانی / بالا / متوسط / پایین | ۷ / ۵۳ / ۱۱۱ / ۶۵                     |
| امنیت / باگ / پایداری         | ۵۶ / ۵۵ / ۴۷                          |
| کمبود نسبت به هدف             | ۷۳ مورد                               |
| تخمین کل نقشه راه             | حدود ۱۰ تا ۱۴ ماه-نفر (۴ فاز)         |

### توصیه اصلی

بازنویسی از صفر لازم نیست. ترتیب درست: اول **امن‌سازی و ترمیم (P0)**، بعد **لایه Provider و Sandbox چندسکویی (P1)**، سپس **قابلیت‌های عامل همه‌فن‌حریف — GitHub، Browser، PTY، MCP کامل (P2)** و در آخر **توزیع، UI و اکوسیستم پلاگین (P3)**. هر فاز معیار پذیرش قابل تست دارد و تا P0 بسته نشده نباید نسخه عمومی منتشر شود.

# ۲. معماری فعلی

| **ماژول**                        | **نقش**                                                                | **نکته کلیدی**                                         |
| -------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| agent/agent.js (۹۶KB)            | هسته: ساخت درخواست، فراخوانی LLM، حلقه تکرار                           | فایل خدا (God file)؛ transport سخت‌کد OpenAI           |
| agent/actions                    | Parse، Validate و Repair پاسخ ساخت‌یافته مدل                           | ResponseRepair قوی؛ NativeToolCallAdapter موجود        |
| agent/runtime                    | AgentRun، IterationRunner، ToolGraphExecutor، Scheduler، Budget        | depends_on شکست را منتقل نمی‌کند                       |
| agent/tools                      | filesystem، process، git، network، search، code، planning، memory، mcp | GitHub/Browser/PTY وجود ندارد                          |
| agent/mcp                        | کلاینت MCP: stdio، HTTP، SSE، WebSocket                                | framing غیراستاندارد؛ درخواست‌های server→client نادیده |
| agent/policy + hooks             | PolicyEngine، ApprovalManager، HookRunner                              | fail-open؛ قواعد POSIX-only                            |
| agent/config + cli + interactive | Settings schema، CLI، REPL                                             | فقط یک endpoint سازگار با OpenAI                       |
| agent/persistence + context      | EventStore، Journal، Archive، Memory، WorkspaceBoundary                | اسرار بدون redact ذخیره می‌شوند                        |
| web/server + public              | کنسول وب و API                                                         | مشکلات احراز هویت و scope توکن                         |
| agent/registry                   | tools.json، policy.json، agents.json، personas                         | رجیستری غنی ولی بدون overlay پلاگین                    |
| test + ci                        | ~۶۰ فایل تست، دو workflow                                              | فقط Linux؛ sandbox و پروایدرها تست نمی‌شوند            |

### نقاط قوت

- قرارداد اکشن ساخت‌یافته با schema سخت‌گیر و مکانیزم تعمیر پاسخ — پایه‌ای بهتر از بسیاری از عامل‌های متن‌باز.
- اجرای گرافی ابزارها و عامل‌های فرعی (delegation) با بودجه، لغو و زمان‌بندی.
- Event Store به‌عنوان منبع حقیقت، Journal و Archive — مناسب برای replay و observability.
- Policy Engine و Approval و Hook موجود است؛ فقط باید سخت‌گیرانه و چندسکویی شود.
- پوشش تست گسترده (contract، e2e، web، mcp، persistence).

# ۳. یافته‌های بحرانی و مهم

جدول زیر هفت یافته بحرانی را با شرح فارسی نشان می‌دهد. فهرست کامل ۵۳ یافته «بالا» در جدول بعد و همه یافته‌ها در پیوست آمده است.

| **#** | **مشکل**                                               | **محل**                                                       | **اثر**                                                                                        | **راه‌حل**                                                      |
| ----- | ------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| C1    | ریپوی غیرقابل‌اعتماد تنظیمات امنیتی را override می‌کند | agent/cli/Cli.js:1025، agent/projects/WorkspaceProfile.js:431 | کلون یک ریپوی مخرب approval را auto، sandbox را خاموش و base URL را به سرور مهاجم تغییر می‌دهد | لیست کلیدهای ممنوع برای project config + Workspace Trust store  |
| C2    | دور زدن trust gate سرورهای MCP پروژه با mcp_call       | agent/mcp/McpManager.js:425                                   | اجرای فرمان دلخواه از .mcp.json ریپو                                                           | اعمال trust در تمام مسیرهای فراخوانی و spawn                    |
| C3    | stdio پیش‌فرض Content-Length به‌جای NDJSON             | agent/mcp/transports/StdioTransport.js:303                    | سرورهای رسمی MCP (npx @modelcontextprotocol/...) کار نمی‌کنند                                  | پیش‌فرض NDJSON طبق spec؛ Content-Length فقط با opt-in           |
| C4    | نبود sandbox در Windows و macOS                        | agent/tools/process/ProcessManager.js:66                      | ترمینال یا غیرفعال است یا کاملاً بدون محافظت                                                    | لایه SandboxProvider: Docker/Podman، seatbelt، AppContainer/WSL |
| C5    | کرش کل وب‌سرور با یک درخواست خراب                      | web/server/Router.js:104                                      | DoS بدون احراز هویت (URIError از %E0)                                                          | try/catch در decodeURIComponent و Host parsing؛ پاسخ 400        |
| C6    | توکن scope‌دار می‌تواند هر تنظیمی را تغییر دهد         | web/server/ServerImplementation.js:2945                       | ارتقای دسترسی؛ تغییر AGENT_CONSOLE_TOKENS و endpoint                                           | مجوز admin برای settings؛ allowlist کلیدها                      |
| C7    | Policy پیش‌فرض fail-open و ابزارهای MCP بدون approval  | agent/registry/policy.json:2                                  | ابزار جدید یا MCP آلوده بدون تأیید اجرا می‌شود                                                 | default_action=ask؛ MCP پیش‌فرض restricted                      |

## یافته‌های با اهمیت بالا (53 مورد)

عنوان‌ها و توضیحات به زبان فنی اصلی (انگلیسی) آمده‌اند تا مستقیم قابل تبدیل به issue باشند.

| **حوزه**                     | **عنوان**                                                                                                                                              | **فایل:خط**                                   | **راه‌حل**                                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| config_providers             | Invalid CLI values are silently swallowed by settings.set but remain in process.env, so every later settings.get() throws mid-run                      | agent/cli/Cli.js:1039                         | Validate flag values with SettingsSchema.coerce inside applyEnvironment and fail() with exit code 2; only catch the specific 'fixed' error in the set loop. Also make resolve() fall back to the default (with a one-time wa             |
| config_providers             | Settings model only supports a single OpenAI-compatible endpoint shape; no provider type, auth scheme or headers                                       | agent/config/SettingsSchema.js:29             | Introduce a provider registry: AGENT_PROVIDER enum (openai, anthropic, gemini, azure, openrouter, ollama, openai_compatible) plus per-tier ENDPOINT_\*\_PROVIDER, EXTRA_HEADERS (JSON) and per-model capability flags (tools,            |
| config_providers             | REPL drain loop has no error handling: one failing /command crashes or wedges the session                                                              | agent/interactive/Repl.js:494                 | Wrap each queue item in try/catch inside drain and reset \`draining\` in finally; catch errors in handleCommand and print them; add \`.catch()\` on drain() calls.                                                                       |
| config_providers             | Approval prompt truncates the arguments to 200 chars and consumes type-ahead lines as the answer                                                       | agent/interactive/ApprovalPrompt.js:7         | Show the full command (or a paged diff for writes) with an explicit 'view full' option; flush/ignore queued type-ahead when an approval starts and only accept input entered after the prompt is printed; offer 'always allo             |
| config_providers             | Process exits without (or before) awaiting lifecycle shutdown in several paths                                                                         | agent/cli/Cli.js:1001                         | Centralise exit in one async \`exitWith(code)\` that awaits lifecycle.shutdown with a timeout; use it in every path including SIGINT (first ^C = graceful cancel+shutdown, second ^C = force exit). On Windows kill child tree           |
| config_providers             | Backfill attributes every event after the first run:start to the first run                                                                             | bin/backfill-eventstore.js:103                | Close the previous run's range when a new run:start appears (end = nextStart-1), or pick the run with the greatest start <= seq; include session id in the dedupe key; add a unit test with two runs in one session.                     |
| config_providers             | Process sandbox modes are Linux-only (deny \| bwrap \| test)                                                                                           | agent/config/SettingsSchema.js:889            | Add \`docker\`/\`podman\` (cross-OS, OpenHands-style runtime container), \`macos-seatbelt\`, \`windows-appcontainer\`/job-object modes, plus an explicit \`host\` mode gated by approval; rename \`test\` so it cannot be chosen by mist |
| core_agent                   | Repository detection runs \`git status\` in the workspace on every prompt build - untrusted repo config can execute code outside policy/sandbox        | agent/agent.js:1016                           | Run git with hardened args: \`git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c protocol.file.allow=never --no-optional-locks status --porcelain\`, set GIT_CONFIG_NOSYSTEM=1 / GIT_TERMINAL_PROMPT=0, and route repo           |
| core_agent                   | Synchronous git subprocesses on every iteration block the event loop for all concurrent runs                                                           | agent/prompt/RuntimeContextBuilder.js:41      | Make detection async (execFile with promisify) and cache it per run/project with a short TTL or invalidate only after git-mutating tools run (git_add/git_commit/git_checkout, terminal_exec).                                           |
| core_agent                   | LLM transport is hard-wired to OpenAI Chat Completions (URL, auth header, body shape)                                                                  | agent/agent.js:2653                           | Introduce a ProviderAdapter interface (buildRequest, send, parseResponse -> normalized {content, tool_calls, reasoning, usage, finish_reason}, classifyError) with implementations for openai/openai-compatible, anthropic,              |
| mcp                          | Requests from the server to the client (roots/list, sampling, ping, elicitation) are silently dropped, though the client advertises roots and sampling | agent/mcp/McpConnection.js:197                | Add a server-request dispatcher in McpClient: answer \`ping\`, answer \`roots/list\` with the project workspace root(s), and route \`sampling/createMessage\` to the LLM provider layer behind an approval gate. Return JSON-RPC e       |
| mcp                          | Model-callable mcp_add can spawn arbitrary commands and self-declare trust:'trusted'                                                                   | agent/tools/mcp/McpTools.js:273               | Always require human approval for mcp_add/mcp_remove (policy rule), ignore \`trust\` from model arguments (default to 'restricted'), default MCP_ALLOW_RUNTIME_ADD to false for non-interactive runs, and run stdio servers in           |
| mcp                          | Repo-controlled config expands arbitrary environment variables into URLs and headers (secret exfiltration)                                             | agent/mcp/McpConfigValidator.js:105           | Apply trust to remote servers from project sources too, or at least to any entry that uses env expansion. Restrict expansion to an allowlist or to variables explicitly declared in user-level config, and never expand into             |
| mcp                          | Full process environment, including all LLM/GitHub secrets, is inherited by every stdio MCP server                                                     | agent/mcp/transports/StdioTransport.js:185    | Start from a minimal allowlisted environment (PATH, HOME/USERPROFILE, SystemRoot, TEMP, APPDATA, LANG and similar), add only \`config.env\`, and make inheritance opt-in (\`inheritEnv: true\`).                                         |
| mcp                          | Unhandled 'error' on child.stdin (EPIPE) can crash the whole runtime                                                                                   | agent/mcp/transports/StdioTransport.js:316    | Attach \`child.stdin.on('error', e => this.diagnose(...))\` (and the same on stdout/stderr) right after spawn. Respect write() backpressure ('drain').                                                                                   |
| mcp                          | Windows: npx/npm-shim commands cannot be spawned (no shell, no .cmd resolution)                                                                        | agent/mcp/transports/StdioTransport.js:177    | Resolve the command with PATHEXT (or a \`which\` implementation). For .cmd/.bat, either spawn \`cmd.exe /d /s /c\` with carefully quoted args or resolve npx to \`node &lt;npm-cli.js&gt;\`. Add Windows CI coverage for stdio servers.  |
| mcp                          | Tool names generated for the LLM can violate provider naming rules (dots, length > 64)                                                                 | agent/mcp/McpCatalogue.js:18                  | Sanitize to \[A-Za-z0-9_-\], truncate with a short hash suffix to ≤64 chars, keep a reverse map (sanitized → {server, tool}) in the catalogue instead of re-parsing the name, and forbid '\__' in server names.                          |
| persistence_context_projects | Dangling symlinks bypass the workspace boundary and rejectSymlinks check                                                                               | agent/context/WorkspaceBoundary.js:280        | Use fs.lstatSync in try/catch (ENOENT => absent) instead of existsSync for every component and in nearestExistingPath; reject any symlink component when rejectSymlinks is set; write via temp file + rename (rename replace             |
| persistence_context_projects | Project id from HTTP body is not validated and becomes a filesystem path (path traversal)                                                              | agent/projects/ProjectRegistry.js:160         | Validate ids against /^prj-\[a-z0-9-\]{1,64}\$/ (reject '.', '..', separators, reserved device names) or ignore caller-supplied ids; assert the resolved dataRoot stays inside &lt;dataHome&gt;/projects.                                |
| persistence_context_projects | Event store, journal, archive and sessions persist secrets unredacted                                                                                  | agent/persistence/EventStoreRepository.js:133 | Apply a value-level secret scanner (reuse config/SecretMasker + regexes for sk-, ghp_, AKIA, Bearer, PEM blocks) before every durable write; make retention configurable; create data files with 0600 permissions.                       |
| persistence_context_projects | foldIntoMemory drops exchanges even when the archive copy failed                                                                                       | agent/context/MemoryCoordinator.js:602        | If archived?.archiveFailed, skip the splice (keep exchanges, only refresh the memory message); add a test mirroring the compactor's archiveFailed test.                                                                                  |
| persistence_context_projects | Persistent memory.json is a cross-run prompt-injection vector                                                                                          | agent/context/MemoryCoordinator.js:435        | Inject memory as clearly delimited untrusted data (not system authority), keep provenance per item, quarantine facts from web/browser/MCP tools, and expose view/edit/clear for memory in UI/CLI.                                        |
| policy_hooks                 | process_write is ungated: an approved/background shell accepts arbitrary commands with no policy check                                                 | agent/registry/policy.json:135                | Add process_write (and process_terminate) to the require_approval rule, or target the whole \`process\` group; apply the destructive-command deny patterns to \`input\` too; long term, enforce at the sandbox/OS layer rather t         |
| policy_hooks                 | mcp_call gateway bypasses the 'restricted' MCP server trust setting                                                                                    | agent/policy/PolicyEngine.js:134              | In mcpEscalation, resolve the target server for mcp_call (same parsing as McpTools.mcpCall) and look up its trust; add a regression test for both mcp_call shapes.                                                                       |
| policy_hooks                 | Cached gateway approvals override AGENT_APPROVAL=deny and MCP_APPROVAL=always, never expire, and auto-mode answers get cached as approvals             | agent/policy/ApprovalManager.js:112           | Check the mode first and never serve the cache when mode is deny or MCP_APPROVAL=always. Cache only explicit operator answers (not auto). Key the cache by (project, server, tool) with a TTL. Expose a revoke API/UI and cl             |
| policy_hooks                 | Deny rules for .git and policy.json use '/' only, so Windows backslash paths get past them                                                             | agent/registry/policy.json:45                 | Normalize path-like arguments before matching (resolve against the workspace root, convert to forward slashes, collapse duplicate slashes, strip trailing dots/spaces, and lower-case on Windows/macOS). Better still, add a             |
| policy_hooks                 | Hook template interpolation injects task text and changed-file names unescaped into shell commands                                                     | agent/hooks/HookRenderer.js:110               | Give shell arguments a separate 'argv' form (command + args array, no shell). If interpolation has to target shell strings, quote per platform (POSIX single quotes / PowerShell escaping), or ban templates inside terminal             |
| registry_discussion          | Path-protection policy regexes only match '/' separators, so Windows-style paths bypass the .git and policy.json deny rules                            | agent/registry/policy.json:42                 | Canonicalize path-like arguments before policy evaluation: path.resolve against the workspace, convert to forward slashes, lowercase on case-insensitive filesystems, and resolve symlinks. Match rules against the canonica             |
| registry_discussion          | Shell 'irrecoverable command' deny list is POSIX-only and easy to bypass                                                                               | agent/registry/policy.json:152                | Treat regex deny lists as advisory only. Enforce safety with a real sandbox (container/VM/AppContainer/seatbelt) and an allowlist of command prefixes. Parse commands with a shell tokenizer (shell-quote for POSIX, a Power             |
| registry_discussion          | Policy fails open: default_action is 'allow', and all MCP server tools are allowed without approval                                                    | agent/registry/policy.json:2                  | Switch default_action to require_approval (or deny), allowlist read-only groups explicitly, and make MCP calls require approval unless the server is explicitly marked trusted. Have RegistryValidator warn when an implemen             |
| registry_discussion          | Observer output that is not pure JSON immediately ends the discussion                                                                                  | agent/discussion/observerRunner.js:79         | Extract the first balanced {...} object, request response_format json_object/json_schema when the provider supports it, retry once with a corrective message on parse failure, and only then force a finish. Validate the de             |
| runtime                      | Dependent tool calls / delegations still execute after their dependency failed                                                                         | agent/runtime/ToolGraphExecutor.js:395        | In executeDependencyGraph, when a dependency result has success:false, publish the dependent as skipped (code DEPENDENCY_FAILED) without calling the executor, unless the item opts in with e.g. run_if:'always'. Add tests              |
| runtime                      | Cancellation requested before startRun attaches a controller is silently lost                                                                          | agent/runtime/RunCancellation.js:52           | Create the AbortController in the AgentRunContext constructor (or keep a 'pendingCancel' flag that startRun honours), record the reason in RunCancellation.abort(reason) and pass it to controller.abort(reason). Make cance             |
| tests_ci_packaging           | Process/tool tests depend on POSIX shell utilities and fail on Windows                                                                                 | test/tools/tools.test.js:489                  | Write test commands as \`node -e\` one-liners (e.g. \`node -e "setTimeout(()=>{},5000)"\`, \`node -e "process.stdin.pipe(process.stdout)"\`). Find survivors with a cross-platform helper (tasklist/wmic on win32, ps elsewhere),        |
| tests_ci_packaging           | CI covers Linux only; no Windows/macOS matrix and an EOL Node version                                                                                  | ../.github/workflows/test.yml:40              | Add \`os: \[ubuntu-latest, windows-latest, macos-latest\]\` and \`node: \[20, 22, 24\]\`. Raise engines to >=20. Add a job timeout (timeout-minutes) and upload test logs as artifacts.                                                  |
| tests_ci_packaging           | The process sandbox (bwrap) and deny mode are never tested; every process test runs unsandboxed                                                        | test/tools/tools.test.js:19                   | Add a Linux CI job that installs bubblewrap and runs the process suite with PROCESS_SANDBOX_MODE=bwrap, asserting no network, a read-only /usr and a writable workspace only. Add unit tests that deny mode rejects terminal             |
| tests_ci_packaging           | The Docker image cannot run tools safely: no bubblewrap, no git, and both approval and process execution denied                                        | Dockerfile:1                                  | Install git, ca-certificates and bubblewrap (or document a gVisor/Docker-level sandbox mode in which the container itself is the sandbox). Drop the dead ALLOW_UNSANDBOXED_PROCESS. Provide a \`--serve\` variant with EXPOSE,           |
| tests_ci_packaging           | No tests for non-OpenAI providers, streaming or native tool-calling                                                                                    | test/e2e/e2e.test.js:21                       | Introduce a provider adapter interface, then a shared contract test suite run against recorded fixtures (golden request/response JSON) for each adapter: OpenAI, Anthropic, Gemini, Ollama, OpenRouter, Azure. Cover streami             |
| tests_ci_packaging           | No real cross-platform installer or distribution story                                                                                                 | package.json:4                                | Publish under a scoped name with a distinctive bin (e.g. \`structured-ai\`/\`sai\`), add a \`files\` allowlist, a \`sai doctor\` command that checks dependencies per OS, a release workflow that builds Node SEA or pkg binaries fo     |
| tools_other                  | SSRF bypass: IPv4-mapped IPv6 in hex form is not classified                                                                                            | agent/tools/network/NetworkTools.js:108       | Parse IPv6 to bytes (net.BlockList or ipaddr.js), unwrap ::ffff:0:0/96, ::/96, 64:ff9b::/96 and 2002::/16 to the embedded IPv4, and use net.BlockList for both families. Add unit tests for hex-mapped forms.                            |
| tools_other                  | Caller headers (Authorization/Cookie) and POST body forwarded across cross-origin redirects                                                            | agent/tools/network/NetworkTools.js:222       | On redirect drop Authorization/Cookie/Proxy-Authorization when the origin changes, switch to GET without body on 301/302/303, preserve method+body only for 307/308.                                                                     |
| tools_other                  | GitHub/remote workflow is absent from git tools                                                                                                        | agent/tools/git/GitTools.js:290               | Add git_clone/fetch/pull/push/show/blame/stash with GIT_TERMINAL_PROMPT=0 and credential helpers, plus a GitHub tool group (REST/GraphQL) for PRs, issues, reviews and checks, gated by policy.                                          |
| tools_other                  | Search regex runs synchronously on the event loop (ReDoS) and reads whole files                                                                        | agent/tools/search/SearchTools.js:140         | Skip files over a MAX_SEARCH_FILE_BYTES setting, stream lines, run regex in a worker_thread with a deadline (or use RE2 / bundled ripgrep), and yield periodically.                                                                      |
| tools_other                  | code_rename misreads LSP WorkspaceEdit shapes                                                                                                          | agent/tools/code/LiveLspTools.js:200          | Accept raw.workspaceEdit.changes and documentChanges, convert URIs with url.fileURLToPath, then boundary-check.                                                                                                                          |
| tools_process_fs             | Dangling symlinks bypass the workspace boundary on write (fs_write / fs_mkdir)                                                                         | agent/context/WorkspaceBoundary.js:165        | Walk path components with fs.lstatSync (catch ENOENT) instead of existsSync; refuse any symlink component, dangling or not, for mutating ops; open final files with O_NOFOLLOW (POSIX) and O_EXCL for creates; add a regress             |
| tools_process_fs             | fs_delete and fs_move act on the symlink TARGET, not the link                                                                                          | agent/tools/filesystem/DirectoryTools.js:340  | Add a resolve option that canonicalises only the parent (realpath(dirname) + basename) and lstat the leaf; delete/rename the link itself; reject or explicitly handle symlink leaves.                                                    |
| tools_process_fs             | Unsandboxed mode leaks the full host environment (API keys) to commands                                                                                | agent/tools/process/ProcessManager.js:106     | Always build an allow-listed env (PATH, HOME, LANG, TEMP/SystemRoot on Windows, plus configured passthrough) and strip \*\_KEY/\*\_TOKEN/\*SECRET\* variables.                                                                           |
| tools_process_fs             | bwrap profile is brittle and breaks common toolchains                                                                                                  | agent/tools/process/ProcessManager.js:75      | Use --ro-bind-try for optional dirs, bind selected /etc files, make network a policy option (none or allowlist proxy), allow configurable extra ro-binds, add --new-session and --unshare-user, and add a bwrap smoke test i             |
| tools_process_fs             | process_write has no stdin error handler, so EPIPE can crash the runtime                                                                               | agent/tools/process/BackgroundSession.js:335  | Attach child.stdin.on('error', ...) at spawn time (record it into session stderr), await the write callback, and return a structured error.                                                                                              |
| web                          | Approvals can be answered by any token, with no project check                                                                                          | web/server/ServerImplementation.js:2808       | Look up the pending request first. Authorize project:write on request.project_id, and require master claims when project_id is null. Generate IDs with crypto.randomUUID(). Record who approved and emit it in approval:reso             |
| web                          | Any token can switch the approval mode to 'auto' and add MCP servers that run arbitrary commands                                                       | web/server/ServerImplementation.js:2900       | Gate these routes on master or admin claims. Default MCP_ALLOW_RUNTIME_ADD to false for web-originated requests, or require an explicit confirmation step. Validate MCP command against an allowlist. Log every control-plan             |
| web                          | Session and call-record endpoints ignore project scoping and leak cross-project data                                                                   | web/server/ServerImplementation.js:1809       | Tag sessions and calls with project_id. Filter or authorize them by claims the same way snapshotFor does. Pass the tool payloads through redact() before returning them, and return them only to callers allowed on that pro             |
| web                          | Background project runs stamp approvals with the foreground turn, so the foreground run auto-denies them when it finishes                              | web/server/ServerImplementation.js:713        | Derive ownership from the run's own context (AsyncLocalStorage, or the runManager's current run ID and project ID) instead of the shared \`state\`. Give background runs their own turn_id and the same lifecycle hooks: messa           |

# ۴. یافته‌های متوسط و پایین

| **حوزه**                     | **بحرانی** | **بالا** | **متوسط** | **پایین** | **جمع** |
| ---------------------------- | ---------- | -------- | --------- | --------- | ------- |
| config_providers             | 1          | 7        | 12        | 5         | 25      |
| core_agent                   | 0          | 3        | 8         | 11        | 22      |
| mcp                          | 2          | 7        | 10        | 5         | 24      |
| persistence_context_projects | 1          | 5        | 12        | 7         | 25      |
| policy_hooks                 | 0          | 5        | 10        | 5         | 20      |
| registry_discussion          | 0          | 4        | 10        | 5         | 19      |
| runtime                      | 0          | 2        | 9         | 8         | 19      |
| tests_ci_packaging           | 0          | 6        | 8         | 4         | 18      |
| tools_other                  | 0          | 5        | 12        | 6         | 23      |
| tools_process_fs             | 1          | 5        | 11        | 5         | 22      |
| web                          | 2          | 4        | 9         | 4         | 19      |

### الگوهای تکرارشونده

- **تنظیمات نامعتبر بی‌صدا پذیرفته می‌شوند** و بعداً وسط اجرا خطا می‌دهند (مثلاً --temperature 3).
- **عملیات همگام (sync) روی event loop**: git در هر iteration، regex جستجو، خواندن کامل فایل — همه عامل‌های هم‌زمان را قفل می‌کند.
- **مدیریت خطای stream ناقص**: EPIPE روی stdin فرزندان (MCP و process_write) کل runtime را از کار می‌اندازد.
- **مسیرها و سیگنال‌ها POSIX-محور**: جداکننده «/»، SIGTERM، ابزارهای sleep/cat در تست‌ها.
- **داده حساس در دیسک**: event store، journal، archive و memory بدون redact و بدون محدودیت مجوز فایل.
- **بستن ناقص چرخه حیات**: خروج پروسه قبل از flush کردن journal و kill سرورهای MCP.
- **مستندات و کد ناهمگام**: چند رفتار در README با کد واقعی تفاوت دارد.

# ۵. کمبودها نسبت به هدف

| **قابلیت**           | **وضعیت فعلی**                                   | **آنچه لازم است**                                                                                                                        |
| -------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| اتصال به هر پروایدر  | فقط OpenAI Chat Completions با یک base URL       | Provider adapterهای native: OpenAI/Responses، Anthropic، Gemini، Azure، Bedrock، Ollama، OpenRouter؛ metadata قابلیت مدل؛ fallback chain |
| Sandbox چندسکویی     | فقط bwrap روی Linux؛ در بقیه deny یا بدون محافظت | SandboxProvider با Docker/Podman (پیش‌فرض)، macOS seatbelt، Windows AppContainer/WSL، محدودیت منابع و egress                             |
| ترمینال تعاملی (PTY) | spawn ساده بدون PTY                              | node-pty / ConPTY، نشست shell پایدار، stream زنده خروجی به UI، interrupt                                                                 |
| GitHub               | فقط git محلی (status/diff/commit)                | clone/push/PR/issue/review/checks از طریق GitHub App یا MCP رسمی GitHub با credential امن                                                |
| Browser              | ندارد؛ فقط fetch با محافظ SSRF                   | Playwright: navigate، click، type، screenshot، accessibility tree؛ در sandbox                                                            |
| MCP کامل             | transportها هستند ولی spec-compliance ناقص       | NDJSON، roots/sampling/elicitation/ping، OAuth 2.1، list_changed، نام‌گذاری سازگار با پروایدرها                                          |
| نصب روی هر OS        | private npm package؛ Docker ناقص                 | npm/npx، باینری مستقل (Node SEA)، Homebrew، winget/Scoop، deb/rpm، اسکریپت install، agent doctor                                         |
| Observability        | Telemetry داخلی                                  | OpenTelemetry، شمارش توکن و هزینه برای هر پروایدر، replay جلسه                                                                           |
| ویرایش کد            | fs_write/fs_edit ساده                            | apply_patch، چند ویرایش، checkpoint و undo، نمایش diff                                                                                   |
| Security Analyzer    | ندارد                                            | طبقه‌بندی ریسک هر اکشن (قاعده + LLM) مانند OpenHands                                                                                     |

# ۶. معماری هدف

هدف یک سیستم لایه‌ای است که در آن هسته عامل از پروایدر، محیط اجرا و رابط کاربری مستقل باشد. هر لایه یک interface دارد و پیاده‌سازی‌ها پلاگین‌پذیرند.

| **لایه**                    | **مسئولیت**                          | **طراحی پیشنهادی**                                                                                                         |
| --------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Interfaces                  | CLI، TUI، Web، Desktop، VS Code، API | همه کلاینت یک Agent Server (HTTP + WebSocket/SSE) هستند؛ پروتکل رویداد مشترک                                               |
| Agent Core                  | حلقه عامل، برنامه‌ریزی، delegation   | شکستن agent.js به AgentLoop، Planner، ContextAssembler؛ state machine صریح و قابل resume                                   |
| Provider Layer              | اتصال به هر LLM                      | interface واحد LLMProvider: chat، stream، toolCalls، tokenCount، capabilities؛ Router با fallback و انتخاب مدل برای هر نقش |
| Tool Layer                  | ابزارهای داخلی + MCP + پلاگین        | ToolSpec واحد (JSON Schema)، مسیر اجرای واحد که همیشه از Policy عبور می‌کند                                                |
| Policy & Security           | Trust، Approval، Risk Analyzer       | deny-by-default، workspace trust، risk tiers، audit log ضد دست‌کاری                                                        |
| Runtime/Sandbox             | اجرای امن shell، فایل، browser       | SandboxProvider: docker \| podman \| seatbelt \| appcontainer \| wsl \| bwrap \| none؛ PTY؛ محدودیت منابع و شبکه           |
| Memory & Context            | حافظه کوتاه/بلند، فشرده‌سازی         | بودجه توکن بر اساس پنجره مدل، provenance حافظه، اتصال اختیاری به semantic-engine                                           |
| Persistence & Observability | رویداد، جلسه، trace                  | SQLite (WAL) برای جلسات؛ OpenTelemetry؛ redact پیش از ذخیره                                                                |
| Distribution                | نصب و به‌روزرسانی                    | باینری مستقل، package managerها، تصاویر Docker، auto-update امضاشده                                                        |

## مقایسه با OpenHands

| **حوزه**       | **OpenHands**     | **Structured AI (هدف)**                                       |
| -------------- | ----------------- | ------------------------------------------------------------- |
| قرارداد اکشن   | function calling  | اکشن ساخت‌یافته با schema + repair + function calling native  |
| چندعاملی       | delegation محدود  | سلسله‌مراتب عامل‌ها، اجرای گرافی موازی، discussion/personas   |
| Runtime        | وابسته به Docker  | Docker + sandboxهای native هر OS؛ اجرای سبک بدون Docker       |
| پروایدرها      | از طریق LiteLLM   | adapterهای native + Router با fallback و مدل جدا برای هر نقش  |
| MCP            | پشتیبانی کلاینت   | کلاینت کامل + OAuth + marketplace سرورها + policy per-tool    |
| درک کد         | ابزارهای عمومی    | semantic-engine (ایندکس، LSP، blueprint) به‌عنوان مزیت رقابتی |
| Hooks و Policy | Security Analyzer | Policy Engine + Hooks + Risk Analyzer + audit                 |
| حافظه          | condenser         | حافظه پایدار پروژه با provenance و آرشیو بدون اتلاف           |

# ۷. نقشه راه اولویت‌بندی‌شده

هر آیتم شامل شناسه، شرح، فایل‌های اصلی، تلاش تخمینی (S: کمتر از ۳ روز، M: ۱ تا ۲ هفته، L: ۳ تا ۶ هفته، XL: بیش از ۶ هفته)، وابستگی و **معیار پذیرش** قابل تست است. یک آیتم فقط وقتی «انجام‌شده» است که همه معیارهایش با تست خودکار در CI اثبات شوند.

## P0 — امن‌سازی و ترمیم بحرانی (هفته ۱ تا ۶)

هیچ انتشار عمومی قبل از بستن این فاز. هدف: هیچ یافته بحرانی یا بالای امنیتی باز نماند.

### P0-1 — Workspace Trust و قفل تنظیمات حساس

تفکیک تنظیمات کاربر از تنظیمات ریپو. کلیدهایی مثل AGENT_APPROVAL، base URL، API key، sandbox mode و MCP trust هرگز از .agent/project.json قابل override نیستند. اولین باز کردن هر پوشه نیاز به تأیید trust دارد.

**فایل‌ها:** agent/cli/Cli.js، agent/projects/WorkspaceProfile.js، agent/config/SettingsResolver.js | **تلاش:** M | **وابستگی:** —

**معیارهای پذیرش:**

- ریپوی تستی با project.json که approval=auto و baseUrl مهاجم دارد، هیچ‌کدام را اعمال نمی‌کند و هشدار ثبت می‌شود.
- پوشه untrusted بدون تأیید کاربر هیچ MCP stdio و hook ای اجرا نمی‌کند.
- trust store در مسیر کاربر (~/.config یا %APPDATA%) ذخیره و قابل لغو است.

### P0-2 — اعمال Policy در تمام مسیرها و deny-by-default

یک choke point واحد برای اجرای ابزار؛ mcp_call، mcp_add، process_write و delegation همگی از PolicyEngine عبور کنند. default_action=ask؛ MCP پیش‌فرض restricted؛ approval کش‌شده TTL دارد و حالت deny را نقض نمی‌کند.

**فایل‌ها:** agent/policy/\*، agent/registry/policy.json، agent/mcp/McpManager.js، agent/tools/mcp/McpTools.js | **تلاش:** M | **وابستگی:** P0-1

**معیارهای پذیرش:**

- تست contract: هر ابزار ثبت‌شده بدون قاعده صریح → ask.
- mcp_call روی سرور restricted همیشه approval می‌خواهد؛ mcp_add نمی‌تواند trust=trusted تعیین کند.
- با AGENT_APPROVAL=deny هیچ approval کش‌شده‌ای اجرا را مجاز نمی‌کند.
- process_write روی shell باز، هر خط را از policy فرمان عبور می‌دهد.

### P0-3 — نرمال‌سازی مسیر و ایمنی symlink

canonicalize همه مسیرها (realpath روی والد برای فایل‌های جدید)، تطبیق case-insensitive در Windows، رد symlink معلق و اجرای delete/move روی خود لینک.

**فایل‌ها:** agent/context/WorkspaceBoundary.js، agent/tools/filesystem/\* | **تلاش:** M | **وابستگی:** —

**معیارهای پذیرش:**

- symlink معلق به خارج workspace: fs_write رد می‌شود.
- مسیر src\\.git\\hooks\\x در Windows توسط قاعده deny گرفته می‌شود.
- fs_delete روی لینک فقط لینک را حذف می‌کند (تست روی هر سه OS).

### P0-4 — ایمنی وب‌سرور و مجوزها

جلوگیری از کرش با ورودی خراب؛ مجوزهای scope‌دار برای settings، approvals، sessions و MCP؛ تغییرات حساس فقط برای admin.

**فایل‌ها:** web/server/Router.js، web/server/ServerImplementation.js | **تلاش:** M | **وابستگی:** P0-2

**معیارهای پذیرش:**

- fuzz test با ۱۰۰۰ مسیر و Host خراب: سرور زنده می‌ماند و 400 برمی‌گرداند.
- توکن project:read برای settings، approvals پروژه دیگر و افزودن MCP پاسخ 403 می‌گیرد.
- هیچ endpoint داده پروژه دیگر را برنمی‌گرداند (تست ماتریسی توکن × endpoint).

### P0-5 — جداسازی اسرار

محیط فرزندان (MCP، shell، hook) فقط از allowlist ساخته شود؛ redact مقداری اسرار پیش از ذخیره؛ مجوز 0600 فایل‌ها؛ ممنوعیت \${ENV} در config ریپو.

**فایل‌ها:** agent/mcp/transports/StdioTransport.js، agent/tools/process/ProcessManager.js، agent/persistence/\*، agent/events/EventRedactor.js | **تلاش:** M | **وابستگی:** P0-1

**معیارهای پذیرش:**

- سرور MCP تستی env را چاپ می‌کند: هیچ \*\_API_KEY یا GITHUB_TOKEN دیده نمی‌شود.
- جستجو در data root پس از اجرا با کلید ساختگی هیچ تطابقی ندارد.
- url حاوی \${OPENAI_API_KEY} در .mcp.json ریپو رد می‌شود.

### P0-6 — سازگاری MCP stdio با spec و مقاومت stream

پیش‌فرض NDJSON؛ پاسخ به roots/list و ping؛ handler خطا روی stdin/stdout همه فرزندان؛ پاک‌سازی نام ابزارها برای پروایدرها.

**فایل‌ها:** agent/mcp/transports/StdioTransport.js، agent/mcp/McpConnection.js، agent/mcp/McpCatalogue.js، agent/tools/process/BackgroundSession.js | **تلاش:** S–M | **وابستگی:** —

**معیارهای پذیرش:**

- اتصال موفق به @modelcontextprotocol/server-filesystem و server-everything در CI.
- kill کردن سرور حین نوشتن، runtime را کرش نمی‌دهد (تست EPIPE).
- همه نام ابزارها با الگوی ^\[a-zA-Z0-9_-\]{1,64}\$ مطابق‌اند.

### P0-7 — رفع باگ‌های پایداری runtime

توقف اجرای وابسته‌ها پس از شکست dependency؛ حفظ لغو پیش از startRun؛ await کامل shutdown؛ مدیریت خطای REPL؛ اعتبارسنجی CLI پیش از اجرا.

**فایل‌ها:** agent/runtime/ToolGraphExecutor.js، agent/runtime/RunCancellation.js، agent/cli/Cli.js، agent/interactive/Repl.js | **تلاش:** M | **وابستگی:** —

**معیارهای پذیرش:**

- گراف A→B که A شکست می‌خورد: B با وضعیت skipped گزارش می‌شود.
- cancel بین admission و start اجرا را متوقف می‌کند.
- \--temperature 3 بلافاصله خطای استفاده می‌دهد.
- پس از SIGINT همه زیرفرایندها و سرورهای MCP بسته و journal کامل flush شده است.

## P1 — پایه چندسکویی و چندپروایدری (هفته ۶ تا ۱۶)

هدف: اجرای کامل و امن روی Windows، macOS و Linux با هر پروایدر LLM.

### P1-1 — لایه Provider Abstraction

interface واحد LLMProvider با adapterهای OpenAI (Chat و Responses)، Anthropic Messages، Gemini، Azure OpenAI، AWS Bedrock، Ollama، OpenRouter و Generic OpenAI-compatible؛ پشتیبانی streaming، native tool calling، vision، prompt caching و شمارش توکن. ProviderRouter با fallback، retry و مدل جدا برای هر نقش (planner، coder، observer).

**فایل‌ها:** agent/agent.js (استخراج transport)، agent/config/SettingsSchema.js، agent/providers/\* (جدید) | **تلاش:** L | **وابستگی:** P0-7

**معیارهای پذیرش:**

- تست contract با fixture ضبط‌شده برای هر ۸ پروایدر: chat، stream، tool call و خطاهای 429/5xx.
- تغییر پروایدر فقط با config و بدون تغییر کد.
- یک سناریوی e2e ثابت روی حداقل ۴ پروایدر واقعی (nightly) موفق است.
- خروجی دارای preamble برای همه پروایدرها توسط ResponseRepair بازیابی می‌شود.

### P1-2 — SandboxProvider چندسکویی

انتزاع اجرای فرمان با پیاده‌سازی‌های docker/podman (پیش‌فرض)، macOS seatbelt، Windows AppContainer/Job Object یا WSL، bwrap اصلاح‌شده و none (با هشدار صریح)؛ محدودیت CPU، حافظه، pids و زمان؛ سیاست egress شبکه.

**فایل‌ها:** agent/tools/process/\*، agent/runtime/\* | **تلاش:** XL | **وابستگی:** P0-2، P0-5

**معیارهای پذیرش:**

- تست isolation در CI روی هر سه OS: خواندن ~/.ssh، نوشتن خارج workspace و شبکه ممنوع رد می‌شوند.
- npm install، pip install و git clone در sandbox پیش‌فرض کار می‌کنند.
- فرمان runaway پس از timeout با کل درخت پروسه kill می‌شود (Windows: taskkill /T).
- agent doctor نوع sandbox فعال و قابلیت‌ها را گزارش می‌دهد.

**وضعیت اجرا (۲۳ نوامبر ۲۰۲۶):** قراردادهای launch برای bwrap و Docker/Podman، محدودیت منابع، deny-by-default، گزارش doctor و تست درخت فرایند پیاده شده‌اند. تست process-tree برای Windows از `taskkill /T` استفاده می‌کند. تست integration واقعی Docker در workflow جداگانه Linux اجرا شد و CI در commit `273ea0d` سبز است (خواندن فایل SSH میزبان، عدم اثر نوشتن خارج workspace، قطع شبکه در حالت `none` و smoke تست npm/pip/git با egress صریح `bridge`). هنوز egress allowlist پیاده نشده؛ `bridge` دسترسی عمومی شبکه می‌دهد و این تفاوت باید پیش از بستن P1-2 حل شود.

### P1-3 — ترمینال تعاملی (PTY)

node-pty و ConPTY، نشست shell پایدار با حفظ cwd و env، پشتیبانی bash، zsh، PowerShell و cmd، stream زنده به UI، interrupt و resize.

**فایل‌ها:** agent/tools/process/\*، web/server/\* | **تلاش:** M | **وابستگی:** P1-2

**معیارهای پذیرش:**

- اجرای برنامه تعاملی (مثل python REPL) و ارسال ورودی روی هر سه OS.
- Ctrl-C فرمان طولانی را قطع می‌کند بی‌آنکه نشست از بین برود.
- خروجی با تأخیر کمتر از ۲۰۰ms در UI دیده می‌شود.

### P1-4 — Policy چندسکویی

قواعد مسیر بر اساس مسیر نرمال‌شده؛ rule set برای PowerShell و cmd؛ طبقه‌بندی ریسک فرمان با parser به‌جای regex.

**فایل‌ها:** agent/registry/policy.json، agent/policy/PolicyMatcher.js | **تلاش:** M | **وابستگی:** P0-3

**معیارهای پذیرش:**

- Remove-Item -Recurse -Force C:\\ و rm -rf / هر دو high-risk و نیازمند approval هستند.
- مجموعه ۲۰۰ فرمان مرجع با دقت بیش از ۹۵٪ طبقه‌بندی می‌شود.

### P1-5 — CI ماتریسی و تست‌های قابل‌حمل

GitHub Actions روی ubuntu، windows و macos با Node 20/22/24؛ حذف وابستگی تست‌ها به sleep و cat؛ خروجی JUnit و coverage؛ test runner واحد به‌جای زنجیره بلند && .

**فایل‌ها:** ci/\*، .github/workflows/\*، test/\*، package.json | **تلاش:** M | **وابستگی:** —

**معیارهای پذیرش:**

- npm test روی هر سه OS سبز است.
- coverage خط برای agent/policy، agent/mcp و agent/tools بیش از ۸۰٪.
- زمان کل CI کمتر از ۱۵ دقیقه.

**تصمیم اجرایی این شاخه:** به‌دلیل خطای میزبانی/ظرفیت Runnerهای macOS، jobهای macOS از CI مسدودکننده حذف شده‌اند؛ گیت‌های فعلی روی Ubuntu و Windows اجرا می‌شوند. این تصمیم صرفاً محدودیت CI است و به‌تنهایی پشتیبانی محصول از macOS را تأیید یا رد نمی‌کند.

### P1-6 — شکستن agent.js و حذف کارهای همگام

تقسیم فایل ۹۶KB به AgentLoop، LLMClient، PromptAssembler و غیره؛ حذف execSync/spawnSync از مسیر داغ (git status کش‌شده و async)؛ اجرای regex جستجو در worker با timeout.

**فایل‌ها:** agent/agent.js، agent/prompt/RuntimeContextBuilder.js، agent/tools/search/SearchTools.js | **تلاش:** L | **وابستگی:** P1-1

**معیارهای پذیرش:**

- هیچ فایل منبع در agent/ بزرگ‌تر از ۱۵KB نیست (به‌جز داده).
- lag event loop با ۱۰ عامل هم‌زمان کمتر از ۱۰۰ms (p99).
- regex (a+)+\$ روی فایل ۱۰MB پس از ۲ ثانیه قطع می‌شود و runtime پاسخ‌گو می‌ماند.

**وضعیت P1 در این تغییر:**

| آیتم | وضعیت و شواهد | آنچه هنوز مانده |
|---|---|---|
| P1-1 Provider | قرارداد fixture/mock برای ۸ provider، 83 تست؛ workflow nightly برای ≥۴ provider واقعی و matrix CI همه سبز در commit `273ea0d`. | نتیجهٔ واقعی nightly همچنان وابسته به چهار جفت secret مدل/کلید در GitHub است و در CI معمولی اثبات نشده. |
| P1-2 Sandbox | workflow integration واقعی Docker روی Linux سبز در run [45394759690](https://github.com/legionir/semantic-engine-structured-ai/actions/runs/45394759690): مرز workspace، محرمانگی SSH، قطع egress در `none` و smoke تست ابزارها. | egress allowlist و isolation واقعی روی Windows/macOS باقی است؛ `bridge` هنوز egress عمومی دارد. |
| P1-3 PTY | node-pty/ConPTY، نشست interactive، resize، Ctrl-C و stream redacted به SSE؛ تست‌های p13 و WebServer در ماتریس CI سبز. | اثبات backend PTY در sandbox واقعی روی هر سه OS هنوز کامل نیست؛ macOS runner در گیت مسدودکننده نیست. |
| P1-4 Policy | طبقه‌بندی 268 فرمان: 268/268 درست در مرجع فعلی؛ تست‌ها در CI سبز. | معیار فعلی پاس است؛ مجموعهٔ مرجع باید با تغییرات parser توسعه یابد. |
| P1-5 CI | آخرین CI کامل روی Ubuntu/Windows و Node 20/22/24 برای commit `273ea0d` سبز است (run [45394759562](https://github.com/legionir/semantic-engine-structured-ai/actions/runs/45394759562)). پس از آخرین تغییرها، `npm run test:coverage` محلی اجرا شد: 67/67 فایل در 115.1s؛ statements/lines=85.22%، branches=76.00%، functions=84.26%، policy=89.71%، mcp=83.10%، tools=85.47% و همه گیت‌های 80% پاس. benchmark مستقل p99 <100ms و run تست قبلی [45394759632](https://github.com/legionir/semantic-engine-structured-ai/actions/runs/45394759632) سبز هستند؛ تغییرات فعلی هنوز CI تازه نگرفته‌اند. | تنها ماتریس macOS عمداً از گیت مسدودکننده حذف شده است؛ معیارهای Ubuntu/Windows و coverage ناحیه‌ای در کد گیت می‌شوند. |
| P1-6 Runtime | request provider، endpoint profiles، MCP runtime، profile resolution، execution-rule/prompt text، response reporter و registry loader از `agent.js` جدا شده‌اند؛ Git detection async/cache و regex worker با timeout ۲ثانیه؛ ToolGraphExecutor به validation/scheduler/reference/runner تفکیک شد؛ HookRunner به execution/lifecycle تفکیک شد؛ MCP registry، memory merge، REPL handlers و persona data نیز ماژولار شدند. focused runtime/e2e/p16 (107/107، 58/58، 1/1) و hook suites (10/10، 10/10، 5/5، 5/5) و full coverage 67/67 سبز؛ benchmark ۱۰ عامل قبلی CI مستقل سبز. | `agent.js` هنوز 71,777 بایت است؛ `persistence/ArchiveRepository.js` هنوز 30,739 بایت و `mcp/transports/WebSocketTransport.js` 16,352 بایت است. هیچ فایل منبع `agent/` نباید >15KB بماند، بنابراین این معیار هنوز با فاصله باز است؛ egress allowlist، اثبات sandbox/PTy سه‌سیستمی و smoke واقعی چهار provider نیز بازند. |

بنابراین P1 هنوز **بسته نیست**: CI جاری (full suite، benchmark و Docker integration لینوکس) سبز است، اما egress allowlist و اثبات چندسکویی sandbox/PTy، اجرای حداقل چهار provider واقعی در nightly، و refactor کامل همهٔ منابع `agent/` به سقف 15KB هنوز معیارهای خروج باز هستند. به درخواست کاربر، این موارد به‌عنوان **باز/منتقل‌شده به پیگیری بعدی** ثبت شدند و شروع P2 به‌معنای بستن یا چشم‌پوشی از آن‌ها نیست. وضعیت فوق در ۲۳ نوامبر ۲۰۲۶ به‌روزرسانی شد.

**موارد P1 باز برای پیگیری:**

1. P1-2: egress allowlist واقعی؛ `bridge` فعلی دسترسی عمومی شبکه می‌دهد، و شواهد isolation واقعی Windows/macOS هنوز وجود ندارد.
2. P1-3: اجرای PTY در sandbox واقعی و اثبات آن روی Windows/macOS/Linux کامل نیست.
3. P1-1: نتیجهٔ nightly برای سناریوی واقعی با حداقل چهار provider هنوز در دسترس/اثبات‌شده نیست؛ fixture/mock tests جایگزین smoke واقعی نیستند.
4. P1-6: فایل‌های منبع بزرگ‌تر از 15KB باقی‌اند، از جمله `agent.js` (71,777 B)، `ArchiveRepository.js` (30,739 B)، `McpManager.js` (19,656 B) و `WebSocketTransport.js` (16,352 B).
5. P1-5: تست coverage محلی سبز است، اما تغییرات working tree هنوز CI تازهٔ Ubuntu/Windows نگرفته‌اند؛ macOS نیز عمداً blocking نیست.


## P2 — عامل همه‌فن‌حریف (هفته ۱۶ تا ۳۰)

هدف: برابری و سپس برتری بر OpenHands در قابلیت‌ها.

### P2-1 — یکپارچگی GitHub (و GitLab)

clone، fetch، push و branch؛ ایجاد و بازبینی PR، issue، کامنت و بررسی CI checks؛ احراز هویت با GitHub App یا OAuth device flow و ذخیره در keychain سیستم؛ امکان استفاده از سرور MCP رسمی GitHub.

**فایل‌ها:** agent/tools/git/\*، agent/tools/github/\* (جدید)، agent/registry/tool-schemas/\* | **تلاش:** L | **وابستگی:** P0-2، P1-2

**معیارهای پذیرش:**

- سناریوی e2e: از روی issue، branch بسازد، کد را اصلاح کند، تست بگیرد و PR باز کند (روی ریپوی تستی).
- push به branch محافظت‌شده یا force-push همیشه approval می‌خواهد.
- توکن هرگز در لاگ، event store یا prompt دیده نمی‌شود.

### P2-2 — ابزار Browser

Playwright داخل sandbox: navigate، click، type، scroll، screenshot، استخراج accessibility tree و markdown؛ محافظ SSRF کامل (IPv6 mapped و redirect).

**فایل‌ها:** agent/tools/browser/\* (جدید)، agent/tools/network/NetworkTools.js | **تلاش:** L | **وابستگی:** P1-2

**معیارهای پذیرش:**

- عامل یک فرم تستی محلی را پر و ارسال می‌کند و screenshot برمی‌گرداند.
- دسترسی به 169.254.169.254 و \[::ffff:a9fe:a9fe\] رد می‌شود.
- header Authorization در redirect بین‌دامنه‌ای حذف می‌شود.

### P2-3 — MCP کامل

sampling، elicitation، progress، cancellation، tools/list_changed؛ OAuth 2.1 + PKCE برای سرورهای راه دور؛ تبدیل schema به dialect هر پروایدر؛ policy per-tool و استفاده از annotation destructiveHint.

**فایل‌ها:** agent/mcp/\* | **تلاش:** L | **وابستگی:** P0-6، P1-1

**معیارهای پذیرش:**

- اتصال موفق به سرورهای مرجع (filesystem، github، playwright، everything) در CI.
- اتصال به سرور راه دور با OAuth بدون کپی دستی توکن.
- ابزار با destructiveHint=true بدون approval اجرا نمی‌شود.

**پیشرفت P2-3 (۲۳ نوامبر ۲۰۲۶):** گیت `mcp_destructive_hint` افزوده شد و برای ابزارهای namespaced و gateway (`mcp_call`) annotation را بررسی می‌کند؛ `destructiveHint=true` حتی با `MCP_APPROVAL=never` نیز approval لازم دارد. تست unit مستقیم پاس شد و آزمون‌های policy و MCP به‌ترتیب 13/13 و 37/37 سبز هستند. OAuth 2.1/PKCE، progress/cancellation/elicitation و اتصال CI به سرورهای مرجع هنوز بازند.

### P2-4 — ویرایش کد پیشرفته و Checkpoint

apply_patch با unified diff، چند ویرایش اتمیک، حفظ EOL و BOM، checkpoint خودکار پیش از هر تغییر و undo؛ نمایش diff در approval.

**فایل‌ها:** agent/tools/filesystem/\*، agent/persistence/\* | **تلاش:** M | **وابستگی:** P0-3

**معیارهای پذیرش:**

- patch ناسازگار بدون تغییر فایل رد می‌شود.
- undo به هر checkpoint فایل‌ها را بایت‌به‌بایت بازمی‌گرداند.
- فایل CRLF پس از ویرایش CRLF باقی می‌ماند.

**پیشرفت P2-4 (۲۳ نوامبر ۲۰۲۶):** تغییرات `fs_write`، `fs_edit`، `fs_mkdir`، `fs_move` و `fs_delete` پیش از mutation checkpoint محدود و durable می‌سازند و `checkpoint_id` می‌دهند. `checkpoint_undo` محتوای فایل، درخت پوشه، move/overwrite و symlink را برمی‌گرداند؛ undo خودش checkpoint جبرانی دارد تا قابل redo باشد. Snapshotها سقف فایل/بایت دارند، parentهای تازه‌ساخته را هم rollback می‌کنند، فایل‌های بیش‌ازحد را پیش از تغییر رد می‌کنند و مسیر/رکوردهای دستکاری‌شده یا خود مخزن checkpoint را برای restore نمی‌پذیرند. ابزار `apply_patch` unified diff سخت‌گیرانه را روی چند فایل UTF-8 اعمال می‌کند؛ edit فایل موجود و `/dev/null` add/delete کامل پشتیبانی می‌شوند، در حالی که rename با `fs_move` و delete جزئی پشتیبانی نمی‌شود. BOM/EOL فایل‌های ویرایش‌شده حفظ می‌شوند، pathها قبل از mutation validate می‌شوند، diff در approval prompt می‌آید و خطای write باعث rollback checkpoint می‌شود. ساخت فایل جدید به والد موجود نیاز دارد. تست‌های fault injection، patch نامعتبر، BOM/CRLF، undo/redo، symlink بیرون workspace و limitها پاس شدند. آخرین full coverage پس از پشتیبانی add/delete در `apply_patch` و request-aware context budgets، 67/67 سبز با 85.22% statement coverage است؛ tools 65/65، tool-runtime 8/8، policy 13/13 و runtime 107/107 نیز پاس شدند. atomicity در برابر crash پروسه/سیستم تضمین نمی‌شود؛ rename و حذف جزئی در unified diff پشتیبانی نمی‌شوند و باید از `fs_move` یا ابزارهای فایل استفاده کرد؛ بنابراین P2-4 هنوز کامل نیست.

### P2-5 — Security Risk Analyzer

برچسب ریسک low/medium/high برای هر اکشن با قاعده و (اختیاری) LLM؛ approval بر اساس سطح ریسک؛ audit log ضد دست‌کاری (hash chain).

**فایل‌ها:** agent/policy/\* | **تلاش:** M | **وابستگی:** P1-4

**معیارهای پذیرش:**

- benchmark اکشن‌های خطرناک: recall بیش از ۹۵٪.
- هر approval با شناسه run، هش آرگومان‌ها و هویت تأییدکننده در audit ثبت می‌شود.

### P2-6 — حافظه و context هوشمند

بودجه توکن بر اساس پنجره مدل؛ provenance حافظه و قرنطینه منابع غیرقابل‌اعتماد؛ عدم حذف exchange در صورت شکست آرشیو؛ اتصال semantic-engine برای درک کد.

**فایل‌ها:** agent/context/\*، agent/mcp/semantic.js | **تلاش:** M | **وابستگی:** P1-1

**معیارهای پذیرش:**

- جلسه ۲۰۰ مرحله‌ای روی مدل 32k بدون context overflow اجرا می‌شود.
- متن تزریق‌شده از صفحه وب بدون تأیید وارد حافظه دائمی نمی‌شود.
- شکست آرشیو هیچ داده‌ای را از بین نمی‌برد (تست fault injection).

**پیشرفت P2-6 (۲۳ نوامبر ۲۰۲۶):** محافظت archive failure مانع حذف exchangeهاست؛ نتایج `net_*`، `browser_*` و `mcp_*` از memory fold قرنطینه می‌شوند و در transcript باقی می‌مانند، اما دیگر جلوی fold شدن exchangeهای محلیِ بعدی را نمی‌گیرند؛ آزمون تزریق اطمینان می‌دهد متن مشکوک نه به summarizer می‌رسد و نه وارد حافظه دائمی می‌شود. provenance دسته‌ای و per-item (هش آیتم، run id، ابزارها و source refs) ذخیره/بازیابی می‌شود و از `memory_get` قابل مشاهده است. برای جلوگیری از prompt injection در داده‌های قدیمی نیز working memory اکنون با نقش user و برچسب صریحِ دادهٔ تاریخیِ غیرقابل‌اعتماد وارد می‌شود؛ system prompt و قواعد recall می‌گویند محتوای memory/archive هرگز دستور محسوب نمی‌شود و ادعاهای مهم باید دوباره راستی‌آزمایی شوند. `ENDPOINT_<ROLE>_CONTEXT_TOKENS`، fallback سراسری `CONTEXT_WINDOW_TOKENS` و safety fraction اضافه شدند؛ compactor سقف ترکیبی کاراکتر/token-estimate را اعمال می‌کند؛ تخمین هر درخواست اکنون پیام‌ها، schema ابزارهای فعال همان agent و response-format schema را حساب می‌کند تا metadata درخواست از safety reserve کسر شود. runtime context و README مقادیر را گزارش می‌کنند. تست ۲۰۰ exchange با پنجرهٔ role-specific 32k و سقف estimate برابر 22.4k پاس است؛ همچنین سقف مستقل endpoint L1 آزموده شد. اندازه‌گیری هنوز تخمینی و provider-independent است، نه tokenizer/native count؛ آزمون adapterهای Anthropic/Gemini برای endpoint شمارش native موجود است، اما مسیر فعال `ContextManager` هنوز به آن‌ها وصل نیست و `AgentRequestExecutor` درخواست‌های اصلی را مستقیم به `/chat/completions` می‌فرستد. اتصال شمارنده باید پس از یکپارچه‌شدن transport فعال provider انجام شود تا توکن‌های شمارش‌شده با همان مدل/endpoint درخواست واقعی مطابقت داشته باشند. smoke واقعی با مدل 32k نیز هنوز باز است. **اتصال semantic-engine اکنون به‌صورت زنده آزموده شد:** semantic-engine از سورس build شد، یک workspace موقت با یک فایل ایندکس شد و Structured AI از مسیر stdio MCP با `code_find_symbol` هر دو symbol (کلاس و متد) را از index تازه بازیابی کرد. smoke تکرارپذیر به `structured-ai/ci/semantic-engine-smoke.js` و `npm run test:semantic:live` اضافه شد؛ در همین حال اصلاح شد که sidecar همان `SEMANTIC_ENGINE_DATA_DIR` را بگیرد که staleness checker می‌خواند. تست‌های fault-injection، تزریق وب/MCP، provenance persistence و stress در `test/context/context.test.js` پاس هستند؛ بنابراین P2-6 هنوز باز است تا smoke مدل 32k و اندازه‌گیری token-native/اعتبارسنجی نهایی انجام شود.

### P2-7 — Observability و کنترل هزینه

OpenTelemetry trace برای هر run، ابزار و فراخوانی LLM؛ شمارش توکن و هزینه برای هر پروایدر؛ بودجه هزینه؛ replay جلسه از event store.

**فایل‌ها:** agent/runtime/Telemetry.js، agent/runtime/Observability.js | **تلاش:** M | **وابستگی:** P1-1

**معیارهای پذیرش:**

- trace کامل یک run در Jaeger قابل مشاهده است.
- اجرا پس از عبور از بودجه هزینه متوقف و گزارش می‌شود.
- replay یک جلسه همان دنباله رویدادها را بازتولید می‌کند.

## P3 — توزیع، تجربه کاربری و اکوسیستم (هفته ۳۰ تا ۴۴)

هدف: نصب یک‌دستوری روی هر OS و اکوسیستم قابل گسترش.

### P3-1 — نصب‌کننده‌های چندسکویی

انتشار npm عمومی با نام یکتا (به‌جای agent که تداخل دارد)، باینری مستقل (Node SEA)، Homebrew، winget و Scoop، deb و rpm، اسکریپت install.sh و install.ps1، تصویر Docker کامل و به‌روزرسانی خودکار امضاشده.

**فایل‌ها:** package.json، Dockerfile، ci/release/\* (جدید) | **تلاش:** L | **وابستگی:** P1-5

**معیارهای پذیرش:**

- نصب و agent doctor روی ماشین تمیز Windows 11، macOS 14 و Ubuntu 24.04 در کمتر از ۲ دقیقه.
- هر release با checksum و امضا منتشر می‌شود.
- تصویر Docker شامل git و sandbox کارا است و smoke test را پاس می‌کند.

### P3-2 — Onboarding و پیکربندی

دستور agent init (انتخاب پروایدر، کلید و sandbox)، ذخیره کلید در keychain سیستم، config در مسیر استاندارد هر OS و agent doctor.

**فایل‌ها:** agent/cli/\*، agent/config/\* | **تلاش:** M | **وابستگی:** P1-1، P1-2

**معیارهای پذیرش:**

- کاربر جدید بدون ویرایش دستی فایل در کمتر از ۵ دقیقه اولین تسک را اجرا می‌کند.
- کلید API هرگز به‌صورت متن ساده روی دیسک نیست.

### P3-3 — UI کامل

بازطراحی وب‌کنسول: ترمینال زنده، درخت فایل، diff viewer، نمای browser، مدیریت پروایدر و MCP، approval با جزئیات کامل؛ اپ دسکتاپ (Tauri یا Electron) و افزونه VS Code روی همان Agent Server.

**فایل‌ها:** web/\*، clients/\* (جدید) | **تلاش:** XL | **وابستگی:** P1-3، P2

**معیارهای پذیرش:**

- همه عملیات CLI از UI هم قابل انجام است.
- approval آرگومان کامل و diff را نشان می‌دهد (بدون برش ۲۰۰ کاراکتری).
- امتیاز accessibility در Lighthouse بیش از ۹۰.

### P3-4 — سیستم پلاگین و Marketplace

پلاگین برای ابزار، پروایدر، sandbox، skill و persona با manifest و نسخه‌گذاری؛ نصب یک‌کلیکی سرورهای MCP محبوب؛ امضا و sandbox پلاگین‌ها.

**فایل‌ها:** agent/registry/\* | **تلاش:** L | **وابستگی:** P2-3

**معیارهای پذیرش:**

- یک پلاگین ابزار نمونه بدون تغییر کد هسته نصب و استفاده می‌شود.
- پلاگین بدون امضا فقط با تأیید صریح نصب می‌شود.

### P3-5 — حالت چندکاربره و راه دور

TLS، OIDC، جلسات جدا برای هر کاربر، rate limit و حالت headless برای CI (اجرای عامل در GitHub Actions).

**فایل‌ها:** web/server/\* | **تلاش:** L | **وابستگی:** P0-4

**معیارهای پذیرش:**

- دو کاربر هم‌زمان هیچ داده‌ای از یکدیگر نمی‌بینند (تست ماتریسی).
- workflow نمونه GitHub Actions عامل را روی PR اجرا و نتیجه را کامنت می‌کند.

## جدول خلاصه زمان‌بندی

| **فاز** | **بازه**   | **خروجی کلیدی**                 | **معیار خروج فاز**                                           |
| ------- | ---------- | ------------------------------- | ------------------------------------------------------------ |
| P0      | هفته ۱–۶   | سیستم امن روی Linux             | صفر یافته بحرانی یا بالای امنیتی باز؛ تست‌های امنیتی سبز     |
| P1      | هفته ۶–۱۶  | اجرای امن روی ۳ OS با ۸ پروایدر | CI ماتریسی سبز؛ sandbox فعال روی هر OS                       |
| P2      | هفته ۱۶–۳۰ | GitHub، Browser، PTY و MCP کامل | سناریوی خودکار issue→PR موفق؛ اجرای benchmark SWE-bench Lite |
| P3      | هفته ۳۰–۴۴ | نصب یک‌دستوری، UI و پلاگین      | نصب روی ماشین تمیز هر OS زیر ۲ دقیقه؛ نسخه 1.0               |

# ۸. ریسک‌ها و پیوست

## ریسک‌ها

- **محدودیت این ممیزی:** بازبینی ایستا بود؛ پیش از شروع P0 باید npm test روی هر سه OS اجرا و یافته‌ها با تست بازتولید شوند.
- **sandbox در Windows** پیچیده‌ترین بخش است؛ پیشنهاد: Docker Desktop یا WSL به‌عنوان مسیر اصلی و AppContainer در مرحله بعد.
- **تفاوت رفتار پروایدرها** در tool calling و فرمت خروجی؛ تست contract با fixture ضبط‌شده ضروری است.
- **هزینه نگهداری adapterهای native**؛ می‌توان LiteLLM یا Vercel AI SDK را هم به‌عنوان adapter عمومی پشتیبانی کرد.
- **پیچیدگی موجود** (agent.js بزرگ و رجیستری ۲۰۰KB)؛ refactor باید با تست‌های contract فعلی محافظت شود.

## پیوست: فهرست یافته‌های متوسط و پایین

| **شدت** | **حوزه**                     | **عنوان**                                                                                                                            | **فایل:خط**                                    |
| ------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| متوسط   | config_providers             | A malformed environment variable makes every read of that key throw, at arbitrary call sites                                         | agent/config/SettingsResolver.js:31            |
| متوسط   | config_providers             | settings.set(key, '') stores the schema default as an override, masking the environment value                                        | agent/config/SettingsStore.js:57               |
| متوسط   | config_providers             | Placeholder API key 'your-api-key' and a private-network default base URL are sent when nothing is configured                        | agent/config/SettingsSchema.js:36              |
| متوسط   | config_providers             | API key accepted on the command line and copied into process.env                                                                     | agent/cli/ArgParser.js:130                     |
| متوسط   | config_providers             | Console token printed and embedded in the URL query string; console token read directly from env                                     | agent/cli/ServeCommand.js:28                   |
| متوسط   | config_providers             | Ctrl-C in the interactive session likely closes readline instead of cancelling the task                                              | agent/interactive/Repl.js:408                  |
| متوسط   | config_providers             | Terminal escape injection: model/tool output is written raw to the terminal                                                          | agent/interactive/Repl.js:359                  |
| متوسط   | config_providers             | \--until-done exits immediately if a previous, already complete plan exists on disk                                                  | agent/cli/Cli.js:487                           |
| متوسط   | config_providers             | Backfill writes to the legacy &lt;workspace&gt;/.agent/eventstore, not the central per-project data root, and is untested            | bin/backfill-eventstore.js:37                  |
| متوسط   | config_providers             | Data-home default documented as ~/.local/share on every OS                                                                           | agent/config/SettingsSchema.js:1311            |
| متوسط   | config_providers             | Settings overrides are process-global; concurrent projects in the web server share one mutable map                                   | agent/config/SettingsStore.js:24               |
| متوسط   | config_providers             | No tests for config schema/resolver/store, ConsoleAuth parsing or REPL failure paths                                                 | agent/config/SettingsStore.js                  |
| متوسط   | core_agent                   | parallel_tool_calls (and tools) are sent even when the agent has no tools                                                            | agent/prompt/RequestBuilder.js:84              |
| متوسط   | core_agent                   | Temperature and max_tokens always sent - breaks reasoning models (o-series, GPT-5, some Anthropic/Gemini thinking modes)             | agent/prompt/RequestBuilder.js:79              |
| متوسط   | core_agent                   | Prompt is many interleaved system messages; incompatible with providers/templates that allow one leading system message              | agent/prompt/MainPromptBuilder.js:46           |
| متوسط   | core_agent                   | Volatile runtime_context placed near the top of the prompt defeats provider prompt caching                                           | agent/prompt/RuntimeContextBuilder.js:134      |
| متوسط   | core_agent                   | No token usage / cost accounting on model calls                                                                                      | agent/agent.js:2704                            |
| متوسط   | core_agent                   | Registry hot-reload has no last-known-good fallback; a half-written JSON file crashes in-flight runs                                 | agent/agent.js:747                             |
| متوسط   | core_agent                   | Structured content arrays (content parts) are mis-read as an action object                                                           | agent/actions/ActionParser.js:179              |
| متوسط   | core_agent                   | No tests for the HTTP transport edge cases and provider request shapes                                                               | agent/agent.js:2653                            |
| متوسط   | mcp                          | Closing a stdio server kills only the direct child; process trees (npx → node, uvx → python) are orphaned                            | agent/mcp/transports/StdioTransport.js:427     |
| متوسط   | mcp                          | Content-Length framed input has no size ceiling (memory DoS) and quadratic buffering                                                 | agent/mcp/protocol/ContentLengthCodec.js:82    |
| متوسط   | mcp                          | HTTP transport treats empty-bodied 4xx/5xx responses as success                                                                      | agent/mcp/transports/HttpTransport.js:276      |
| متوسط   | mcp                          | HTTP/SSE request 'timeout' is a socket idle timeout, not a call deadline                                                             | agent/mcp/transports/HttpTransport.js:198      |
| متوسط   | mcp                          | SSE endpoint event can redirect POSTs, and the Bearer token, to another origin                                                       | agent/mcp/transports/SseTransport.js:204       |
| متوسط   | mcp                          | Tool schema reduction drops \$defs, additionalProperties and annotations; no per-provider schema adaptation                          | agent/mcp/McpCatalogue.js:82                   |
| متوسط   | mcp                          | Runtime-added stdio servers are persisted to a location that the trust policy then refuses to load                                   | agent/mcp/McpConfigLoader.js:267               |
| متوسط   | mcp                          | persist() writes resolved secrets in plaintext and silently drops \`token\`                                                          | agent/mcp/McpConfigLoader.js:289               |
| متوسط   | mcp                          | Reloading configuration kills the built-in semantic-engine sidecar                                                                   | agent/mcp/McpManager.js:185                    |
| متوسط   | mcp                          | Tests miss strict-NDJSON servers, server→client requests, Windows spawn and trust bypass                                             | test/mcp/mcp.test.js                           |
| متوسط   | persistence_context_projects | Lost updates on shared memory.json across concurrent agents (read-modify-write across awaits)                                        | agent/context/MemoryCoordinator.js:562         |
| متوسط   | persistence_context_projects | Event-store readDay corrupts multi-byte UTF-8 at 64 KiB chunk boundaries                                                             | agent/persistence/EventStoreRepository.js:285  |
| متوسط   | persistence_context_projects | Registry file is synchronously read and parsed on every emitted event                                                                | agent/persistence/DataRoot.js:150              |
| متوسط   | persistence_context_projects | Archive and session indexes have no cross-process locking (lost updates, duplicate record ids)                                       | agent/persistence/ArchiveRepository.js:503     |
| متوسط   | persistence_context_projects | AtomicFile has no fsync and no retry for Windows rename EPERM/EBUSY                                                                  | agent/persistence/AtomicFile.js:39             |
| متوسط   | persistence_context_projects | Project root canonicalisation differs from WorkspaceBoundary and is case-sensitive on Windows/macOS                                  | agent/projects/ProjectRegistry.js:110          |
| متوسط   | persistence_context_projects | Archive keyword search ignores all non-ASCII text                                                                                    | agent/persistence/ArchiveRepository.js:1009    |
| متوسط   | persistence_context_projects | Compaction notices accumulate as extra system messages mid-conversation                                                              | agent/context/ContextCompactor.js:423          |
| متوسط   | persistence_context_projects | Context budget is character-based, not token- or model-aware                                                                         | agent/context/ConversationSizer.js:22          |
| متوسط   | persistence_context_projects | Event payload can overwrite envelope fields (seq, type, at)                                                                          | agent/events/EventBus.js:69                    |
| متوسط   | persistence_context_projects | Global singletons (WORKSPACE_ROOT at module load, process-global settings overlay, openedProjectId) block true multi-project hosting | agent/context/WorkspaceBoundary.js:93          |
| متوسط   | persistence_context_projects | Missing tests for critical edge cases in this area                                                                                   | test/persistence                               |
| متوسط   | policy_hooks                 | Approval and the actual MCP call can resolve to different servers (server/tool parsing disagree)                                     | agent/policy/PolicyEngine.js:46                |
| متوسط   | policy_hooks                 | Destructive-shell deny list is easy to evade and has no Windows/PowerShell coverage                                                  | agent/registry/policy.json:150                 |
| متوسط   | policy_hooks                 | Policy rules written with \`condition\` pass validation but the condition is ignored at evaluation                                   | agent/policy/PolicyMatcher.js:156              |
| متوسط   | policy_hooks                 | Repository-supplied hooks (.agent/project.json) run with no trust gate, unlike project MCP stdio servers                             | agent/hooks/HookLoader.js:160                  |
| متوسط   | policy_hooks                 | Hooks bypass agent-profile allowlists and always run as main_agent                                                                   | agent/hooks/HookRunner.js:161                  |
| متوسط   | policy_hooks                 | Malformed hook configuration throws out of runHooks / applyAfterTaskHooks instead of being reported                                  | agent/hooks/HookRunner.js:576                  |
| متوسط   | policy_hooks                 | dirtyPathsFromStatus mishandles quoted porcelain paths (spaces, Unicode, Windows)                                                    | agent/hooks/HookRunner.js:29                   |
| متوسط   | policy_hooks                 | Terminal approval prompt shows only the first 300 chars of args and doesn't sanitize control characters                              | agent/policy/ApprovalManager.js:227            |
| متوسط   | policy_hooks                 | Concurrent approvals in TTY mode open several readline interfaces on the same stdin                                                  | agent/policy/ApprovalManager.js:219            |
| متوسط   | policy_hooks                 | Policy layer has no regression tests for the shipped deny rules on Windows paths, process_write or mcp_call+restricted               | test/policy/policy.test.js                     |
| متوسط   | registry_discussion          | tool_groups.json 'default_policy', 'sensitive' and 'note' fields are documentation only and never enforced                           | agent/registry/tool_groups.json:5              |
| متوسط   | registry_discussion          | Unbounded discussion cost: duplicate personas are accepted and discussion_start needs no approval                                    | agent/discussion/DiscussionService.js:48       |
| متوسط   | registry_discussion          | Observer and persona prompts grow without bound and can overflow the context window                                                  | agent/discussion/transcript.js:151             |
| متوسط   | registry_discussion          | One failed persona call aborts the whole discussion, and sibling calls keep running                                                  | agent/discussion/engine.js:29                  |
| متوسط   | registry_discussion          | The standalone LLM caller has no timeout and supports only OpenAI-compatible Bearer APIs                                             | agent/discussion/index.js:63                   |
| متوسط   | registry_discussion          | Persona tool lists are declared but never used, and the agents.json discussion_\* entries contradict the 'personas do not act' claim | agent/discussion/index.js:42                   |
| متوسط   | registry_discussion          | Persona definitions are duplicated in personas.js, registry/personas.json and agents.json                                            | agent/discussion/personas.js:7                 |
| متوسط   | registry_discussion          | The legacy tools.json is still the source of truth for HookLoader, while the runtime uses tool-schemas/                              | agent/registry/RegistryLoader.js:24            |
| متوسط   | registry_discussion          | RegistryValidator does not catch duplicate names or malformed entries                                                                | agent/registry/RegistryValidator.js:30         |
| متوسط   | registry_discussion          | Discussion internals have no unit tests (loop detection, observer parsing, policy regex variants)                                    | agent/discussion/observerRunner.js             |
| متوسط   | runtime                      | Retry backoff sleep ignores run cancellation                                                                                         | agent/runtime/RetryController.js:140           |
| متوسط   | runtime                      | Concurrent sibling sub-agents overwrite each other's event scope/iteration                                                           | agent/runtime/IterationRunner.js:136           |
| متوسط   | runtime                      | Synchronous git subprocess blocks the event loop for all concurrent runs                                                             | agent/runtime/Telemetry.js:91                  |
| متوسط   | runtime                      | Windows: cross-drive absolute paths are accepted as 'relative' provenance                                                            | agent/runtime/Telemetry.js:65                  |
| متوسط   | runtime                      | Claim verification treats failed tool calls as 'executed'                                                                            | agent/runtime/Telemetry.js:239                 |
| متوسط   | runtime                      | Sub-agent reports success:true even when it returns an error                                                                         | agent/runtime/ActionProcessor.js:442           |
| متوسط   | runtime                      | Unscoped runs bypass the scheduler and all worker limits                                                                             | agent/runtime/RunScheduler.js:156              |
| متوسط   | runtime                      | Tool arguments and full results are emitted on the event bus without redaction                                                       | agent/runtime/ToolGraphExecutor.js:1172        |
| متوسط   | runtime                      | runtime_context.json hard-codes limits and advertises approval_system:false                                                          | agent/runtime/runtime_context.json:27          |
| متوسط   | tests_ci_packaging           | Unguarded symlink creation breaks tests on Windows (EPERM)                                                                           | test/tools/tools.test.js:368                   |
| متوسط   | tests_ci_packaging           | Discussion test hard-codes /tmp and reuses a real WORKSPACE_ROOT from the environment                                                | test/discussion/discussion.test.js:14          |
| متوسط   | tests_ci_packaging           | The test normalizer only recognises POSIX temp paths                                                                                 | test/helpers/normalize.js:60                   |
| متوسط   | tests_ci_packaging           | The workflows under structured-ai/ci/ are dead and point at the wrong paths                                                          | ci/github-actions-semantic-engine.yml:6        |
| متوسط   | tests_ci_packaging           | The structured-ai CI job never builds semantic-engine, so the gateway integration test always skips                                  | test/mcp/gateway.integration.test.js:168       |
| متوسط   | tests_ci_packaging           | docker-compose.yml is broken in this folder and has no structured-ai service                                                         | docker-compose.yml:4                           |
| متوسط   | tests_ci_packaging           | The serial \`&&\` test chain hides later failures and has no timeouts                                                                | package.json:8                                 |
| متوسط   | tests_ci_packaging           | Known-flaky and failing suites are documented but not quarantined                                                                    | FIX-PLAN-REVIEW-FINDINGS.md:22                 |
| متوسط   | tools_other                  | Redirect responses are never drained, leaking sockets                                                                                | agent/tools/network/NetworkTools.js:345        |
| متوسط   | tools_other                  | Response body keeps downloading past the cap and splits UTF-8 across chunks                                                          | agent/tools/network/NetworkTools.js:199        |
| متوسط   | tools_other                  | Git option injection through branch/name arguments                                                                                   | agent/tools/git/GitTools.js:214                |
| متوسط   | tools_other                  | Search path globs break on Windows because relative paths use backslashes                                                            | agent/tools/search/SearchTools.js:94           |
| متوسط   | tools_other                  | code_rename applies same-line edits in the wrong order and writes non-atomically                                                     | agent/tools/code/LiveLspTools.js:226           |
| متوسط   | tools_other                  | Model can mark its own runtime-added MCP server as trusted and persist it                                                            | agent/tools/mcp/McpTools.js:268                |
| متوسط   | tools_other                  | Discovered MCP tool lookups are not project-scoped while mcp_tools is                                                                | agent/tools/mcp/McpTools.js:372                |
| متوسط   | tools_other                  | Plan phase reported 'done' when all its steps are blocked or skipped                                                                 | agent/tools/planning/PlanTools.js:300          |
| متوسط   | tools_other                  | Plan read-modify-write is not serialised across concurrent agents                                                                    | agent/tools/planning/PlanRepository.js:86      |
| متوسط   | tools_other                  | Skills tied to MCP servers other than semantic-engine are never active; skills load only from the install dir                        | agent/tools/skills/SkillTools.js:237           |
| متوسط   | tools_other                  | discussion_start has no budget guard or cancellation and needs no approval                                                           | agent/tools/discussion/DiscussionTools.js:150  |
| متوسط   | tools_other                  | No tests for SSRF IPv6 classification, redirect header handling or LSP-shaped rename edits                                           | agent/tools/network/NetworkTools.js            |
| متوسط   | tools_process_fs             | TOCTOU between boundary check and file open                                                                                          | agent/context/WorkspaceBoundary.js:186         |
| متوسط   | tools_process_fs             | Background sessions are never pruned and unbounded in count                                                                          | agent/tools/process/ProcessManager.js:19       |
| متوسط   | tools_process_fs             | Timeouts and waits from tool arguments are not clamped                                                                               | agent/tools/process/ForegroundCommand.js:92    |
| متوسط   | tools_process_fs             | Truncated reads silently drop unread background output                                                                               | agent/tools/process/BackgroundSession.js:14    |
| متوسط   | tools_process_fs             | Windows shell defaults to cmd.exe with no shell selection; POSIX uses arbitrary \$SHELL                                              | agent/tools/process/ProcessManager.js:170      |
| متوسط   | tools_process_fs             | fs_read / fs_info read whole files into memory with no size limit or file-type check                                                 | agent/tools/filesystem/ReadTools.js:38         |
| متوسط   | tools_process_fs             | CRLF files: fs_edit fails to match and fs_read leaves \\r in lines                                                                   | agent/tools/filesystem/WriteTools.js:235       |
| متوسط   | tools_process_fs             | Writes are non-atomic, unserialised and have no undo                                                                                 | agent/tools/filesystem/WriteTools.js:85        |
| متوسط   | tools_process_fs             | executeTool does not validate arguments, enforce policy, or apply a timeout                                                          | agent/tools/ToolRuntime.js:182                 |
| متوسط   | tools_process_fs             | Telemetry records full tool arguments, including file contents and stdin                                                             | agent/tools/ToolRuntime.js:262                 |
| متوسط   | tools_process_fs             | Missing tests for the dangerous paths                                                                                                | test/tools                                     |
| متوسط   | web                          | Reopening a session with no run_ids pulls every event in the event store into it                                                     | web/server/ServerImplementation.js:393         |
| متوسط   | web                          | One failure in startTask's finally block skips the approval sweep, the run:status event and the session save                         | web/server/ServerImplementation.js:1232        |
| متوسط   | web                          | Every message, thinking chunk and model response rewrites the whole session file synchronously                                       | web/server/ServerImplementation.js:159         |
| متوسط   | web                          | SSE writes ignore backpressure, and every connect or reconnect resends the full snapshot                                             | web/server/SseHub.js:70                        |
| متوسط   | web                          | No security headers (CSP, nosniff, frame-ancestors) on console responses                                                             | web/server/Response.js:7                       |
| متوسط   | web                          | The visualizer injects symbol names from the indexed repo into innerHTML (DOM XSS)                                                   | web/public/visualizer/renderer.js:445          |
| متوسط   | web                          | The visualizer shows hard-coded demo data whenever the API fails, and the server ignores neighborhood and impact queries             | web/public/visualizer/renderer.js:149          |
| متوسط   | web                          | The modular WebServer is a facade: all 46 routes forward to a 3,000-line god function                                                | web/server/WebServer.js:170                    |
| متوسط   | web                          | No tests for malformed input, scoped-token authorization on control routes, or SSE backpressure                                      | test/web/web.test.js                           |
| پایین   | config_providers             | Scoped console token lookup is a non-constant-time object key lookup, and an invalid AGENT_CONSOLE_TOKENS JSON is silently ignored   | agent/config/ConsoleAuth.js:120                |
| پایین   | config_providers             | \--until-done SIGINT handler cannot force-quit and --max-cycles 0 is ignored                                                         | agent/cli/Cli.js:453                           |
| پایین   | config_providers             | ArgParser rejects any value beginning with '-' and has no '--' end-of-options marker                                                 | agent/cli/ArgParser.js:27                      |
| پایین   | config_providers             | Secret masking reveals 4 characters and secrets can be persisted into the repo                                                       | agent/config/SecretMasker.js:24                |
| پایین   | config_providers             | Dead/duplicated CLI modules: RunCommand and InputReader are unused; task-reading logic duplicated                                    | agent/cli/RunCommand.js:5                      |
| پایین   | core_agent                   | Windows/macOS path comparison makes repository.is_workspace_root wrong                                                               | agent/agent.js:1028                            |
| پایین   | core_agent                   | Registry signature recomputed (stat of every registry/tool-schema file) on every accessor call                                       | agent/agent.js:728                             |
| پایین   | core_agent                   | Schema degradation is process-global, permanent, and ineffective under RESPONSE_FORMAT_MODE=always                                   | agent/agent.js:2488                            |
| پایین   | core_agent                   | Native tool calls are ignored when content is also valid JSON                                                                        | agent/actions/ActionParser.js:195              |
| پایین   | core_agent                   | Malformed-response notice re-sends full canonical examples and up to 2.4k chars of rejected output every retry                       | agent/actions/ResponseRepair.js:673            |
| پایین   | core_agent                   | Duplicate entry-point/lifecycle logic; application layer's fallback path is dead and mis-bound                                       | agent/application/run-agent.js:55              |
| پایین   | core_agent                   | Signal handling is POSIX-centric; Windows service/terminal shutdown paths are not handled                                            | agent/application/lifecycle.js:44              |
| پایین   | core_agent                   | Backoff sleep between model retries ignores run cancellation                                                                         | agent/runtime/RetryController.js:135           |
| پایین   | core_agent                   | API key defaults to a placeholder and is sent to any configured base URL; base URLs are exposed to the model                         | agent/agent.js:2653                            |
| پایین   | core_agent                   | No streaming and no response-size bound on model calls                                                                               | agent/agent.js:2761                            |
| پایین   | core_agent                   | Strict response schema uses keywords some strict-mode providers do not support                                                       | agent/schema/response_format.strict.json:37    |
| پایین   | mcp                          | Non-atomic, unlocked read-modify-write of .agent/mcp.json                                                                            | agent/mcp/McpConfigLoader.js:324               |
| پایین   | mcp                          | tools/list_changed does not refresh the manager catalogue; runtime toggles are lost on reload                                        | agent/mcp/McpConnection.js:143                 |
| پایین   | mcp                          | Per-manager settings listeners leak and are never removed                                                                            | agent/mcp/McpManager.js:105                    |
| پایین   | mcp                          | Tool results lose non-text content (images, resources) whenever text is present                                                      | agent/mcp/protocol/JsonRpcCodec.js:140         |
| پایین   | mcp                          | semantic.js uses blocking execSync('which/where') on the request path                                                                | agent/mcp/semantic.js:79                       |
| پایین   | persistence_context_projects | Duplicate readDay definitions in EventStoreRepository (dead, shadowed code)                                                          | agent/persistence/EventStoreRepository.js:159  |
| پایین   | persistence_context_projects | Case-insensitive boundary comparison is assumed for all of macOS (fail-open on case-sensitive volumes)                               | agent/context/WorkspaceBoundary.js:126         |
| پایین   | persistence_context_projects | Archive maintenance rescans every segment synchronously on each archive call                                                         | agent/persistence/ArchiveRepository.js:914     |
| پایین   | persistence_context_projects | Synchronous listener exceptions propagate into emit() callers                                                                        | agent/events/EventBus.js:81                    |
| پایین   | persistence_context_projects | Journal attribution state leaks and mixes concurrent runs                                                                            | agent/persistence/JournalRepository.js:331     |
| پایین   | persistence_context_projects | Data home uses ~/.local/share on every OS and ignores XDG_DATA_HOME                                                                  | agent/projects/ProjectStore.js:51              |
| پایین   | persistence_context_projects | safeId maps distinct ids to the same file and allows Windows-invalid names                                                           | agent/persistence/SafeIdentifier.js:18         |
| پایین   | policy_hooks                 | Policy validator doesn't check rule shape: tools+groups together, unknown keys, non-array agents/argument_absent                     | agent/policy/PolicyMatcher.js:104              |
| پایین   | policy_hooks                 | Approval handler is a process-global singleton, and non-boolean answers count as approval                                            | agent/policy/ApprovalManager.js:56             |
| پایین   | policy_hooks                 | Pending web approvals have no timeout and leak when onRequest throws; IDs are predictable                                            | agent/policy/ApprovalManager.js:364            |
| پایین   | policy_hooks                 | argument_matches regexes are recompiled on every evaluation and stringify non-string args                                            | agent/policy/PolicyMatcher.js:72               |
| پایین   | policy_hooks                 | ApprovalStore exposes its internal history array, and errors are swallowed in project lookups                                        | agent/policy/ApprovalStore.js:49               |
| پایین   | registry_discussion          | ensureFinalReport throws away a string final_report                                                                                  | agent/discussion/observerRunner.js:44          |
| پایین   | registry_discussion          | Live reload is non-atomic: a half-written registry file throws mid-run, and the mtime/size stamp can miss edits                      | agent/registry/RegistryLoader.js:63            |
| پایین   | registry_discussion          | Transcript project isolation leaks legacy documents, and list() parses every transcript in full                                      | agent/discussion/DiscussionService.js:296      |
| پایین   | registry_discussion          | Loop detector treats empty or failed responses as repetition, and can crash on non-string content                                    | agent/discussion/loopDetector.js:9             |
| پایین   | registry_discussion          | File-based skill 'ui_ux_pro_max' is isolated from the skills.json registry and is not cross-validated                                | agent/skills/ui_ux_pro_max/skill.json:21       |
| پایین   | runtime                      | Retry-After parsing handles only delta-seconds; 409 treated as retryable                                                             | agent/runtime/RetryController.js:33            |
| پایین   | runtime                      | Unknown action outcome silently burns an iteration                                                                                   | agent/runtime/ActionProcessor.js:542           |
| پایین   | runtime                      | Project health is permanently 'degraded' after any single error                                                                      | agent/runtime/Observability.js:124             |
| پایین   | runtime                      | Process-global engine host prevents multiple engines / isolated tests                                                                | agent/runtime/engineContext.js:14              |
| پایین   | runtime                      | Duplicated malformed-response handling diverges from RetryController.noteMalformed                                                   | agent/runtime/IterationRunner.js:180           |
| پایین   | runtime                      | Unbounded growth of RunManager.issued for runs that never execute                                                                    | agent/runtime/RunManager.js:165                |
| پایین   | runtime                      | Delegation fallback policy ignores missing max_children                                                                              | agent/runtime/DelegationRunner.js:200          |
| پایین   | runtime                      | Argument reference to a known call not in depends_on fails the call                                                                  | agent/runtime/ToolGraphExecutor.js:760         |
| پایین   | tests_ci_packaging           | \`npm run check\` syntax-checks a single file                                                                                        | package.json:15                                |
| پایین   | tests_ci_packaging           | e2e tests leak temp workspaces and stub servers on failure                                                                           | test/e2e/e2e.test.js:296                       |
| پایین   | tests_ci_packaging           | Stale and broken documentation links and figures                                                                                     | README.md:30                                   |
| پایین   | tests_ci_packaging           | Scratch artefacts are present in the source tree despite .gitignore                                                                  | .gitignore:10                                  |
| پایین   | tools_other                  | Search sessions: running ones never pruned, limits and wait unbounded                                                                | agent/tools/search/SearchTools.js:336          |
| پایین   | tools_other                  | Index session duration and per-engine concurrency are wrong                                                                          | agent/tools/code/IndexSessions.js:69           |
| پایین   | tools_other                  | mcp_servers returns stale status after refresh; discover errors swallowed                                                            | agent/tools/mcp/McpTools.js:66                 |
| پایین   | tools_other                  | plan_set carries progress onto different steps when ids are positional                                                               | agent/tools/planning/PlanTools.js:104          |
| پایین   | tools_other                  | Skill cache ignores edits to directory skills                                                                                        | agent/tools/skills/SkillTools.js:103           |
| پایین   | tools_other                  | archive_get returns uncapped bodies for an unbounded id list                                                                         | agent/tools/memory/ArchiveTools.js:68          |
| پایین   | tools_process_fs             | fs_stat/fs_info symlink reporting is dead code; is_symlink is always false                                                           | agent/tools/filesystem/FileMetadataTools.js:20 |
| پایین   | tools_process_fs             | UTF-8 multibyte characters corrupted at chunk boundaries; Windows code pages ignored                                                 | agent/tools/process/ForegroundCommand.js:116   |
| پایین   | tools_process_fs             | Windows killTree is fire-and-forget and taskkill spawn errors are unhandled                                                          | agent/tools/process/ProcessManager.js:140      |
| پایین   | tools_process_fs             | isInsideRoot fails for filesystem-root workspaces and ignores Windows device/ADS paths                                               | agent/context/WorkspaceBoundary.js:132         |
| پایین   | tools_process_fs             | Leading-cd guard is cosmetic and can be mistaken for a boundary                                                                      | agent/tools/process/ForegroundCommand.js:31    |
| پایین   | web                          | The graph builder assumes POSIX paths, so module grouping breaks on Windows indexes                                                  | web/server/ServerImplementation.js:2096        |
| پایین   | web                          | The rate limiter keys on the raw socket address and fails open when the key map fills                                                | web/server/Middleware.js:87                    |
| پایین   | web                          | Accepting the token in the query string, plus a session cookie with no expiry and no Secure flag                                     | web/server/Middleware.js:44                    |
| پایین   | web                          | Frontend is a 159 KB single-file console with a non-module global Modal and no frontend tests                                        | web/public/app/console.js                      |
