/**
 * JobRoutes — Async indexing jobs & SSE events endpoints.
 *
 * SE-UI-06: بدنهٔ درخواستِ `POST …/index` حالا گزینه‌های اسکن و
 * embedding را از UI می‌پذیرد: حالت اسکن (tree-sitter/heuristic)،
 * رعایت .gitignore، عمق، خروجی‌ها (blueprint) و پیکربندی
 * بردار (provider + مدل embedding یا مدل پیش‌فرض).
 */

import { RouteDefinition } from '../types';
import { ProjectService } from '../../services/ProjectService';
import { JobManager } from '../../runtime/JobManager';
import { SseManager } from '../SseManager';
import { createExtractors } from '../../pipeline/ExtractorFactory';
import { IndexPipeline } from '../../pipeline/IndexPipeline';
import { OutputWriter, INDEX_FILE_NAME } from '../../pipeline/OutputWriter';
import { VectorIndexer } from '../../vector/VectorIndexer';
import { IEmbeddingGenerator } from '../../vector/EmbeddingGenerator';
import { RemoteEmbeddingGenerator } from '../../vector/RemoteEmbeddingGenerator';
import { HashingEmbeddingGenerator } from '../../vector/HashingEmbeddingGenerator';
import { ScannerConfig } from '../../core/config/ScannerConfig';
import { VectorChunk } from '../../core/types/project-index.types';
import * as path from 'path';

interface IndexRequestBody {
  scan?: {
    treeSitter?: boolean;
    useGitignore?: boolean;
    maxDepth?: number;
    maxFileSizeMb?: number;
    additionalIgnorePatterns?: string[];
    skipHiddenDirectories?: boolean;
  };
  output?: {
    blueprint?: boolean;
  };
  embedding?: {
    enabled?: boolean;
    provider?: 'local' | 'ollama' | 'openai-compatible';
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    useDefaultModel?: boolean;
    normalize?: boolean;
  };
}

function buildEmbeddingGenerator(
  cfg: NonNullable<IndexRequestBody['embedding']>
): IEmbeddingGenerator | null {
  if (!cfg.enabled) return null;

  const provider = cfg.provider ?? 'local';

  if (provider === 'local') {
    /*
    | The production-safe local provider is deterministic hashing. The
    | transformer/native stack is intentionally not bundled because its
    | transitive audit contained critical/high vulnerabilities and its
    | model download is not suitable for an unisolated HTTP worker.
    */
    return new HashingEmbeddingGenerator();
  }

  if (!cfg.baseUrl) {
    throw new Error(`embedding provider "${provider}" needs a baseUrl`);
  }
  if (!cfg.model && !cfg.useDefaultModel) {
    throw new Error(`embedding provider "${provider}" needs a model`);
  }

  return new RemoteEmbeddingGenerator({
    provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model || '',
    ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
    normalize: cfg.normalize ?? true,
  });
}


type IndexJobData = {
  readonly scan?: IndexRequestBody['scan'];
  readonly output?: IndexRequestBody['output'];
  readonly embedding?: IndexRequestBody['embedding'];
};

function createIndexRunner(
  project: { id: string; rootPath: string; indexPath: string; index?: { vectorChunks?: readonly VectorChunk[] } },
  data: IndexJobData,
  embeddingGenerator: IEmbeddingGenerator | null,
  reloadProject: (id: string) => unknown
): (
  token: import('../../host/Cancellation').CancellationToken,
  updateProgress: (phase: string, progress: number, data?: unknown) => void
) => Promise<unknown> {
  const scan = data.scan ?? {};
  const output = data.output ?? {};
  const treeSitter = scan.treeSitter !== false;
  const scannerConfig: Partial<ScannerConfig> = {
    ...(scan.useGitignore !== undefined ? { useGitignore: scan.useGitignore } : {}),
    ...(typeof scan.maxDepth === 'number' ? { maxDepth: scan.maxDepth } : {}),
    ...(typeof scan.maxFileSizeMb === 'number'
      ? { maxFileSizeBytes: Math.round(scan.maxFileSizeMb * 1024 * 1024) }
      : {}),
    ...(Array.isArray(scan.additionalIgnorePatterns)
      ? { additionalIgnorePatterns: scan.additionalIgnorePatterns }
      : {}),
    ...(scan.skipHiddenDirectories !== undefined
      ? { skipHiddenDirectories: scan.skipHiddenDirectories }
      : {}),
  };
  const wantBlueprint = output.blueprint !== false;

  return async (token, updateProgress) => {
    updateProgress('scanning', 10);
    const extractors = createExtractors({ workspaceRoot: project.rootPath, treeSitter });
    const outputDir = path.dirname(project.indexPath);
    const vectorIndexer = embeddingGenerator ? new VectorIndexer({ embeddingGenerator }) : null;
    const pipeline = new IndexPipeline({
      workspaceRoot: project.rootPath,
      outputPath: path.join(outputDir, INDEX_FILE_NAME),
      symbolExtractors: extractors.symbols,
      dependencyExtractors: extractors.dependencies,
      ...(Object.keys(scannerConfig).length > 0 ? { scannerConfig } : {}),
      ...(vectorIndexer ? { vectorIndexer } : {}),
      ...(project.index?.vectorChunks ? { previousVectorChunks: project.index.vectorChunks } : {}),
      token,
    });
    updateProgress('symbols', 40);
    const { projectIndex, stats } = await pipeline.run();
    updateProgress('graphs', 70);
    const writer = new OutputWriter({ outputDir, blueprint: wantBlueprint });
    updateProgress('finalizing', 90);
    await writer.write(projectIndex);
    reloadProject(project.id);
    return {
      files: stats?.files ?? 0,
      symbols: stats?.symbols ?? 0,
      vectorChunks: stats?.vectorChunks ?? 0,
      embeddingModel: embeddingGenerator?.modelName ?? null,
      treeSitter,
    };
  };
}

