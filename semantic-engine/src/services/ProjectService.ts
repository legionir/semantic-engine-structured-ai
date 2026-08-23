/**
 * ProjectService — Platform Core V1 & V2 Project Registry & Cache Manager.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ProjectIndex } from '../core/types/project-index.types';
import { ProjectIndexReader } from '../ai/ProjectIndexReader';
import { AiToolRegistry } from '../ai/AiToolRegistry';
import { loadBlueprintBeside } from '../ai/discovery/loadBlueprint';
import { BlueprintIndex } from '../ai/discovery/BlueprintIndex';
import { AnalysisGraph } from './analysis/AnalysisGraph';
import { canonicalIndexPath, normalizeWorkspaceRoot, resolveProjectIndexPath } from '../core/config/ProjectPaths';

const MAX_INDEX_BYTES = 256 * 1024 * 1024;
const MANIFEST_FILE_NAME = 'project-artifacts.manifest.json';

export interface ManagedProject {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly indexPath: string;
  readonly blueprintPath?: string;
  readonly sqlitePath?: string;
  readonly status: 'ready' | 'indexing' | 'stale' | 'missing';
  readonly index?: ProjectIndex;
  readonly blueprint?: BlueprintIndex;
  readonly reader?: ProjectIndexReader;
  readonly registry?: AiToolRegistry;
  readonly stats: {
    readonly filesCount: number;
    readonly symbolsCount: number;
    readonly dependenciesCount: number;
    readonly lastIndexedAt?: string;
  };
}

export class ProjectService {
  private readonly projects = new Map<string, ManagedProject>();
  private readonly artifactWatchers = new Map<string, fs.FSWatcher>();
  private readonly reloadTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly defaultRoot: string = process.cwd()) {}

  /**
   * ثبت یا باز کردن یک پروژه بر اساس مسیر.
   */
  registerProject(projectPath: string, customId?: string, customName?: string): ManagedProject {
    const rootPath = normalizeWorkspaceRoot(projectPath);
    const id = customId || `prj-${path.basename(rootPath).toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
    const name = customName || path.basename(rootPath);

    /* `.semantic-engine` is canonical. `resolveProjectIndexPath` keeps the
       old Structured AI sidecar location readable during migration without
       ever making it the destination for a new index. */
    const canonicalPath = canonicalIndexPath(rootPath);
    const actualIndexPath = resolveProjectIndexPath(rootPath);

    /*
    | SE-PERF-01، یک محدودیتِ شناخته‌شده و نه رفع‌شده.
    |
    | خواندن و parse کردن ایندکس همگام است. اندازه‌گیری روی ۲۷MB:
    | خواندن ۵۰ms، `JSON.parse` ۱۰۰ms. این تابع بعد از هر job ایندکس
    | صدا زده می‌شود، پس ۱۵۰ms قفل event loop آنجا هست.
    |
    | ناهمگام کردنِ خواندن امتحان شد و کنار گذاشته شد: دو سومِ هزینه
    | خودِ `JSON.parse` است که همگام می‌ماند، و پیش‌گرم کردن یعنی
    | فایل دو بار خوانده شود. سودِ ۵۰ms ارزش آن پیچیدگی را ندارد.
    | رفع واقعی یک parser جریانی است، که کار همین‌جا نیست.
    */

    let index: ProjectIndex | undefined;
    let reader: ProjectIndexReader | undefined;
    let blueprint: BlueprintIndex | undefined;
    let registry: AiToolRegistry | undefined;
    let status: ManagedProject['status'] = 'missing';

    let filesCount = 0;
    let symbolsCount = 0;
    let dependenciesCount = 0;
    let lastIndexedAt: string | undefined;

    if (fs.existsSync(actualIndexPath)) {
      try {
        const indexSize = fs.statSync(actualIndexPath).size;
        if (indexSize > MAX_INDEX_BYTES) {
          throw new Error(
            `Project index is ${indexSize} bytes; the ${MAX_INDEX_BYTES}-byte safety limit prevents an event-loop memory spike.`
          );
        }

        const manifestPath = path.join(path.dirname(actualIndexPath), MANIFEST_FILE_NAME);
        const manifest = fs.existsSync(manifestPath)
          ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
              artifacts?: { index?: { sha256?: string }; blueprint?: { path?: string; sha256?: string } | null };
            }
          : null;

        if (manifest?.artifacts?.index?.sha256) {
          const actualHash = crypto.createHash('sha256')
            .update(fs.readFileSync(actualIndexPath))
            .digest('hex');
          if (actualHash !== manifest.artifacts.index.sha256) {
            throw new Error('project-index does not match its committed artifact manifest');
          }
        }

        index = JSON.parse(fs.readFileSync(actualIndexPath, 'utf8')) as ProjectIndex;
        reader = new ProjectIndexReader(index);
        const bpResult = manifest?.artifacts?.blueprint
          ? loadBlueprintBeside(actualIndexPath)
          : { index: undefined };
        if (bpResult.index) {
          blueprint = bpResult.index;
          const blueprintFile = path.join(path.dirname(actualIndexPath), 'blueprint.json');
          const expectedBlueprintHash = manifest?.artifacts?.blueprint?.sha256;
          if (expectedBlueprintHash) {
            const actualBlueprintHash = crypto.createHash('sha256')
              .update(fs.readFileSync(blueprintFile))
              .digest('hex');
            if (actualBlueprintHash !== expectedBlueprintHash) {
              throw new Error('blueprint does not match its committed artifact manifest');
            }
          }
        }

        registry = new AiToolRegistry({
          reader,
          workspaceRoot: rootPath,
          projectHash: index.generatedAt,
          enableCache: true,
          ...(blueprint ? { blueprint } : {}),
        });

        filesCount = index.files ? (Array.isArray(index.files) ? index.files.length : Object.keys(index.files).length) : 0;
        symbolsCount = index.symbols ? index.symbols.length : 0;
        dependenciesCount = index.graphs?.dependencyGraph ? index.graphs.dependencyGraph.length : 0;
        lastIndexedAt = index.generatedAt;
        status = 'ready';
      } catch {
        status = 'stale';
      }
    }

    const sqliteCandidate = path.join(path.dirname(actualIndexPath), 'project-index.sqlite');
    const sqlitePath = fs.existsSync(sqliteCandidate) ? sqliteCandidate : undefined;

    const managed: ManagedProject = {
      id,
      name,
      rootPath,
      /* Always expose the write destination. A legacy index may have been
         read above, but the next UI indexing job must migrate it to the
         canonical directory instead of refreshing `.agent/semantic`. */
      indexPath: canonicalPath,
      blueprintPath: blueprint ? path.join(path.dirname(actualIndexPath), 'blueprint.json') : undefined,
      sqlitePath,
      status,
      index,
      blueprint,
      reader,
      registry,
      stats: {
        filesCount,
        symbolsCount,
        dependenciesCount,
        lastIndexedAt,
      },
    };

    this.projects.set(id, managed);
    this.ensureArtifactWatcher(managed);
    return managed;
  }

  /**
   * همگام‌سازی cache سرویس با خروجی watcher یا هر indexer خارجی.
   * watchِ پروژه فقط artifact directory را نگاه می‌کند تا تغییرات سورس
   * باعث reload بی‌دلیل نشود؛ خود semantic-engine watch بعد از batch
   * موفق project-index و blueprint را atomic می‌نویسد.
   */
  private ensureArtifactWatcher(project: ManagedProject): void {
    if (this.artifactWatchers.has(project.id)) return;

    const directory = path.dirname(project.indexPath);
    if (!fs.existsSync(directory)) return;

    try {
      const watcher = fs.watch(directory, (_event, filename) => {
        const changed = filename ? String(filename) : '';
        if (!changed ||
            changed === path.basename(project.indexPath) ||
            changed === 'blueprint.json' ||
            changed === 'project-artifacts.manifest.json' ||
            changed === 'project-index.sqlite') {
          this.scheduleReload(project.id);
        }
      });
      watcher.on('error', () => {
        this.artifactWatchers.delete(project.id);
      });
      this.artifactWatchers.set(project.id, watcher);
    } catch {
      /* نبودن watcher نباید مانع سرویس‌دهی به index موجود شود. */
    }
  }

  private scheduleReload(id: string): void {
    const previous = this.reloadTimers.get(id);
    if (previous) clearTimeout(previous);

    const timer = setTimeout(() => {
      this.reloadTimers.delete(id);
      this.reloadProject(id);
    }, 100);
    timer.unref?.();
    this.reloadTimers.set(id, timer);
  }

  /** بستن watcherها در shutdown سرور. */
  dispose(): void {
    for (const timer of this.reloadTimers.values()) clearTimeout(timer);
    this.reloadTimers.clear();
    for (const watcher of this.artifactWatchers.values()) watcher.close();
    this.artifactWatchers.clear();
  }

  getProject(id: string): ManagedProject | undefined {
    return this.projects.get(id);
  }

  listProjects(): ManagedProject[] {
    return Array.from(this.projects.values());
  }

  /**
   * بازخوانی ایندکس پروژه پس از تکمیل فرآیند ایندکس‌سازی.
   */
  reloadProject(id: string): ManagedProject | undefined {
    const current = this.projects.get(id);
    if (!current) return undefined;
    return this.registerProject(current.rootPath, current.id, current.name);
  }

  /**
   * تولید گراف تحلیلی پروژه برای Impact Analysis و معماری.
   */
  getProjectGraph(id: string): AnalysisGraph {
    const graph = new AnalysisGraph();
    const project = this.projects.get(id);
    if (!project || !project.index) return graph;

    // Add symbols as nodes
    if (project.index.symbols) {
      for (const s of project.index.symbols) {
        const f = project.reader?.getFileById(s.fileId);
        graph.addNode({
          id: s.id,
          type: s.kind || 'symbol',
          label: s.name,
          metadata: { path: f?.path, line: s.line },
        });
      }
    }

    // Add dependency graph edges
    if (project.index.graphs?.dependencyGraph) {
      for (const [idx, dep] of project.index.graphs.dependencyGraph.entries()) {
        graph.addEdge({
          id: `dep_${idx}`,
          source: dep.from,
          target: dep.to,
          relation: 'depends_on',
          metadata: { confidence: dep.provenance?.confidence },
        });
      }
    }

    // Add call graph edges
    if (project.index.graphs?.callGraph) {
      for (const [idx, cg] of project.index.graphs.callGraph.entries()) {
        graph.addEdge({
          id: `call_${idx}`,
          source: cg.caller,
          target: cg.callee,
          relation: 'calls',
          metadata: { confidence: cg.provenance?.confidence },
        });
      }
    }

    return graph;
  }

  /**
   * اجرای ایندکس پروژه به صورت همگام یا ناهمگام.
   */
  async indexProject(
    id: string,
    _options?: { incremental?: boolean }
  ): Promise<{ filesCount: number; symbolsCount: number; edgesCount: number }> {
    const project = this.projects.get(id);
    if (!project) {
      throw new Error(`Project '${id}' not found`);
    }

    const reloaded = this.reloadProject(id);
    return {
      filesCount: reloaded?.stats.filesCount || 0,
      symbolsCount: reloaded?.stats.symbolsCount || 0,
      edgesCount: reloaded?.stats.dependenciesCount || 0,
    };
  }
}
