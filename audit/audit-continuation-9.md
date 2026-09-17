# ادامهٔ ممیزی — ۲۰ فایل بعدی

محدوده: دقیقاً ۲۰ فایل اول با وضعیت «درانتظار» در `AUDIT_FILE_STATUS.md`، از ردیف ۳۲۴ تا ۳۴۴. امنیت خارج از scope است. بررسی کامل خط‌به‌خط با تمرکز بر نقش، مسیر فراخوانی، وابستگی، خطا، scope چندپروژه‌ای، تست مرتبط و محدودیت انجام شد.

## یافته‌های قطعی

### F-1 — `CapabilityProbe.forget(serverId)` اجرای درحال‌پرواز را invalidate نمی‌کند
- **شدت پیشنهادی:** متوسط؛ کش قابلیت می‌تواند پس از درخواست refresh دوباره با نتیجهٔ قدیمی پر شود.
- **Evidence:** `semantic-engine/src/lsp/CapabilityProbe.ts:125-134`
  ```ts
  forget(serverId?: string): void {
    if (!serverId) {
      this.cache.clear();
      this.inFlight.clear();
      return;
    }
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(`${serverId}:`)) this.cache.delete(key);
    }
  }
  ```
  و شروع/ثبت نتیجهٔ اجرای درحال‌پرواز در `:152-164`:
  ```ts
  const running = this.inFlight.get(key);
  if (running) return running;
  ...
  .then(report => {
    this.cache.set(key, report);
    return report;
  })
  ...
  this.inFlight.set(key, started);
  ```
- **اثبات:** در مسیر `forget(serverId)` فقط `cache` پاک می‌شود؛ `inFlight` پاک نمی‌شود. اگر probe همان serverId در حال اجرا باشد، بعد از `forget` کامل شود، `.then` آن بدون توجه به invalidation دوباره همان key را در `cache` می‌نویسد. `forget()` بدون serverId این مشکل را ندارد چون هر دو map را پاک می‌کند.
- **تست مرتبط:** `CapabilityProbe.test.ts` تست‌های کش (`:115-165`) cache hit و هم‌زمانی را پوشش می‌دهند، اما سناریوی `forget(serverId)` درحالی‌که probe در پرواز است را پوشش نمی‌دهند.

### F-2 — timeout مسیر push در `DiagnosticsProvider` waiter اشتباه را حذف می‌کند
- **شدت پیشنهادی:** متوسط؛ waiterهای timeout‌شده در map باقی می‌مانند و با publish بعدی دوباره اجرا می‌شوند.
- **Evidence:** `semantic-engine/src/lsp/DiagnosticsProvider.ts:232-253`
  ```ts
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      this.removeWaiter(uri, resolve);
      resolve();
    }, waitMs);
    ...
    const waiter = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const list = this.pushWaiters.get(uri);
    if (list) list.push(waiter);
    else this.pushWaiters.set(uri, [waiter]);
  });
  ```
  و `removeWaiter` در `:268-273`:
  ```ts
  const remaining = list.filter(waiter => waiter !== resolve);
  ```
- **اثبات:** map در `:248-250` تابع wrapper یعنی `waiter` را ذخیره می‌کند، ولی callback تایمر در `:239` تابع promise resolver یعنی `resolve` را به `removeWaiter` می‌دهد. این دو reference برابر نیستند؛ بنابراین `filter` چیزی حذف نمی‌کند. پس پس از timeout، waiter در `pushWaiters` باقی می‌ماند تا publishDiagnostics بعدی؛ آن publish همهٔ waiterهای قدیمی را نیز اجرا می‌کند و map را پاک می‌کند. با تکرار timeout بدون publish، map رشد می‌کند.
- **تست مرتبط:** `DiagnosticsProvider.test.ts:196-239` مسیر push و `:254-271` timeout کند را پوشش می‌دهد، اما timeoutهای متوالی بدون publish یا بررسی پاک‌شدن `pushWaiters` را پوشش نمی‌دهد.

