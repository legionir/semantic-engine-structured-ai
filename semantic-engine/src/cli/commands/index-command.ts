/**
 * `semantic-engine index` — MIG-51.
 *
 * همان کاری که `scripts/run-pipeline.js` می‌کرد، ولی به‌عنوان یک
 * دستور واقعی: با پرچم، با کد خروج، و با خروجی ماشین‌خوان.
 */

import * as fs from 'fs';
import * as path from 'path';
import { IndexPipeline } from '../../pipeline/IndexPipeline';
import { createExtractors } from '../../pipeline/ExtractorFactory';
import { OutputWriter, INDEX_FILE_NAME } from '../../pipeline/OutputWriter';
import { GitInfoCollector } from '../../core/git';
import { VectorIndexer } from '../../vector/VectorIndexer';
import { HashingEmbeddingGenerator } from '../../vector/HashingEmbeddingGenerator';
import { ProjectIndex } from '../../core/types/project-index.types';
import { EXIT, ParsedArgs, boolOption, stringOption } from '../args';
import { CommandContext, CommandResult } from './types';
import { normalizeWorkspaceRoot, PROJECT_OUTPUT_DIR } from '../../core/config/ProjectPaths';
import { migrateLegacyArtifacts } from '../../core/config/migrateLegacyArtifacts';
import { projectPathsFromArgs } from '../projectPathsFromArgs';

export const DEFAULT_OUTPUT_DIR = PROJECT_OUTPUT_DIR;

export async function runIndex(args: ParsedArgs, context: CommandContext): Promise<CommandResult> {
  const root = normalizeWorkspaceRoot(stringOption(args.options, 'root') ?? context.cwd);


  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return {
      code: EXIT.failure,
      error: `--root does not exist or is not a directory: ${root}`,
    };
  }

  /*
  | مسیر artifact فقط از `resolveProjectPaths` می‌آید. `--out` صریح همان معنای
  | قبلی را دارد (`path.resolve(root, out)`)، پس یک `--out` مطلق امروز و فردا
  | یک کار می‌کند؛ فقط پیش‌فرض است که با
  | `SEMANTIC_ENGINE_ARTIFACT_LOCATION=external` به data directory می‌رود.
  */
  const projectPaths = projectPathsFromArgs(args, root);
  const outputDir = projectPaths.artifactRoot;

  /*
  | پیش از هر خواندن/نوشتن: اگر artifact قدیمی داخل root باشد و مقصد بیرون،
  | یک بار کپی می‌شود (بدون حذف legacy). در حالت `in-root` این فراخوانی عمداً
  | هیچ کاری نمی‌کند.
  */
  const migration = migrateLegacyArtifacts({
    workspaceRoot: root,
    projectId: projectPaths.projectId,
    location: projectPaths.location,
    dataRoot: projectPaths.dataRoot,
  });

  const wantsSqlite = boolOption(
    args.options,
    'sqlite',
    fs.existsSync(path.join(outputDir, 'project-index.sqlite'))
  );
  const wantsBlueprint = boolOption(args.options, 'blueprint', true);
  const wantsGit = boolOption(args.options, 'git', true);
  /*
  | SE-VEC-02 — تا فاز ۴۴ اینجا `vectorIndexer: null` هاردکد بود و
  | هیچ پرچمی هم نداشت، پس `vectorChunks` هرگز تولید نمی‌شد و
  | «جست‌وجوی معنایی» در عمل همیشه کلیدواژه‌ای بود. حالا با
  | `--vectors` روشن می‌شود.
  |
  | پیش‌فرض خاموش است چون هزینهٔ زمان و اندازهٔ فایل دارد، نه چون
  | کار نمی‌کند. اگر ایندکس قبلی vector داشته باشد، آن حالت به‌طور
  | خودکار حفظ می‌شود تا یک index/SQLite refresh معمولی vectorها را
  | ناخواسته حذف نکند؛ `--no-vectors` برای خاموش‌کردن صریح است.
  */
  const existingIndexPath = path.join(outputDir, INDEX_FILE_NAME);
  let previousIndex: ProjectIndex | null = null;
  if (fs.existsSync(existingIndexPath)) {
    try {
      previousIndex = JSON.parse(fs.readFileSync(existingIndexPath, 'utf8')) as ProjectIndex;
    } catch {
      previousIndex = null;
    }
  }
  const wantsVectors = boolOption(
    args.options,
    'vectors',
    Boolean(previousIndex?.vectorChunks)
  );
  const pretty = boolOption(args.options, 'pretty', true);

  const extractors = createExtractors({
    workspaceRoot: root,
    treeSitter: boolOption(args.options, 'treeSitter', true),
    logger: context.logger,
  });

  try {
    const { projectIndex, stats } = await new IndexPipeline({
      workspaceRoot: root,
      outputPath: path.join(outputDir, INDEX_FILE_NAME),
      symbolExtractors: extractors.symbols,
      dependencyExtractors: extractors.dependencies,
      logger: context.logger,
      /*
      | git به‌طور پیش‌فرض روشن است چون یک ایندکس بدون تاریخچه، نصف
      | سیگنال‌های رتبه‌بندی را ندارد. `--no-git` برای مخزنی که git
      | نیست، یا برای خروجی قطعی.
      */
      gitCollector: wantsGit ? new GitInfoCollector(root) : null,
      vectorIndexer: wantsVectors
        ? new VectorIndexer({ embeddingGenerator: new HashingEmbeddingGenerator() })
        : null,
      ...(previousIndex?.vectorChunks
        ? { previousVectorChunks: previousIndex.vectorChunks }
        : {}),
      pretty,
    }).run();

    const written = await new OutputWriter({
      outputDir,
      logger: context.logger,
      pretty,
      blueprint: wantsBlueprint,
      sqlite: wantsSqlite,
      ...(projectIndex.git?.commit ? { gitCommit: projectIndex.git.commit } : {}),
    }).write(projectIndex);

    return {
      code: EXIT.ok,
      json: {
        ok: true,
        root,
        files: stats.files,
        symbols: stats.symbols,
        durationMs: stats.durationMs,
        indexPath: written.indexPath,
        blueprintPath: written.blueprintPath,
        sqlitePath: written.sqlitePath,
        artifactRoot: outputDir,
        artifactLocation: projectPaths.location,
        ...(migration.migrated
          ? { migratedFrom: migration.from, migrationMode: 'copy-readonly-legacy' }
          : {}),
      },
      text:
        `indexed ${stats.files} files, ${stats.symbols} symbols in ${stats.durationMs}ms\n` +
        `  ${written.indexPath}` +
        (written.blueprintPath ? `\n  ${written.blueprintPath}` : '') +
        (written.sqlitePath ? `\n  ${written.sqlitePath}` : ''),
    };
  } finally {
    extractors.dispose();
  }
}
