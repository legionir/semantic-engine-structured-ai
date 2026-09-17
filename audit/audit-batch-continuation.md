# گزارش ادامهٔ ممیزی

## دامنه

۲۰ فایل نخستِ وضعیت «درانتظار» در `semantic-engine` بررسی شد (فهرست دقیق در انتهای گزارش). هر فایل کامل و خط‌به‌خط خوانده شد؛ امنیت عمداً خارج از scope بود. برای هر جزء، نقش، ورودی/خروجی، مسیر فراخوانی، وابستگی‌ها، مدیریت خطا، scope چندپروژه‌ای، تست مرتبط و محدودیت‌ها بررسی شد.

## یافتهٔ قطعی

### SE-AI-09-FB — هزینهٔ fallback از طول مسیر فایل محاسبه می‌شود
- **Evidence verbatim:** در `semantic-engine/src/ai/llm/LlmAiMetadataGenerator.ts:281-284` کد می‌گوید `estimateTokens(content)` و آن را با `sharedEstimateTokens(content)` محاسبه می‌کند.
- **Evidence verbatim:** همان فایل در `:286-295` در fallback دارد: `estimatedTokenCost: this.estimateTokens(file.path)`.
- **اثر:** هنگام شکست LLM، هزینهٔ تخمینی بر اساس رشتهٔ مسیر (`file.path`) ثبت می‌شود، نه محتوای زمینه/اندازهٔ فایل؛ بنابراین بودجه‌بندی downstream می‌تواند برای فایل بزرگ مقدار بسیار کوچک بگیرد. این شاخه در تست `LlmAiMetadataGenerator.test.ts` (تست `should fall back on LLM failure`) فقط summary و keywords را assert می‌کند و هزینه را بررسی نمی‌کند.
- **مسیر فراخوانی:** `generate` → `worker` → `generateForFile` → catch خطا → `fallbackMetadata` → `estimateTokens(file.path)`؛ همچنین مسیر سقف بودجه/لغو مستقیماً `worker` → `fallbackMetadata` است.
- **طبقه‌بندی:** قطعی، چون آرگومان literalاً `file.path` است و با قرارداد نام تابع/کامنت `estimateTokens` ناسازگار است.

## تحلیل اجزای بررسی‌شده

