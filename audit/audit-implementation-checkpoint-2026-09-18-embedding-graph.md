# Checkpoint گام ۵ فاز ۴ — 2026-09-18

## Revision

- Branch: `docs/audit-file-status`
- Commit: `321c7b8b555c1e2aa995428adc1d1f324d6fba2e`

## تغییرات

- `semantic-engine/src/vector/RemoteEmbeddingGenerator.ts`
  - پاسخ OpenAI-compatible اکنون cardinality دقیقاً برابر تعداد ورودی‌ها را لازم دارد.
  - پاسخ‌های Ollama نیز cardinality، بردار non-empty، finite و ابعاد یکسان را validate می‌کنند.
  - پاسخ ناقص یا ناسازگار با error صریح fail می‌شود و success دروغین تولید نمی‌کند.
- `semantic-engine/src/vector/VectorIndexer.ts`
  - `generateBatch` باید برای تمام chunkهای pending نتیجه برگرداند.
  - نتیجهٔ missing، empty، non-finite یا inconsistent dimensions پیش از mutation خطا می‌دهد.
  - silent skip برای embedding ناقص حذف شد.
- `semantic-engine/src/graphs/GraphQueryEngine.ts`
  - default عمق `shortestPath` از literal مستقل `8` به `DEFAULT_DEPTH` مشترک تغییر کرد تا با traversalهای دیگر قرارداد واحد داشته باشد.

## وضعیت validation

- focused test و typecheck در محیط دارای dependency کامل در این checkpoint اجرا نشده‌اند؛ pass ادعا نمی‌شود.
- parity کامل بین SQLite و in-memory، مخصوصاً payload و edge cases `maxNodes`/direction/threshold، همچنان **Unknown / Requires Verification** است و باید در validation فاز ۹ اجرا شود.
- فاز ۴ و گام ۵ وضعیت 🟡 دارند؛ implementation ثبت شده اما Definition of Done و معیار پذیرش نهایی هنوز اثبات نشده است.
