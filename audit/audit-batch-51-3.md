# Audit batch 51-3 — ۱۷ فایل بعدی

## دامنه و روش

این batch دقیقاً ۱۷ ورودی بعدیِ وضعیت «درانتظار» در `AUDIT_FILE_STATUS.md` را پوشش می‌دهد (ردیف‌های 278–283، 286–287، 289، 291–298). هر ۱۷ فایل از ابتدا تا انتها، خط‌به‌خط خوانده شد؛ برای sourceها نقش، ورودی/خروجی، call path، وابستگی‌ها، رفتار خطا، multi-project scope و محدودیت‌ها بررسی شد و برای testها fixtureها، assertions و پوشش مرتبط بررسی شد. امنیت عمداً خارج از scope بود.

## فهرست دقیق فایل‌های بررسی‌شده

1. `semantic-engine/src/graphs/DependencyGraphBuilder.ts`
2. `semantic-engine/src/graphs/EdgeProvenance.test.ts`
3. `semantic-engine/src/graphs/EdgeProvenance.ts`
4. `semantic-engine/src/graphs/GraphBuilders.test.ts`
5. `semantic-engine/src/graphs/GraphFacts.phase49.test.ts`
6. `semantic-engine/src/graphs/GraphProvenance.test.ts`
7. `semantic-engine/src/graphs/ImportIndex.ts`
8. `semantic-engine/src/graphs/LayeredGraph.test.ts`
9. `semantic-engine/src/graphs/ReverseDependencyIndex.test.ts`
10. `semantic-engine/src/graphs/SubgraphExplorer.test.ts`
11. `semantic-engine/src/graphs/SubgraphExplorer.ts`
12. `semantic-engine/src/graphs/SymbolIndex.ts`
13. `semantic-engine/src/graphs/TypeGraphBuilder.ts`
14. `semantic-engine/src/graphs/index.ts`
15. `semantic-engine/src/host/Cancellation.test.ts`
16. `semantic-engine/src/host/Cancellation.ts`
17. `semantic-engine/src/host/Config.test.ts`

## یافته‌های قطعی

**هیچ finding قطعی با شواهد کافی در این ۱۷ فایل ثبت نشد.** موارد زیر به دلیل نیاز به قراردادهای خارج از این batch یا اجرای runtime، فقط POTENTIAL/UNVERIFIED هستند و finding قطعی محسوب نمی‌شوند.

## POTENTIAL / UNVERIFIED

### P-1 — resolveImportPath در build مصرف نمی‌شود (UNVERIFIED)

- **فایل/شواهد:** `semantic-engine/src/graphs/DependencyGraphBuilder.ts:12-18` یک `fileIdByPath` می‌سازد؛ `:65-67` متد عمومی `resolveImportPath()` همان index را می‌خواند. اما شاخه‌های `build()` در `:38-50` فقط `imp.resolvedFileId` را بررسی می‌کنند و در حالت localِ فاقد آن، مستقیماً `packageRef(imp.from)` می‌سازند.
- **اثر احتمالی:** اگر قرارداد ورودی انتظار داشته باشد builder خودش مسیر local را از `imp.from` به فایل‌های موجود resolve کند، import موجود در همان project به‌عنوان `pkg:./...` ثبت می‌شود و edge فایل از دست می‌رود.
- **چرا قطعی نیست:** ممکن است resolution عمداً upstream انجام شود و `resolveImportPath()` فقط API کمکی باشد؛ testهای موجود نیز فقط local import دارای `resolvedFileId` را assert می‌کنند (`GraphBuilders.test.ts:215-237`).

### P-2 — `makeEdgeId` مقدار occurrence برابر صفر را مانند مقدارِ غایب encode می‌کند (POTENTIAL)

- **فایل/شواهد:** `semantic-engine/src/graphs/EdgeProvenance.ts:120-129` شامل `identity.occurrence ? String(identity.occurrence) : ''` است؛ بنابراین `occurrence: 0` و omission هر دو رشتهٔ خالی تولید می‌کنند.
- **اثر احتمالی:** اگر caller از شماره‌گذاری صفرمبنا استفاده کند، edge با occurrence صفر و همان edge بدون occurrence شناسهٔ یکسان می‌گیرند.
- **چرا قطعی نیست:** قرارداد تولیدکنندهٔ `EdgeIdentity` در فایل‌های خارج از این batch بررسی/اثبات نشد؛ test موجود فقط تمایز `0` در برابر `1` را می‌سنجد (`EdgeProvenance.test.ts:72-77`) و آن سبز بودن را تضمین نمی‌کند.

### P-3 — تبدیل token به AbortSignal، registration را قابل dispose به caller نمی‌دهد (POTENTIAL)

- **فایل/شواهد:** `semantic-engine/src/host/Cancellation.ts:161-171` در `toAbortSignal()` روی token listener ثبت می‌کند، ولی disposable برگشتی را نگه نمی‌دارد و `AbortSignal` هم API dispose ندارد.
- **اثر احتمالی:** تا زمان cancellation یا drop شدن source، wrapper closure در listenerهای token باقی می‌ماند؛ در استفادهٔ پرتعداد از sourceهای طولانی‌عمر ممکن است رشد listener/closure رخ دهد.
- **چرا قطعی نیست:** lifetime مورد انتظار source و الگوی مصرف خارج از این batch مشخص نیست؛ تست‌های `Cancellation.test.ts:149-173` فقط propagation را assert می‌کنند، نه cleanup.

## خلاصهٔ فایل‌ها و قراردادهای بررسی‌شده