- `ConfigUsageMapper` و تستش: اسکن خط‌به‌خط JS/TS/Python/Go/Rust، خروجی `ConfigUsageEntry[]` با dedupe، line و redacted context؛ مصرف اصلی تولید project-index است. محدودیت‌ها regex-based بودن و پوشش ندادن syntaxهای پیچیده/aliasهاست (POTENTIAL، بدون ادعای نقص قطعی).
- `ProjectIndexReader.test.ts`: قرارداد نگاشت `symbol.testIds` به فایل‌های test و فیلتر non-test را پوشش می‌دهد؛ وابسته به شکل project-index و lookupهای reader است.
- `TestMapper` و تستش: در constructor ایندکس‌های file/import/specifier/path را می‌سازد و `buildSymbolToTestMap` خروجی مرتب symbol→test IDs می‌دهد؛ تست‌ها false-positive و رشد هزینه را هم می‌سنجند. محدودیت، اتکا به import metadata از قبل resolve/parseشده است (POTENTIAL).
- `BlueprintIndex`: blueprint را index می‌کند، module/file lookup و match امتیازدار ۰..۱ می‌دهد؛ `ContextDiscoverer` آن را برای blueprint seeds مصرف می‌کند. برخورد duplicate fileId عمداً first-wins است؛ نتیجه به ترتیب ورودی blueprint وابسته می‌ماند (رفتار مستندشده، finding نیست).
- `ContextDiscoverer` و تستش: `task` را با `queryTerms` به search seeds، blueprint seeds، گسترش `SubgraphExplorer` و سپس `ContextRanker` می‌فرستد و `DiscoveryResult` برمی‌گرداند؛ owner symbol→file bridge، depth/limit/maxNodes/includeTests/maxPerFile و deterministic ordering تست شده‌اند. نبود seed خروجی خالی است، نه خطا.
- `loadBlueprint.test.ts`: تولید/خواندن blueprint کنار project-index، نبود فایل، JSON خراب و schema ناقص را پوشش می‌دهد؛ loader در failure به `{index:null,note}` تنزل می‌کند.
- `estimatedTokenCost.phase45.test.ts`: هم‌خوانی generator heuristic با `TokenBudget.estimateTokens` و عدم وابستگی به path را تست می‌کند؛ این تست fallback LLM را پوشش نمی‌دهد (مرتبط با یافته بالا).
- `ai/index.ts`: فقط `AiMetadataGenerator` را export می‌کند؛ LLM/discovery exports از این barrel قابل دسترسی نیستند (finding نیست، اما API surface محدود است).
- `LlmAiMetadataGenerator` و تستش: فایل‌های non-binary را batch/concurrent پردازش می‌کند، hash cache، request budget، AbortSignal، redaction، JSON parse و heuristic fallback دارد؛ خروجی map به ازای فایل است. خطای parse JSON به `{}` تبدیل می‌شود و سپس fallback field-level اعمال می‌شود؛ خطای کل درخواست به fallback کامل می‌رود.
- `LlmClient.ts`: قرارداد provider-neutral پیام، completion options/result و `dispose` را تعریف می‌کند؛ implementation ندارد.
- `OpenAILlmClient` و تستش: POST به `${baseUrl}/chat/completions` با payload OpenAI-compatible، trim content، usage mapping و خطای non-2xx/empty content؛ custom base URL و API error تست شده است.
- `SecretRedactor`: زنجیرهٔ regexهای token/key/JWT/connection/private-key/password/secret را روی متن اعمال می‌کند؛ طبق درخواست، ارزیابی امنیتی انجام نشد.
- `SemanticEngineMcpServer.test.ts`: construction، tools/list، tools/call و custom transport را از مسیر MCP protocol بررسی می‌کند؛ server ابزارها را به tool handlerها route می‌کند و نتیجهٔ JSON را برمی‌گرداند.
- `cli.security.test.ts`: فقط به‌عنوان تست مرتبط ثبت شد؛ اجرای امنیتی/داوری امنیتی انجام نشد.
- `mcpIndexGeneration.test.ts`: runIndex/OutputWriter را برای counter نسل، MCP structuredContent و consumer cache invalidation end-to-end به‌کار می‌گیرد؛ consumer tests در صورت نبود فایل‌ها skip می‌شوند.

## فایل‌های بررسی‌شده (دقیقاً ۲۰ مورد)

1. `semantic-engine/src/ai/ConfigUsageMapper.test.ts`
2. `semantic-engine/src/ai/ConfigUsageMapper.ts`
3. `semantic-engine/src/ai/ProjectIndexReader.test.ts`
4. `semantic-engine/src/ai/TestMapper.phase45.test.ts`
5. `semantic-engine/src/ai/TestMapper.ts`
6. `semantic-engine/src/ai/discovery/BlueprintIndex.ts`
7. `semantic-engine/src/ai/discovery/ContextDiscoverer.test.ts`
8. `semantic-engine/src/ai/discovery/ContextDiscoverer.ts`
9. `semantic-engine/src/ai/discovery/loadBlueprint.test.ts`
10. `semantic-engine/src/ai/estimatedTokenCost.phase45.test.ts`
11. `semantic-engine/src/ai/index.ts`
12. `semantic-engine/src/ai/llm/LlmAiMetadataGenerator.test.ts`
13. `semantic-engine/src/ai/llm/LlmAiMetadataGenerator.ts`
14. `semantic-engine/src/ai/llm/LlmClient.ts`
15. `semantic-engine/src/ai/llm/OpenAILlmClient.test.ts`
16. `semantic-engine/src/ai/llm/OpenAILlmClient.ts`
17. `semantic-engine/src/ai/llm/SecretRedactor.ts`
18. `semantic-engine/src/ai/mcp/SemanticEngineMcpServer.test.ts`
19. `semantic-engine/src/ai/mcp/cli.security.test.ts`
20. `semantic-engine/src/ai/mcp/mcpIndexGeneration.test.ts`

## تست اجراشده

دستور targeted Jest برای هر ۱۱ فایل تست مرتبط اجرا شد، اما اجرا قبل از test discovery متوقف شد: `Preset ts-jest not found relative to rootDir .../semantic-engine`. بنابراین هیچ تستی pass/fail واقعی گزارش نمی‌شود؛ این مانع محیطی است، نه نتیجهٔ تست.
