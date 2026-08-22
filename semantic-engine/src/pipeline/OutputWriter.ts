/**
 * نوشتن خروجی‌ها — MIG-22 و SE-EXP-02.
 *
 * مسیر قبلی هر خروجی را دو بار می‌نوشت: یک‌بار `project-index.json`
 * بدون `vectorChunks` و بعد دوباره با آن، و همین‌طور SQLite. هر
 * خواننده‌ای که بین این دو نوشتن سر می‌رسید — سرور MCP،
 * `AiToolCommandHandler`، یا فقط یک `cat` — ایندکسی بدون بردار
 * می‌دید و فرض می‌کرد پروژه بردار ندارد.
 *
 * اینجا هر خروجی دقیقاً یک بار و به‌صورت اتمیک نوشته می‌شود.
 */

import * as path from 'path';
import * as crypto from 'crypto';
import { ProjectIndex } from '../core/types/project-index.types';
import { BlueprintExporter } from '../export/BlueprintExporter';
import { validateAgainstSchema } from '../export/schemaValidation';
import { FileSystemPort, NodeFileSystem } from '../host/FileSystem';
import { ILogger, silentLogger } from '../host/Logger';

export interface OutputWriterOptions {
  readonly outputDir: string;
  readonly fileSystem?: FileSystemPort;
  readonly logger?: ILogger;
  readonly pretty?: boolean;
  /**
   * SQLite پیش‌فرض خاموش است: به ماژول native نیاز دارد که ممکن است
   * نصب نباشد. روشن کردنش یک تصمیم صریح است و اگر ماژول نباشد، بلند
   * شکست می‌خورد — نه اینکه بی‌صدا از قلم بیفتد.
   */
  readonly sqlite?: boolean;
  readonly blueprint?: boolean;
  /**
   * سنجیدن ایندکس با `contracts/project-index.schema.json` پیش از
   * نوشتن — SE-EXP-06.
   *
   * پیش‌فرض: روشن، مگر در production. قرارداد و `ajv` از اول موجود
   * بودند ولی هیچ‌وقت در مسیر نوشتن نبودند، پس نقض قرارداد فقط وقتی
   * دیده می‌شد که کسی دستی اسکریپت اعتبارسنجی را اجرا کند.
   */
  readonly validate?: boolean;
  readonly gitCommit?: string;
  readonly driftScore?: number;
}

export interface WrittenArtifacts {
  readonly indexPath: string;
  readonly blueprintPath: string | null;
  readonly sqlitePath: string | null;
}

export const INDEX_FILE_NAME = 'project-index.json';
export const BLUEPRINT_FILE_NAME = 'blueprint.json';
export const SQLITE_FILE_NAME = 'project-index.sqlite';
export const MANIFEST_FILE_NAME = 'project-artifacts.manifest.json';

export class OutputWriter {
  private readonly fs: FileSystemPort;
  private readonly logger: ILogger;

  constructor(private readonly options: OutputWriterOptions) {
    this.fs = options.fileSystem ?? new NodeFileSystem();
    this.logger = options.logger ?? silentLogger;
  }

  get indexPath(): string {
    return path.join(this.options.outputDir, INDEX_FILE_NAME);
  }

  get blueprintPath(): string {
    return path.join(this.options.outputDir, BLUEPRINT_FILE_NAME);
  }

  get sqlitePath(): string {
    return path.join(this.options.outputDir, SQLITE_FILE_NAME);
  }

  async write(index: ProjectIndex): Promise<WrittenArtifacts> {
    /*
    | SE-EXP-06: پیش از هر نوشتنی. یک فایل نامعتبر روی دیسک بدتر از
    | نبودِ فایل است — مصرف‌کننده می‌خواندش و به‌طور نامعلوم شکست
    | می‌خورد، آن هم دور از جایی که خرابی ساخته شد.
    */
    const shouldValidate = this.options.validate ?? process.env['NODE_ENV'] !== 'production';
    if (shouldValidate) {
      const errors = validateAgainstSchema('project-index', index);
      if (errors.length > 0) {
        throw new Error(
          `project-index does not match its schema (${errors.length} violation(s)):\n  ` +
            errors.slice(0, 10).join('\n  ')
        );
      }
      this.logger.debug('index validated against contract');
    }

    await this.fs.mkdirp(this.options.outputDir);
    const pretty = this.options.pretty !== false;

    /*
    | ایندکس *کامل* — با بردارها اگر داشته باشد — یک بار نوشته می‌شود.
    | ترکیب کردنش اینجا اتفاق نمی‌افتد: کار pipeline است که یک مقدار
    | تمام‌شده تحویل بدهد.
    */
    /*
    | SE-DATA-04 — blueprint **پیش از** نوشتنِ ایندکس ساخته می‌شود.
    |
    | `blueprintRef` نگاشتِ فایل به ماژول است و آن نگاشت فقط داخل
    | blueprint وجود دارد. اگر ایندکس اول نوشته شود، این فیلد همیشه
    | خالی می‌ماند — که همان دلیلی است که سال‌ها خالی مانده بود.
    */
    let blueprintPath: string | null = null;
    let indexToWrite = index;

    if (this.options.blueprint !== false) {
      const exporter = new BlueprintExporter();
      const generatorOptions = {
        gitCommit: this.options.gitCommit,
        driftScore: this.options.driftScore,
      };

      const { blueprint, moduleRefs } = exporter.buildWithRefs(index, generatorOptions);
      indexToWrite = {
        ...index,
        files: index.files.map(file => {
          const moduleId = moduleRefs.get(file.id);
          return moduleId ? { ...file, blueprintRef: { moduleId } } : file;
        }),
      };

      await exporter.write(blueprint, { outputPath: this.blueprintPath, pretty });
      blueprintPath = this.blueprintPath;
      this.logger.debug('wrote blueprint', { path: blueprintPath });
    }

    await this.fs.writeJsonAtomic(this.indexPath, indexToWrite, { pretty });
    this.logger.debug('wrote index', {
      path: this.indexPath,
      files: indexToWrite.files.length,
    });

    let sqlitePath: string | null = null;
    if (this.options.sqlite === true) {
      /*
      | require تنبل: بارگذاری ایستا کل ماژول را — و با آن ده ابزار
      | AI را — به یک build بومی گره می‌زد (SE-BUILD-09).
      */
      const { SQLiteExporter } = require('../export/SQLiteExporter');
      await new SQLiteExporter().export(index, { outputPath: this.sqlitePath });
      sqlitePath = this.sqlitePath;
      this.logger.debug('wrote sqlite', { path: sqlitePath });
    }

    const manifest = {
      version: 1,
      generation: crypto.randomUUID(),
      committedAt: new Date().toISOString(),
      artifacts: {
        index: await this.artifactDigest(this.indexPath),
        blueprint: blueprintPath ? await this.artifactDigest(this.blueprintPath) : null,
        sqlite: sqlitePath ? { path: SQLITE_FILE_NAME } : null,
      },
    };
    await this.fs.writeJsonAtomic(
      path.join(this.options.outputDir, MANIFEST_FILE_NAME),
      manifest,
      { pretty }
    );

    return { indexPath: this.indexPath, blueprintPath, sqlitePath };
  }

  private async artifactDigest(filePath: string): Promise<{ path: string; sha256: string; bytes: number }> {
    const content = await this.fs.readFile(filePath);
    return {
      path: path.basename(filePath),
      sha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
      bytes: Buffer.byteLength(content, 'utf8'),
    };
  }
}
