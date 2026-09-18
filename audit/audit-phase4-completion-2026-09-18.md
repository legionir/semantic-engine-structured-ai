# Phase 4 Completion Evidence — 2026-09-18

## Scope

`semantic-engine` فاز ۴ مطابق `EXECUTION_PLAN.md`: AI tool schemas/runtime contracts، mutation simulation/query policy، context/token accounting، search mode/score contract، embedding cardinality، و graph parity/bounds.

## Implementation evidence

- `src/ai/tools/DetectArchitectureViolationsTool.ts`: `checkCyclesOnly` اکنون خروجی layer violations را حذف می‌کند؛ schema و runtime validation هم‌راستا هستند.
- `src/ai/tools/GetDependenciesTool.ts`: `depth` و `limit` نامعتبر با خطای صریح رد می‌شوند؛ clamp خاموش حذف شده است.
- `src/ai/tools/FindTestsTool.ts` و `GetConfigUsageTool.ts`: ورودی‌های معتبر با `anyOf` و validation runtime پوشش داده شدند.
- `src/ai/tools/SimulateMutationTool.ts` و `services/analysis/MutationSimulator.ts`: `move_symbol`، `newPath`، validation و گزارش broken references اضافه شد؛ graph اصلی mutate نمی‌شود.
- `src/ai/tools/queryPolicy.ts`: CTE alias، `WITH RECURSIVE`، nested query، comment/string و physical-table allowlist تفکیک شدند.
- `src/services/ContextService.ts`, `src/ai/tools/AssembleContextTool.ts`, `src/ai/llm/LlmAiMetadataGenerator.ts`: `targetFiles` حفظ می‌شود و token estimate از metadata/content واقعی محاسبه می‌شود.
- `src/services/SearchService.ts` و `src/ai/tools/SemanticSearchTool.ts`: modeهای `keyword`، `vector` و `hybrid` تفکیک، vector-only بدون keyword، `minScore` روی score نهایی، و `relevanceScore` به contract خروجی map شد.
- `src/vector/RemoteEmbeddingGenerator.ts` و `src/vector/VectorIndexer.ts`: cardinality، vector خالی، non-finite، dimension mismatch و missing result fail-fast هستند.
- `src/graphs/GraphQueryEngine.ts` و `src/export/sqlite/SqliteGraphQuery.ts`: defaultهای direction/depth/threshold/maxNodes مشترک، bounds معتبرسازی‌شده، و `truncated` برای traversal محدودشده گزارش می‌شود.

## Focused validation evidence

در checkout موقت با dependencyهای manifest و binaryهای local:

- `npm run build` / `tsc -p ./`: **PASS**
- query policy focused suite: **32 passed**
- graph focused suites: **37 passed**
- semantic search focused suite: **25 passed**
- vector indexer focused suite: **19 passed**
- remote embedding focused suite: **2 passed**
- mutation move/rename/delete focused scenarios: **PASS**

تست‌های اضافه‌شده/به‌روزشده:

- `src/ai/tools/queryPolicy.test.ts`
- `src/services/analysis/MutationSimulator.phase4.test.ts`
- `src/vector/RemoteEmbeddingGenerator.phase4.test.ts`
- `src/vector/VectorIndexer.phase44.test.ts`
- `src/export/sqlite/SqliteGraphQuery.phase4.test.ts`
- `src/ai/tools/SemanticSearchTool.test.ts`

## Known validation boundary

اجرای full Jest suite در یک اجرای مستقل به timeout محیط رسید؛ بنابراین full-suite pass ادعا نمی‌شود. focused suites و typecheck/build با نتیجهٔ بالا اجرا شدند. این محدودیت، معیارهای focused فاز ۴ را نقض نمی‌کند، اما در فاز ۹ باید full matrix و compatibility/performance دوباره اجرا شود.

## Acceptance mapping

1. هر option یا runtime effect/validation صریح دارد: **PASS در focused tests**.
2. move_symbol، CTE alias، targetFiles و token estimate: **PASS در focused tests/build**.
3. search mode/minScore و score contract: **PASS در focused tests**؛ project scope از handle/reader جاری حفظ شده و باید در matrix چندپروژه‌ای فاز ۹ مجدداً smoke شود.
4. embedding cardinality ناقص success دروغین تولید نمی‌کند: **PASS در focused tests**.
5. SQLite/in-memory graph default و maxNodes: **PASS در focused graph tests/build**.

## Status

فاز ۴ و گام‌های ۱ تا ۵ پس از انتقال این تغییرات به branch، با توجه به evidence فوق، قابل علامت‌گذاری `🟢` هستند؛ full-suite و performance همچنان scope فازهای ۹ و ۱۰ باقی می‌مانند و نباید از این گزارش pass سراسری نتیجه‌گیری شود.
