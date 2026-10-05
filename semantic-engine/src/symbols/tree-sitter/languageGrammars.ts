/**
 * languageGrammars — GAP-11 و SE-SYM-16.
 *
 * ## مسئله
 *
 * `TreeSitterSymbolMapper.mapNodeTypeToKind` یک `switch` هاردکدشده روی
 * نام گره‌های گرامرِ **TypeScript** بود، و
 * `TreeSitterParserManager.getGrammarName` هم فقط چهار زبان را
 * می‌شناخت. یعنی هر زبان دیگری — Python، Go، Java، Rust — به مسیرِ
 * heuristic می‌افتاد.
 *
 * اندازه‌گیری روی fixture پیش از این فاز:
 *
 * ```
 * python  ۳ فایل   ۹ نماد   همه heuristic
 * go      ۱ فایل   ۴ نماد   همه heuristic
 * java    ۱ فایل   ۴ نماد   همه heuristic
 * rust    ۱ فایل   ۸ نماد   همه heuristic
 * ```
 *
 * ## نام گره‌ها حدس نیستند
 *
 * هر ردیفِ این جدول‌ها با یک probe روی خودِ گرامرِ wasm بیرون کشیده
 * شد: فایل نمونه پارس شد و انواعِ گرهِ واقعی چاپ شدند. همان درسی که
 * SE-SYM-11 داد — سه ردیفِ حدسیِ گرامر TypeScript اصلاً وجود نداشتند
 * و سه ردیفِ واقعی غایب بودند، و نتیجه‌اش این بود که
 * `abstract class X {}` کاملاً از ایندکس می‌افتاد.
 *
 * ## سطح پشتیبانی صریح است
 *
 * هر زبان یک `support` دارد که در خروجی هم اعلام می‌شود (SE-SYM-16).
 * «چیزی پیدا نشد» و «این زبان را در این سطح نمی‌فهمم» دو چیزِ
 * متفاوت‌اند و مصرف‌کننده باید بتواند تفکیکشان کند.
 */

import { SymbolKind } from '../../core/types/project-index.types';

export type GrammarSupport = 'full' | 'structural';

