/**
 * اعتبارسنجی خروجی با قرارداد — SE-EXP-06.
 *
 * `ajv` و `contracts/` از اول در مخزن بودند و `scripts/validate-schema.js`
 * هم وجود داشت، ولی هیچ‌کدام در مسیر *نوشتن* نبودند. یعنی هر نقض
 * قرارداد فقط وقتی دیده می‌شد که کسی دستی اسکریپت را اجرا کند — و
 * مصرف‌کنندهٔ خروجی (سرور MCP، ابزارهای AI) هیچ تضمینی نداشت.
 *
 * هزینهٔ کامپایل schema یک‌بار است و بعد به ازای هر ایندکس چند
 * میلی‌ثانیه. کامپایل تنبل است تا وقتی اعتبارسنجی خاموش باشد،
 * `ajv` اصلاً بار نشود.
 */

import * as fs from 'fs';
import * as path from 'path';

export type SchemaName = 'project-index' | 'blueprint';

const SCHEMA_FILES: Readonly<Record<SchemaName, string>> = {
  'project-index': 'project-index.schema.json',
  blueprint: 'blueprint.schema.json',
};

type ValidateFunction = ((data: unknown) => boolean) & {
  errors?: readonly { instancePath?: string; message?: string; params?: unknown }[] | null;
};

const compiled = new Map<SchemaName, ValidateFunction>();

/**
 * محل `contracts/`.
 *
 * `__dirname` هنگام اجرا `dist/export` است و هنگام تست `src/export`؛
 * هر دو دو سطح پایین‌تر از ریشهٔ پکیج‌اند.
 */
export function contractsDir(): string {
  return path.join(__dirname, '..', '..', 'contracts');
}

function compile(schema: SchemaName): ValidateFunction {
  const cached = compiled.get(schema);
  if (cached) return cached;

  /*
  | require تنبل — همان دلیل بارهای native: کسی که اعتبارسنجی نمی‌خواهد،
  | نباید هزینهٔ بارگذاری ajv را بدهد.
  */

  const Ajv = require('ajv/dist/2020');

  const addFormats = require('ajv-formats');

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const file = path.join(contractsDir(), SCHEMA_FILES[schema]);
  const validator = ajv.compile(JSON.parse(fs.readFileSync(file, 'utf8'))) as ValidateFunction;
  compiled.set(schema, validator);
  return validator;
}

/**
 * خطاهای قرارداد، هر کدام با مسیر JSON Pointer. آرایهٔ خالی = معتبر.
 *
 * پیام‌ها عمداً مسیر را اول می‌آورند: روی یک ایندکس با هزاران فایل،
 * «باید عدد باشد» بدون مسیر بی‌فایده است.
 */
export function validateAgainstSchema(schema: SchemaName, data: unknown): string[] {
  const validator = compile(schema);
  if (validator(data)) return [];

  return (validator.errors ?? []).map(error => {
    const where = error.instancePath && error.instancePath.length > 0 ? error.instancePath : '/';
    /*
    | «must NOT have additional properties» بدون نام آن ویژگی عملاً
    | بی‌فایده است — روی یک ایندکس بزرگ باید دستی دنبالش گشت. ajv
    | نامش را در `params` می‌گذارد.
    */
    const params = (error.params ?? {}) as Record<string, unknown>;
    const extra =
      typeof params['additionalProperty'] === 'string'
        ? ` ("${params['additionalProperty']}")`
        : typeof params['allowedValues'] !== 'undefined'
          ? ` (allowed: ${JSON.stringify(params['allowedValues'])})`
          : '';
    return `${where}: ${error.message ?? 'invalid'}${extra}`;
  });
}