export function createJobRoutes(
  projectService: ProjectService,
  jobManager: JobManager,
  sseManager: SseManager
): RouteDefinition[] {

  jobManager.registerRecovery('index', async interrupted => {
    const project = projectService.getProject(interrupted.projectId);
    if (!project) throw new Error(`Project '${interrupted.projectId}' is no longer registered.`);
    const jobData = (interrupted.data && typeof interrupted.data === 'object')
      ? interrupted.data as IndexJobData
      : {};
    const embedding = jobData.embedding ?? {};
    let embeddingGenerator: IEmbeddingGenerator | null = null;
    if (embedding.enabled) embeddingGenerator = buildEmbeddingGenerator(embedding);
    jobManager.startJob(
      project.id,
      'index',
      createIndexRunner(project, jobData, embeddingGenerator, id => projectService.reloadProject(id)),
      jobData
    );
  });

  return [
    {
      method: 'POST',
      pattern: '/api/v1/projects/:id/index',
      permission: 'semantic:index',
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }

        const body = (ctx.body || {}) as IndexRequestBody;
        const scan = body.scan ?? {};
        const output = body.output ?? {};
        const embedding = body.embedding ?? {};

        // ساخت generator را پیش از شروع job انجام بده تا خطای پیکربندی
        // بلافاصله (400) برگردد نه به‌صورت job.failed.
        let embeddingGenerator: IEmbeddingGenerator | null = null;
        try {
          embeddingGenerator = buildEmbeddingGenerator(embedding);
        } catch (error) {
          return { status: 400, json: { error: error instanceof Error ? error.message : String(error) } };
        }

        const treeSitter = scan.treeSitter !== false;
        const wantBlueprint = output.blueprint !== false;

        const jobData: IndexJobData = { scan, output, embedding };
        let job;
        try {
          job = jobManager.startJob(
            project.id,
            'index',
            createIndexRunner(project, jobData, embeddingGenerator, id => projectService.reloadProject(id)),
            jobData
          );
        } catch (error) {
          const failure = error as Error & { status?: number };
          return {
            status: failure.status || 503,
            json: { error: failure.message || 'Unable to start indexing job' },
          };
        }

        return {
          status: 202,
          json: {
            jobId: job.id,
            projectId: project.id,
            status: job.status,
            phase: job.phase,
            progress: job.progress,
            options: {
              treeSitter,
              useGitignore: scan.useGitignore !== false,
              blueprint: wantBlueprint,
              embedding: embedding.enabled
                ? {
                    provider: embedding.provider ?? 'local',
                    model: embeddingGenerator?.modelName ?? null,
                  }
                : null,
            },
          },
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/jobs/:jobId',
      permission: 'semantic:query',
      handler: async ctx => {
        const job = jobManager.getJob(ctx.params.jobId);
        if (!job || job.projectId !== ctx.params.id) {
          return { status: 404, json: { error: `Job not found: ${ctx.params.jobId}` } };
        }

        return {
          status: 200,
          json: {
            jobId: job.id,
            projectId: job.projectId,
            type: job.type,
            status: job.status,
            phase: job.phase,
            progress: job.progress,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            error: job.error,
            result: job.result,
          },
        };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/projects/:id/jobs/:jobId/cancel',
      permission: 'semantic:index',
      handler: async ctx => {
        const cancelled = jobManager.cancelJob(ctx.params.jobId);
        return {
          status: 200,
          json: {
            jobId: ctx.params.jobId,
            cancelled,
          },
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/events',
      permission: 'semantic:query',
      handler: async ctx => {
        sseManager.addClient(ctx.params.id, ctx.req, ctx.res);
      },
    },
  ];
}