export interface LanguageGrammar {
  /** نام فایل wasm، بدون پیشوند `tree-sitter-` و پسوند. */
  readonly grammar: string;
  /**
   * سطح پشتیبانی.
   *
   * - `full` — نماد، امضا، پارامتر، پیچیدگی و گراف فراخوانی.
   * - `structural` — نماد و ساختار؛ گراف فراخوانی ندارد (SE-GRAPH-08).
   */
  readonly support: GrammarSupport;
  /** نوعِ گرهِ AST → نوعِ symbol. */
  readonly kinds: Readonly<Record<string, SymbolKind>>;
  /**
   * گره‌هایی که اعضایشان به نمادِ **دیگری** تعلق دارد.
   *
   * کلید نوعِ گره است و مقدار، نامِ فیلدی که مالک را می‌گوید.
   * `impl UserService { … }` در Rust خودش نمادی نیست ولی متدهای
   * داخلش متعلق به `UserService`اند؛ بدون این، هر متدِ Rust به‌عنوان
   * تابعِ سطحِ فایل ثبت می‌شد.
   */
  readonly attachesTo?: Readonly<Record<string, string>>;
  /**
   * گره‌هایی که نوعشان از **فرزندشان** خوانده می‌شود.
   *
   * در Go هم `type X struct{}` و هم `type X interface{}` یک
   * `type_spec` هستند و نوعِ واقعی در فرزند است؛ نگاشتِ ثابت هر
   * interfaceی را struct می‌کرد.
   */
  readonly kindFromChild?: Readonly<Record<string, Readonly<Record<string, SymbolKind>>>>;
  /**
   * آیا تابعِ داخلِ یک container، متد حساب شود.
   *
   * Python و Rust برای تابع و متد یک گره دارند، پس تفکیک باید از
   * روی جایگاه بیاید. نسخهٔ اول این را نداشت و متدهای Python
   | `function` می‌شدند — یک پس‌رفت نسبت به مسیر heuristic که درست
   * `method` می‌داد.
   */
  readonly functionsInContainersAreMethods?: boolean;
  /*
  | SE-SYM-20 — پارامتر، نوعِ بازگشتی و پدر/اینترفیس هم گرامر-محور می‌شوند.
  |
  | تا این فاز، `TreeSitterSymbolMapper` فقط نام‌هایِ گرامرِ TypeScript را
  | می‌شناخت: `formal_parameters`، `type_annotation`، `class_heritage`،
  | `extends_type_clause`. یعنی برای هر زبانِ دیگر `parameters`،
  | `returnType`، `extends` و `implements` **خالی** می‌ماند — همان
  | خانوادۀ «کم‌گزارشِ بی‌صدا» که در SE-GRAPH-14 دیدیم، ولی این‌بار در
  | TypeGraph و امضا. اندازه‌گیری: `class A(B, C)` در پایتون صفر والد،
  | `public class A extends B implements C` در جاوا صفر (با اینکه
  | پارامترهایش می‌آمد، چون جاوا هم تصادفاً `formal_parameters` دارد).
  |
  | نام‌هایِ این فیلدها حدس نیستند: هر کدام از probe روی همان wasm که در
  | زمانِ ایندکس بار می‌شود آمده (audit/phase_reports/C1-grammar-shape.txt).
  */
  /** گره‌های لیستِ پارامتر. پیش‌فرض `['formal_parameters']` (TS/JS/Java/PHP). */
  readonly paramListNodeTypes?: readonly string[];
  /** فیلدی که نوع بازگشتی را می‌دهد (python/rust/go/php). */
  readonly returnTypeField?: string;
  /**
   * گره‌های نوعی که به‌عنوانِ فرزندِ هم‌سطح می‌نشینند و نوعِ بازگشتی‌اند.
   *
   | C# فیلدِ `type` ندارد: `public bool M(...)` نوع را در گرهٔ
   | `predefined_type` هم‌سطحِ نام می‌گذارد.
   */
  readonly returnTypeChildTypes?: readonly string[];
  /** فیلدهایی که والد(ها) را می‌دهند (جاوا `superclass`، روبی `superclass`). */
  readonly extendsFields?: readonly string[];
  /** فیلدهایی که اینترفیس(ها) را می‌دهند (جاوا `interfaces`). */
  readonly implementsFields?: readonly string[];
  /** گره‌های هم‌سطح که والد(ها) داخلشان است (TS heritage، پایتون bases، C# base list، PHP base clause). */
  readonly extendsChildTypes?: readonly string[];
  /** گره‌های هم‌سطح که اینترفیس(ها) داخلشان است (TS implements، PHP interface clause). */
  readonly implementsChildTypes?: readonly string[];
}

/**
 * پیش‌فرض‌های مشترک، تا هر زبان مجبور نباشد تکرارشان کند.
 */
export const DEFAULT_NAME_NODES: readonly string[] = [
  'identifier',
  'type_identifier',
  'property_identifier',
  'private_property_identifier',
  'array_pattern',
  'object_pattern',
];

const TS_KINDS: Readonly<Record<string, SymbolKind>> = {
  // TypeScript برای کلاس abstract گرهٔ جداگانه می‌سازد. نبودنش در
  // این جدول یعنی *کل کلاس* گم می‌شد، نه فقط پرچم abstract.
  class_declaration: 'class',
  abstract_class_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'enum',
  // عضو enum، با مقدار (`Red = "red"`) یا بدون آن (`Up`)
  enum_assignment: 'constant',
  // `function_signature` امضای overload است — بدنه ندارد ولی بخشی
  // از API عمومی است.
  function_declaration: 'function',
  generator_function_declaration: 'function',
  function_signature: 'function',
  method_definition: 'method',
  method_signature: 'method',
  abstract_method_signature: 'method',
  constructor_definition: 'method',
  type_alias_declaration: 'type-alias',
  // `namespace X {}` در گرامر TS همین است، نه `namespace_declaration`
  internal_module: 'namespace',
  // `declare module "x" {}`
  module: 'module',
  public_field_definition: 'property',
  field_definition: 'property',
};

