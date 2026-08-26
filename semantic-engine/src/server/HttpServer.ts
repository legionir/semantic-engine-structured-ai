/**
 * HttpServer — Platform Core V1 Main Modular HTTP Server.
 */

import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { RouteDefinition, HttpRequestContext, PlatformConfig } from './types';
import { AuthContext, PermissionScope, ROLE_DEFAULT_PERMISSIONS } from '../security/rbac/types';
import { PermissionChecker } from '../security/rbac/PermissionChecker';
import { SecurityPipeline } from './SecurityPipeline';
import { SseManager } from './SseManager';
import { WebSocketManager } from './WebSocketManager';
import { JobManager } from '../runtime/JobManager';
import { InMemoryQueueAdapter } from '../runtime/queue/InMemoryQueueAdapter';
import { IndexingWorker } from '../runtime/workers/IndexingWorker';
import { ApiKeyStore } from '../security/rbac/ApiKeyStore';
import { AuditLogger } from '../security/audit/AuditLogger';
import { MetricsCollector } from '../observability/MetricsCollector';
import { OpenTelemetryTracer } from '../observability/OpenTelemetryTracer';
import { ProjectService } from '../services/ProjectService';
import { ProjectRegistry } from '../core/config/ProjectRegistry';
import { SearchService } from '../services/SearchService';
import { CodeIntelligenceService } from '../services/CodeIntelligenceService';
import { ContextService } from '../services/ContextService';
import { LodService } from '../services/visualization/LodService';
import { SourceSyncService } from '../services/source/SourceSyncService';
import { ImpactAnalysisEngine } from '../services/analysis/ImpactAnalysisEngine';
import { ArchitectureRuleEngine } from '../services/analysis/ArchitectureRuleEngine';
import { MutationSimulator } from '../services/analysis/MutationSimulator';
import { GitHistoryMiner } from '../services/history/GitHistoryMiner';
import { RerankerService } from '../services/context/RerankerService';
import { ContextCompressor } from '../services/context/ContextCompressor';
import { EmbeddingProviderService } from '../services/providers/EmbeddingProviderService';
import { ProjectChatService } from '../services/chat/ProjectChatService';

import { createSystemRoutes } from './routes/systemRoutes';
import { createConfigRoutes } from './routes/configRoutes';
import { createProjectRoutes } from './routes/projectRoutes';
import { createJobRoutes } from './routes/jobRoutes';
import { createSearchRoutes } from './routes/searchRoutes';
import { createCodeRoutes } from './routes/codeRoutes';
import { createVisualizationRoutes } from './routes/visualizationRoutes';
import { createAuthRoutes } from './routes/authRoutes';
import { createSourceRoutes } from './routes/sourceRoutes';
import { createAnalysisRoutes } from './routes/analysisRoutes';
import { createHistoryRoutes } from './routes/historyRoutes';
import { createProviderRoutes } from './routes/providerRoutes';
import { createFsRoutes } from './routes/fsRoutes';
import { createChatRoutes, LlmConfigStore } from './routes/chatRoutes';

export class HttpServer {
  private server?: http.Server;
  private readonly routes: RouteDefinition[] = [];
  readonly security: SecurityPipeline;
  readonly sse: SseManager;
  readonly ws: WebSocketManager;
  readonly apiKeyStore: ApiKeyStore;
  readonly auditLogger: AuditLogger;
  readonly metricsCollector: MetricsCollector;
  readonly tracer: OpenTelemetryTracer;
  readonly jobQueue: InMemoryQueueAdapter;
  readonly indexingWorker: IndexingWorker;
  readonly jobs: JobManager;
  readonly projects: ProjectService;
  readonly searchService: SearchService;
  readonly codeService: CodeIntelligenceService;
  readonly contextService: ContextService;
  readonly lodService: LodService;
  readonly sourceSyncService: SourceSyncService;
  readonly impactEngine: ImpactAnalysisEngine;
  readonly archEngine: ArchitectureRuleEngine;
  readonly mutationSimulator: MutationSimulator;
  readonly historyMiner: GitHistoryMiner;
  readonly rerankerService: RerankerService;
  readonly contextCompressor: ContextCompressor;
  readonly embeddingProviders: EmbeddingProviderService;
  readonly chatService: ProjectChatService;
  readonly llmConfig: LlmConfigStore;