### F-3 — شناسهٔ یال برای چند call-site هم‌خط در `LspEnrichmentService` تکراری است
- **شدت پیشنهادی:** بالا؛ مصرف‌کننده‌ای که یال‌ها را با `id` map/set کند، یال‌های تکراری را overwrite/deduplicate می‌کند.
- **Evidence:** `semantic-engine/src/lsp/LspEnrichmentService.ts:450-460`
  ```ts
  for (const range of call.fromRanges ?? [{ start: { line: line - 1, character: 0 } }]) {
    const callLine = range.start.line + 1;
    const identity: EdgeIdentity = {
      from: caller?.id ?? fileId,
      to: symbol.id,
      kind: 'direct',
      line: callLine,
    };
    const file = fileById.get(fileId);
    edges.push({
      id: makeEdgeId({ ...identity, occurrence: 0 }),
  ```
  قرارداد شناسه در `semantic-engine/src/graphs/EdgeProvenance.ts:101-108` صریحاً occurrence را برای `f(g(), g())` لازم می‌داند و `makeEdgeId` آن را در `:120-129` وارد hash می‌کند.
- **اثبات:** برای دو `fromRanges` متفاوت روی یک خط، `from`، `to`، `kind` و `line` یکسان‌اند و کد همیشه `occurrence: 0` می‌دهد؛ بنابراین همان `id` تولید می‌شود. حتی اگر ستون‌ها متفاوت باشند، ستون در identity نیست. این دقیقاً سناریویی است که قرارداد occurrence برایش طراحی شده است.
- **تست مرتبط:** `LspEnrichmentService.test.ts:305-379` resolved edge، caller داخلی/ماژول، خارج از index و callable-kind را پوشش می‌دهد، اما چند range روی یک خط و یکتایی id را تست نمی‌کند.

## موارد POTENTIAL / UNVERIFIED

### P-1 — scope چندزبان/چندپروژه‌ای در enrichment یک client و یک languageId را برای همهٔ فایل‌ها استفاده می‌کند
- `LspEnrichmentService.enrich` در `:150-151` فقط یک client را با `input.languageId ?? 'typescript'` می‌گیرد؛ سپس در `:181-187` فایل‌های چند language را در scope می‌گذارد و در `:224-226` همه را با همان `languageId` باز می‌کند. اگر `files` واقعاً بیش از یک زبان یا بیش از یک project-root داشته باشند، ممکن است فایل با سرور/شناسهٔ نادرست سنجیده شود. تست `LspEnrichmentService.test.ts:180-223` فقط فیلتر زبان را در حالت single-client بررسی می‌کند. نیاز به قرارداد caller دربارهٔ single-language input برای قطعی‌کردن دارد؛ بنابراین POTENTIAL است.

### P-2 — سقف wall-clock enrichment درخواست‌های درحال انتظار را قطع نمی‌کند
- deadline فقط پیش از شروع کار (`:236-240`) و پس از اتمام همهٔ workerها (`:288`) بررسی می‌شود. `referenceCount`/`hover`/`incomingEdges` درخواست‌ها را با timeout مستقل (`:349-389`, `:400-477`) await می‌کنند. بنابراین یک درخواست کند می‌تواند اجرای واقعی را از `maxWallClockMs` عبور دهد؛ شدت/اثر عملی به رفتار `LspClient` و مقدار request timeout وابسته است.

### P-3 — محاسبهٔ `budgetExhausted` فقط سقف references را صریحاً علامت می‌زند
- در `:288-290` فقط `outOfTime()` و `counters.references >= maxReferenceQueries` بررسی می‌شوند؛ رسیدن دقیق به `maxCallHierarchyQueries` یا `maxHoverQueries` به‌تنهایی flag را set نمی‌کند. چون hover پیش‌فرض صفر است و call hierarchy معمولاً همراه references اجرا می‌شود، اثر قرارداد وابسته به budget سفارشی است؛ به‌عنوان POTENTIAL ثبت شد.