/*
| نام گره‌ها از probe روی گرامرِ واقعی:
|
|   python  class_definition, function_definition
|   go      type_declaration, type_spec, struct_type, method_declaration,
|           function_declaration, field_declaration
|   java    class_declaration, interface_declaration, method_declaration,
|           field_declaration
|   rust    struct_item, impl_item, function_item, trait_item,
|           function_signature_item, field_declaration
*/
const PYTHON_KINDS: Readonly<Record<string, SymbolKind>> = {
  class_definition: 'class',
  // Python بین تابع و متد در گرامر فرقی نمی‌گذارد؛ تفکیکشان از روی
  // والد انجام می‌شود، نه از روی نوعِ گره.
  function_definition: 'function',
  decorated_definition: 'decorator',
};

const GO_KINDS: Readonly<Record<string, SymbolKind>> = {
  // `type X struct {}` یک `type_declaration` است که یک `type_spec`
  // دارد؛ نامِ نوع روی `type_spec` است، نه روی declaration.
  type_spec: 'struct',
  function_declaration: 'function',
  method_declaration: 'method',
  field_declaration: 'property',
  const_spec: 'constant',
  var_spec: 'variable',
};

const JAVA_KINDS: Readonly<Record<string, SymbolKind>> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'enum',
  record_declaration: 'struct',
  annotation_type_declaration: 'decorator',
  method_declaration: 'method',
  constructor_declaration: 'method',
  field_declaration: 'property',
};

const RUST_KINDS: Readonly<Record<string, SymbolKind>> = {
  struct_item: 'struct',
  enum_item: 'enum',
  trait_item: 'trait',
  union_item: 'struct',
  type_item: 'type-alias',
  mod_item: 'module',
  function_item: 'function',
  // امضای بدونِ بدنه داخل `trait` — بخشی از قرارداد عمومی است.
  function_signature_item: 'method',
  const_item: 'constant',
  static_item: 'constant',
  field_declaration: 'property',
};

/*
| C#، PHP و Ruby از فیلدِ `name`ِ خودِ گرامر استفاده می‌کنند (extractName
| اول `childForFieldName('name')` را می‌پرسد)، پس نام‌ها درست درمی‌آیند.
| C++ نام را زیر `declarator` می‌گذارد (نه فیلد `name`) و لذا با این
| mapper تابع/فیلدهایش را از دست می‌دهد؛ عمداً روی heuristic مانده تا
| completeness نسبت به heuristic افت نکند. Kotlin/Swift گرامرِ سازگار با
| ABIِ این web-tree-sitter ندارند.
*/
const CSHARP_KINDS: Readonly<Record<string, SymbolKind>> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  struct_declaration: 'struct',
  enum_declaration: 'enum',
  record_declaration: 'struct',
  method_declaration: 'method',
  constructor_declaration: 'method',
  property_declaration: 'property',
  field_declaration: 'property',
  enum_member_declaration: 'constant',
  namespace_declaration: 'namespace',
};

const PHP_KINDS: Readonly<Record<string, SymbolKind>> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  trait_declaration: 'trait',
  enum_declaration: 'enum',
  method_declaration: 'method',
  function_definition: 'function',
  enum_case: 'constant',
};

const RUBY_KINDS: Readonly<Record<string, SymbolKind>> = {
  module: 'module',
  class: 'class',
  method: 'method',
  singleton_method: 'method',
};