  constructor(private readonly config: PlatformConfig) {
    this.security = new SecurityPipeline(config);
    this.sse = new SseManager();
    this.ws = new WebSocketManager();
    this.apiKeyStore = new ApiKeyStore(config.token);
    this.auditLogger = new AuditLogger();
    this.metricsCollector = new MetricsCollector();
    this.tracer = new OpenTelemetryTracer();
    this.jobQueue = new InMemoryQueueAdapter();
    this.jobs = new JobManager(
      this.sse,
      config.projectsRoot ? path.join(config.projectsRoot, '.agent', 'jobs.json') : undefined
    );
    this.projects = new ProjectService(
      config.projectsRoot,
      config.dataRoot ? { registry: new ProjectRegistry({ dataRoot: config.dataRoot }) } : {}
    );
    this.indexingWorker = new IndexingWorker(this.jobQueue, this.projects);
    this.searchService = new SearchService();
    this.codeService = new CodeIntelligenceService();
    this.contextService = new ContextService();
    this.lodService = new LodService();
    this.sourceSyncService = new SourceSyncService();
    this.impactEngine = new ImpactAnalysisEngine();
    this.archEngine = new ArchitectureRuleEngine();
    this.mutationSimulator = new MutationSimulator();
    this.historyMiner = new GitHistoryMiner();
    this.rerankerService = new RerankerService();
    this.contextCompressor = new ContextCompressor();
    this.embeddingProviders = new EmbeddingProviderService();
    this.chatService = new ProjectChatService();
    this.llmConfig = new LlmConfigStore();

    this.registerAllRoutes();
  }

  private readiness(): { ready: boolean; checks: Record<string, boolean> } {
    const checks = {
      process: true,
      projectsRoot: !this.config.projectsRoot || fs.existsSync(this.config.projectsRoot),
      jobQueue: Boolean(this.jobQueue),
      projectRegistry: Boolean(this.projects),
      sseManager: Boolean(this.sse),
    };

    return {
      ready: Object.values(checks).every(Boolean),
      checks,
    };
  }

  private registerAllRoutes(): void {
    this.routes.push(...createSystemRoutes(() => this.readiness()));
    this.routes.push(...createConfigRoutes(this.config));
    this.routes.push(...createProjectRoutes(this.projects));
    this.routes.push(...createJobRoutes(this.projects, this.jobs, this.sse));
    this.routes.push(...createSearchRoutes(this.projects, this.searchService));
    this.routes.push(...createCodeRoutes(this.projects, this.codeService, this.contextService));
    this.routes.push(...createVisualizationRoutes(this.projects, this.lodService));
    this.routes.push(...createAuthRoutes(this.apiKeyStore));
    this.routes.push(...createSourceRoutes(this.projects, this.sourceSyncService));
    this.routes.push(...createAnalysisRoutes(this.projects, this.impactEngine, this.archEngine, this.mutationSimulator));
    this.routes.push(...createHistoryRoutes(this.projects, this.historyMiner));
    this.routes.push(...createProviderRoutes(this.embeddingProviders));
    this.routes.push(...createFsRoutes(this.config.projectsRoot ?? process.cwd()));
    this.routes.push(
      ...createChatRoutes(this.projects, this.chatService, this.llmConfig, this.embeddingProviders)
    );
  }

  addRoute(route: RouteDefinition): void {
    this.routes.push(route);
  }

