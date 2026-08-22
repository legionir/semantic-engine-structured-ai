# Tree-sitter Symbol Extractor

پیاده‌سازی استخراج symbol مبتنی بر tree-sitter برای TypeScript / JavaScript / TSX / JSX.

## وضعیت

- ✅ WASM grammar ها از `tree-sitter-grammars/` بارگذاری می‌شوند.
- ✅ `TreeSitterParserManager` parser ها را init و cache می‌کند.
- ✅ `TreeSitterAstCache` parse tree ها را بر اساس hash محتوا cache می‌کند.
- ✅ `TreeSitterIncrementalParser` reparse incremental با API tree-sitter را پشتیبانی می‌کند.
- ✅ `TreeSitterSymbolExtractor` اینترفیس `ISymbolExtractor` را implement کرده و در fallback chain بین LSP (priority=100) و heuristic (priority=10) با priority=50 ثبت شده است.

## fallback chain

```
LSP (100) → tree-sitter (50) → heuristic (10)
```

## زبان‌های پشتیبانی‌شده

- `typescript`
- `javascript`
- `typescriptreact` (tsx)
- `javascriptreact` (jsx)

## استخراج‌شونده‌ها

- class / interface / enum / type-alias / namespace / module
- function / method / constructor / property
- variable / constant
- nested symbols با `parentId`
- parameters / signature / return type
- visibility (public/private/protected) از modifier ها و `#private` fields
- modifiers: async / generator / abstract / static / readonly
- extends / implements / generics
- documentation از leading comments
- exported بودن از `export_statement`

## تنظیمات

مسیر دایرکتوری WASM grammar ها از طریق تنظیم VSCode `semanticEngine.treeSitter.grammarDir` قابل پیکربندی است. پیش‌فرض: `tree-sitter-grammars/` در workspace root.

## `TreeSitterIncrementalParser` — حذف شد (فاز ۱۷، SE-SYM-17)

۱۱۲ خط کامل و بی‌استفاده. تصمیم: **حذف، نه اتصال.** سه دلیل:

۱. مسیر incremental، *ویرایش متنی* ندارد. `FileChangeQueue` رویداد سطح
   فایل می‌دهد (`created/modified/deleted/renamed`)، نه دلتا. برای
   استفاده از `tree.edit()` باید موقعیت دقیق تغییر در دست باشد که
   هیچ‌جای این خط لوله تولید نمی‌شود.
۲. هرگز اجرا نشده و هیچ تستی نداشت. کدی که *کامل به نظر می‌رسد* ولی
   اجرا نشده، از نبودِ کد بدتر است: نفر بعدی فرض می‌کند کار می‌کند.
۳. کش AST با hash محتوا از قبل کار اصلی را می‌کند — فایل تغییرنکرده
   دوباره parse نمی‌شود.

اگر روزی ویرایش‌های متنی واقعی در دسترس بود (مثلاً از
`textDocument/didChange` در بلوک E)، این دوباره نوشته می‌شود — آن‌وقت
با تستی که واقعاً اجرایش می‌کند.