| فایل | نقش و call path | خطا/محدودیت و multi-project scope | تست مرتبط |
|---|---|---|---|
| `DependencyGraphBuilder.ts` | `FileEntry[] → DependencyEdge[]`; importها را به edgeهای file/package تبدیل می‌کند و provenance می‌دهد | فایل‌ها در یک builder instance scope می‌شوند؛ resolution مسیر فقط از `resolvedFileId` می‌آید؛ import بدون آن unresolved/package-ref می‌شود | `GraphBuilders.test.ts`, `GraphProvenance.test.ts` |
| `EdgeProvenance.test.ts` | قرارداد confidence، provenance، hash id و package namespace | unit assertions؛ collision رمزنگاری را اثبات نمی‌کند | `EdgeProvenance.ts` |
| `EdgeProvenance.ts` | basis/confidence، edge identity، `pkg:` namespace | `makeEdgeId` طول ۱۶ hex و occurrence اختیاری دارد؛ basis فقط enum داخلی است | tests همین فایل |
| `GraphBuilders.test.ts` | integration-ish fixture برای Call/Type/Dependency builders | fixture فایل موقت می‌سازد؛ cross-file checks وابسته به دادهٔ دستی‌اند | `CallGraphBuilder`, `TypeGraphBuilder`, `DependencyGraphBuilder` |
| `GraphFacts.phase49.test.ts` | acceptance روی parser/extractor واقعی، provenance، reverse graph و direction | به grammar binaries و parser runtime نیاز دارد؛ id equality در همان fixture سنجیده می‌شود | builders و reverse index |
| `GraphProvenance.test.ts` | قراردادهای contested-edge و dedup برای `GraphQueryEngine` | خود فایل‌های engine خارج از این batch‌اند؛ تست به آن‌ها وابسته است | `GraphQueryEngine` |
| `ImportIndex.ts` | `FileEntry[] → fileId/localName → ImportBinding` | local duplicate با `Map.set` آخرین binding را نگه می‌دارد؛ validation مستقلی ندارد | در این batch تست مستقیم ندارد؛ در `GraphBuilders.test.ts` به‌صورت غیرمستقیم مصرف builder است |
| `LayeredGraph.test.ts` | acceptance شش‌لایه، label resolution، blueprint bridges و deterministic output | به `LayeredGraph`, `BlueprintGenerator`, parser/blueprint قراردادهای خارج batch وابسته است | همین فایل |
| `ReverseDependencyIndex.test.ts` | جهت معکوس file/type/call و dedup را assert می‌کند | ورودی‌های دستی provenance دارند؛ package-ref در این test خام (`lodash`) است و با builder تولید نمی‌شود | `ReverseDependencyIndex` |
| `SubgraphExplorer.test.ts` | چندریشه، direction، confidence scoring، budget، cycles و induced edges | اجرای واقعی نیازمند `GraphQueryEngine`; tie-break قرارداد صریح ندارد | `SubgraphExplorer.ts` |
| `SubgraphExplorer.ts` | best-first exploration با heap و maxNodes/maxDepth/maxVisited | گزینه‌ها validate نمی‌شوند؛ `finish` edgeهای induced را با جهت out جمع می‌کند (برای induced graph معمولاً درست است، ولی contract direction خارج batch است) | `SubgraphExplorer.test.ts` |
| `SymbolIndex.ts` | lookup بر id/file/line/name/children/enclosing type | global `findByName` اولین insertion match را می‌دهد؛ عمداً heuristic است و multi-project index جداگانه لازم دارد | `GraphBuilders.test.ts`, `GraphFacts.phase49.test.ts` |
| `TypeGraphBuilder.ts` | extends/implements را با SymbolIndex به TypeEdge تبدیل می‌کند | same-file name match سپس global name match؛ unresolved relation حذف می‌شود؛ ورودی یک project است | `GraphBuilders.test.ts`, `GraphFacts.phase49.test.ts` |
| `graphs/index.ts` | barrel export برای graph APIs | `SubgraphExplorer` و provenance/query exports را re-export نمی‌کند؛ مصرف مستقیم path لازم است (POTENTIAL، نه finding قطعی) | imports تست‌ها |
| `Cancellation.test.ts` | رفتار source/token، listener، AbortSignal bridge، timeout/link و throw | timer timeout test به real wall-clock وابسته است؛ cleanup پل toAbortSignal مستقیم test نشده | `Cancellation.ts` |
| `Cancellation.ts` | token مستقل، source، timeout/link، AbortSignal bridge | listener callback عمداً swallow می‌شود؛ dispose source listenerها را drop می‌کند؛ toAbortSignal registration lifecycle محدود دارد | همین فایل |
| `Config.test.ts` | precedence، parsing، validation، disk discovery، introspection | فقط test است و implementation `Config.ts` خارج batch است؛ تست اجرا نیازمند Jest/ts-jest است | `Config.ts` |

## تست و امکان اجرا

اجرای دستور تست منتخب ممکن نشد: `semantic-engine/node_modules` وجود ندارد و Jest هنگام اجرای مستقیم با خطای قطعی زیر متوقف شد:

```text
Validation Error:
Preset ts-jest not found relative to rootDir /tasklet/threads/a_pjgnxp3j2201gp81brsm/work/repo/semantic-engine.
```

اجرای `npm test -- --runInBand ...` نیز به‌علت نبود dependencyها در مهلت اجرا timeout شد. بنابراین هیچ نتیجهٔ سبز/قرمز runtime ادعا نمی‌شود. کامپایل مستقل هم ممکن نبود چون `tsc` محلی/قابل اجرا در محیط موجود نبود. این محدودیت دقیقاً ثبت شد و به‌عنوان finding کد محسوب نشده است.

## نتیجه

این گزارش فقط همین ۱۷ فایل را پوشش می‌دهد. هیچ فایل دیگری برای audit این batch انتخاب یا گزارش نشده است.