  async start(): Promise<{ port: number; host: string; url: string }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch(error => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        });
      });

      this.server.once('error', reject);
      this.server.listen(this.config.port, this.config.host, () => {
        const address = this.server?.address();
        const boundPort = typeof address === 'object' && address ? address.port : this.config.port;
        const boundHost = this.config.host;
        resolve({
          port: boundPort,
          host: boundHost,
          url: `http://${boundHost}:${boundPort}`,
        });
      });
    });
  }

  async stop(): Promise<void> {
    this.projects.dispose();
    this.sse.close();
    this.ws.close();
    if (this.config.projectsRoot) {
      await this.tracer.flush(path.join(this.config.projectsRoot, '.agent', 'telemetry', 'spans.json'));
    }
    if (this.server) {
      await new Promise<void>(resolve => {
        this.server?.close(() => resolve());
      });
      this.server = undefined;
    }
  }

  private authContext(auth: { authenticated: boolean; token?: string }): AuthContext {
    if (!auth.authenticated) {
      return {
        authenticated: false,
        permissions: [],
        resourceScope: '*',
      };
    }

    if (auth.token) {
      const record = this.apiKeyStore.verifyToken(auth.token);
      if (record) {
        return {
          authenticated: true,
          keyId: record.id,
          name: record.name,
          role: record.role,
          permissions: record.permissions,
          resourceScope: record.resourceScope,
        };
      }
    }

    /* A locally constructed server without a token is an explicit local
       profile. The CLI always supplies a bootstrap token. */
    return {
      authenticated: true,
      role: 'Admin',
      permissions: ROLE_DEFAULT_PERMISSIONS.Admin,
      resourceScope: '*',
    };
  }

  private defaultPermission(method: string): PermissionScope {
    return method === 'GET' ? 'project:read' : 'project:write';
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.security.applySecurityHeaders(res, req);

    /*
    | بررسی Origin پیش از preflight انجام می‌شود: یک `OPTIONS` که با
    | ۲۰۴ جواب بگیرد، به مرورگر می‌گوید ادامه بده.
    */
    const originCheck = this.security.checkOrigin(req);
    if (!originCheck.ok) {
      res.writeHead(originCheck.status || 403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: originCheck.error }));
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const connCheck = this.security.checkConnection(req);
    if (!connCheck.ok) {
      res.writeHead(connCheck.status || 403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: connCheck.error }));
      return;
    }

    const parsedUrl = url.parse(req.url || '/', true);
    const pathname = parsedUrl.pathname || '/';
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsedUrl.query)) {
      if (typeof v === 'string') query[k] = v;
      else if (Array.isArray(v)) query[k] = v[0] || '';
    }

    const match = this.matchRoute(req.method || 'GET', pathname);
    if (!match) {
      // Attempt static file serving if GET and staticDir exists
      if (req.method === 'GET') {
        const served = await this.serveStatic(pathname, res);
        if (served) return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Route not found: ${req.method} ${pathname}` }));
      return;
    }

    const { route, params } = match;

    /*
    | احراز هویت پیش‌فرض است؛ فقط مسیری که صریحاً `requireAuth: false`
    | نوشته باشد باز است. جزئیاتش در RouteDefinition.
    */
    const candidateAuth = this.security.authenticate(req, query.token);
    const apiKeyAuth =
      !candidateAuth.authenticated && candidateAuth.token
        ? this.apiKeyStore.verifyToken(candidateAuth.token)
        : null;
    const auth = apiKeyAuth
      ? { authenticated: true, token: candidateAuth.token }
      : candidateAuth;
    const authContext = this.authContext(auth);
    if (route.requireAuth !== false && !auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: valid token is required' }));
      return;
    }

    let body: unknown = undefined;
    if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
      try {
        body = await this.readBody(req, this.config.maxBodyBytes || 5 * 1024 * 1024);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
        return;
      }

      if (route.schema && body !== undefined) {
        const schemaValidation = this.security.validateSchema(route.schema, body);
        if (!schemaValidation.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Validation failed', details: schemaValidation.errors }));
          return;
        }
      }
    }

    if (route.requireAuth !== false) {
      const permission =
        route.permission || this.defaultPermission(req.method || 'GET');
      const bodyProjectId =
        body && typeof body === 'object' && !Array.isArray(body)
          ? String((body as Record<string, unknown>).projectId || '')
          : '';
      const targetProjectId = params.id || bodyProjectId || undefined;
      const permissionCheck = PermissionChecker.hasPermission(
        authContext,
        permission,
        targetProjectId
      );

      if (!permissionCheck.allowed) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: permissionCheck.reason || 'Forbidden' }));
        return;
      }
    }

    const context: HttpRequestContext = {
      req,
      res,
      method: req.method || 'GET',
      path: pathname,
      query,
      params,
      body,
      token: auth.token,
      authenticated: auth.authenticated,
      auth: authContext,
    };

    const responseData = await route.handler(context);

    if (responseData && !res.headersSent) {
      const status = responseData.status || 200;
      if (responseData.headers) {
        for (const [hName, hVal] of Object.entries(responseData.headers)) {
          res.setHeader(hName, hVal);
        }
      }

      if (responseData.json !== undefined) {
        const masked = this.security.maskSecrets(responseData.json);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(masked));
      } else if (responseData.text !== undefined) {
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end(responseData.text);
      } else {
        res.writeHead(status);
        res.end();
      }
    }
  }

  private matchRoute(method: string, pathname: string): { route: RouteDefinition; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;

      const params = this.matchPattern(route.pattern, pathname);
      if (params !== null) {
        return { route, params };
      }
    }
    return null;
  }

  private matchPattern(pattern: string, pathname: string): Record<string, string> | null {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);

    if (patternParts.length !== pathParts.length) {
      return null;
    }

    const params: Record<string, string> = {};
    for (let i = 0; i < patternParts.length; i++) {
      const pPart = patternParts[i]!;
      const aPart = pathParts[i]!;

      if (pPart.startsWith(':')) {
        params[pPart.slice(1)] = decodeURIComponent(aPart);
      } else if (pPart !== aPart) {
        return null;
      }
    }

    return params;
  }

  private readBody(req: http.IncomingMessage, maxBytes: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          reject(new Error(`Payload too large. Limit is ${maxBytes} bytes.`));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (chunks.length === 0) {
          resolve(undefined);
          return;
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('Invalid JSON payload'));
        }
      });

      req.on('error', reject);
    });
  }

  /*
  | SE-PERF-01 — این تابع برای هر دارایی ایستا (html، css، js، فونت)
  | پنج `existsSync` می‌زد تا پوشه را پیدا کند، بعد `statSync` و بعد
  | کل فایل را همگام می‌خواند. هر کدام از این‌ها event loop را نگه
  | می‌داشت، و بارگذاری یک صفحه ده‌ها بار صدایش می‌زند.
  |
  | مسیر پوشه یک بار پیدا و کش می‌شود، و خواندن فایل ناهمگام است.
  */
  private staticDirCache: string | null | undefined;

  private async resolveStaticDir(): Promise<string | null> {
    if (this.staticDirCache !== undefined) return this.staticDirCache;

    const candidates = [
      this.config.staticDir,
      path.join(__dirname, '..', '..', 'public'),
      path.join(__dirname, '..', 'public'),
      path.join(__dirname, 'public'),
      path.join(__dirname, '..', '..', '..', 'web', 'public'),
    ].filter((p): p is string => Boolean(p));

    for (const candidate of candidates) {
      try {
        await fs.promises.access(candidate);
        this.staticDirCache = candidate;
        return candidate;
      } catch {
        /* try the next one */
      }
    }

    this.staticDirCache = null;
    return null;
  }

  private async serveStatic(pathname: string, res: http.ServerResponse): Promise<boolean> {
    const staticDir = await this.resolveStaticDir();
    if (!staticDir) return false;

    let targetFile = pathname;
    // SE-UI-07: صفحهٔ ورود حالا «باز کردن/پیکربندی پروژه» است تا کاربر
    // بتواند بدون ایندکس قبلی هم پروژه را باز و ایندکس کند. Visualizer
    // با /visualizer یا /visualizer.html در دسترس است.
    if (targetFile === '/' || targetFile === '/index.html' || targetFile === '/open') {
      targetFile = '/open.html';
    } else if (targetFile === '/visualizer') {
      targetFile = '/visualizer.html';
    }

    const resolved = path.resolve(staticDir, targetFile.replace(/^\//, ''));
    if (!resolved.startsWith(path.resolve(staticDir))) {
      return false;
    }

    try {
      const stat = await fs.promises.stat(resolved);
      if (!stat.isFile()) return false;

      const ext = path.extname(resolved).toLowerCase();
      const mime = (MIME_TYPES as Record<string, string>)[ext] || 'application/octet-stream';
      const content = await fs.promises.readFile(resolved);

      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': content.length,
        'Cache-Control': 'no-cache',
      });
      res.end(content);
      return true;
    } catch {
      return false;
    }
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