export const LANGUAGE_GRAMMARS: Readonly<Record<string, LanguageGrammar>> = Object.freeze({
  typescript: { grammar: 'typescript', support: 'full', kinds: TS_KINDS },
  javascript: { grammar: 'javascript', support: 'full', kinds: TS_KINDS },
  typescriptreact: { grammar: 'tsx', support: 'full', kinds: TS_KINDS },
  javascriptreact: { grammar: 'javascript', support: 'full', kinds: TS_KINDS },

  /*
  | چهار زبانِ تازه در سطح `structural`اند: نماد و ساختار می‌دهند،
  | ولی گراف فراخوانی ندارند. `CallGraphBuilder` با `isTsJs` بقیه را
  | رد می‌کند و این محدودیت تا امروز هیچ‌جا اعلام نمی‌شد
  | (SE-GRAPH-08). حالا اعلام می‌شود.
  */
  python: {
    grammar: 'python',
    support: 'structural',
    kinds: PYTHON_KINDS,
    functionsInContainersAreMethods: true,
    paramListNodeTypes: ['parameters'],
    returnTypeField: 'return_type',
    // `class A(B, C):` پدرها را در `argument_list` می‌گذارد (فیلد ندارد)
    extendsChildTypes: ['argument_list'],
  },
  go: {
    grammar: 'go',
    support: 'structural',
    kinds: GO_KINDS,
    kindFromChild: {
      type_spec: { struct_type: 'struct', interface_type: 'interface' },
    },
    paramListNodeTypes: ['parameter_list'],
    // `(int, error)` در فیلد `result` است، نه کنارِ نام
    returnTypeField: 'result',
    // embedding در struct گرامر-محور نامش `field_declaration` است (بدونِ نامِ صریح)؛
    // حدس‌زدنِ والد از آن انجام نمی‌شود — ادعایِ دروغ بهتر از سکوت نیست.
  },
  java: {
    grammar: 'java',
    support: 'structural',
    kinds: JAVA_KINDS,
    // پارامتر جاوا همان `formal_parameters` است؛ نوعِ بازگشتی در فیلد `type`
    paramListNodeTypes: ['formal_parameters'],
    returnTypeField: 'type',
    extendsFields: ['superclass'],
    implementsFields: ['interfaces'],
  },
  rust: {
    grammar: 'rust',
    support: 'structural',
    kinds: RUST_KINDS,
    attachesTo: { impl_item: 'type' },
    functionsInContainersAreMethods: true,
    paramListNodeTypes: ['parameters'],
    returnTypeField: 'return_type',
    // `impl T for S` رابطه را بینِ دو گره می‌گذارد و مالکیتِ سمبلِ S از
    // `attachesTo` حل می‌شود؛ یالِ implements نیازمندِ کارِ جداست و اینجا
    // ساخته نمی‌شود (تا ادعایِ نیامده، یالِ نادرست).
  },

  csharp: {
    grammar: 'c-sharp',
    support: 'structural',
    kinds: CSHARP_KINDS,
    paramListNodeTypes: ['parameter_list'],
    // فیلدِ نوعِ بازگشتی ندارد؛ نوع گرهٔ هم‌سطح است
    returnTypeChildTypes: [
      'predefined_type', 'identifier', 'generic_name', 'array_type',
      'nullable_type', 'qualified_identifier', 'implicit_type', 'pointer_type',
    ],
    // `class A : B, IC` — خودِ گرامر کلاس و اینترفیس را تفکیک نمی‌کند،
    // پس همه در extends می‌نشینند؛ حدس‌زدنِ `I`-prefix یعنی ساختنِ یالِ اشتباه.
    extendsChildTypes: ['base_list'],
  },
  php: {
    grammar: 'php',
    support: 'structural',
    kinds: PHP_KINDS,
    paramListNodeTypes: ['formal_parameters'],
    returnTypeField: 'return_type',
    extendsChildTypes: ['base_clause'],
    implementsChildTypes: ['class_interface_clause'],
  },
  ruby: {
    grammar: 'ruby',
    support: 'structural',
    kinds: RUBY_KINDS,
    functionsInContainersAreMethods: true,
    paramListNodeTypes: ['method_parameters'],
    // روبی type annotation ندارد؛ پس returnType عمداً نمی‌خوانده می‌شود
    extendsFields: ['superclass'],
  },
});

/** زبان‌هایی که tree-sitter برایشان گرامر دارد. */
export function grammarFor(languageId: string): LanguageGrammar | null {
  return LANGUAGE_GRAMMARS[languageId] ?? null;
}

/** سطح پشتیبانی، برای اعلام در خروجی — SE-SYM-16. */
export function supportLevelFor(languageId: string): GrammarSupport | 'heuristic' {
  return LANGUAGE_GRAMMARS[languageId]?.support ?? 'heuristic';
}