## خلاصهٔ فایل‌به‌فایل

۱. `semantic-engine/src/incremental/index.ts` — barrel export؛ وابستگی/مسیر فراخوانی از exportهای زیرماژول؛ تست اختصاصی در این فایل نیست؛ finding قطعی ندارد.
۲. `language/LanguageRegistry.test.ts` — تست تشخیص پسوند و shebang/پشتیبانی extractor؛ finding ندارد.
۳. `language/LanguageRegistry.ts` — basename/pattern/extension/shebang و deep-analysis lookup؛ finding قطعی ندارد.
۴. `language/LanguageTable.phase22.test.ts` — سازگاری جدول و extractorهای واقعی، JSONC و duplicate guard؛ finding ندارد.
۵. `language/index.ts` — barrel export زبان؛ finding ندارد.
۶. `language/languageMap.ts` — منبع حقیقت تعریف زبان، lookupها، collision guard و comment syntax؛ finding قطعی ندارد.
۷. `lsp/CapabilityProbe.test.ts` — verdict/cache/anchor/helper؛ gap مربوط به F-1 در بالا.
۸. `lsp/CapabilityProbe.ts` — probe اعلام‌شده در برابر نتیجهٔ واقعی، cache بر اساس server×language؛ F-1.
۹. `lsp/DiagnosticsProvider.integration.test.ts` — قرارداد integration با LSP واقعی؛ finding ندارد.
۱۰. `lsp/DiagnosticsProvider.test.ts` — pull/push/unchanged/schema/timeout؛ gap مربوط به F-2 در بالا.
۱۱. `lsp/DiagnosticsProvider.ts` — diagnostics pull با push fallback، resultId cache و schema mapping؛ F-2.
۱۲. `lsp/InteractiveOps.integration.test.ts` — عملیات تعاملی با سرور واقعی؛ finding ندارد.
۱۳. `lsp/InteractiveOps.test.ts` — rename/organize/definition/incoming/diagnostics؛ finding قطعی ندارد.
۱۴. `lsp/InteractiveOps.ts` — API تک‌درخواستی، document lifecycle، workspace edit و path normalization؛ finding قطعی ندارد.
۱۵. `lsp/LspClient.integration.test.ts` — handshake و سرور قراردادی واقعی؛ finding ندارد.
۱۶. `lsp/LspClient.test.ts` — lifecycle, timeout, document ref-count, stderr؛ finding ندارد.
۱۷. `lsp/LspClient.ts` — JSON-RPC process client، request cancellation، lifecycle و document refs؛ finding قطعی ندارد.
۱۸. `lsp/LspEnrichmentService.integration.test.ts` — enrichment با LSP واقعی؛ finding ندارد.
۱۹. `lsp/LspEnrichmentService.test.ts` — references/budget/scope/edges/prioritization؛ gap F-3 و موارد P-1..P-3.
۲۰. `lsp/LspEnrichmentService.ts` — enrichment بودجه‌دار و resolved call edges؛ F-3، P-1..P-3.

## تست و محدودیت اجرا

تلاش برای اجرای focused tests با `vitest` انجام شد، اما این repo طبق `semantic-engine/package.json:40-43` از Jest استفاده می‌کند و `node_modules` محلی موجود نبود؛ npx/vitest تا timeout محیطی ادامه یافت و متوقف شد. تلاش دوم با `npm test -- --runInBand ...` نیز به‌دلیل نبود `node_modules` در مرحلهٔ `pretest` (`node scripts/gen-fixture.js`) تا timeout محیطی ماند. بنابراین هیچ نتیجهٔ pass/fail قابل اتکایی از اجرای تست‌ها ندارم؛ تست‌ها فقط از روی کد و پیکربندی بررسی شدند.
