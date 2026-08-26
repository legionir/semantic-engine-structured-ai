/**
 * Platform Core V1 — Server Types & Route Contracts.
 */

import * as http from 'http';
import { AuthContext, PermissionScope } from '../security/rbac/types';

export interface HttpRequestContext {
  readonly req: http.IncomingMessage;
  readonly res: http.ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly params: Record<string, string>;
  readonly body?: unknown;
  readonly token?: string;
  readonly authenticated: boolean;
  readonly auth: AuthContext;
}

export type RouteHandler = (context: HttpRequestContext) => Promise<void | HttpResponseData>;

export interface HttpResponseData {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly json?: unknown;
  readonly text?: string;
}

export interface RouteDefinition {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
  readonly pattern: string; // e.g. '/api/v1/projects/:id/symbols/:symbolId'
  readonly handler: RouteHandler;
  /**
   * آیا این مسیر توکن می‌خواهد؟
   *
   * ── چرا حالا پیش‌فرضش `true` است ─────────────────────────────────
   *
   * قبلاً این فیلد opt-in بود: هر مسیری که یادش می‌رفت بنویسدش، باز
   * می‌ماند. شمرده شد: ۲۵ مسیر در ۷ فایل بدون احراز هویت بودند —
   * از جمله `/api/v1/fs/browse` که کل فایل‌سیستم ماشین را لیست
   * می‌کرد، و `/api/v1/providers/models` که به هر URL دلخواه درخواست
   * می‌زد.
   *
   * فراموش کردن یک فیلد نباید به «بدون احراز هویت» ترجمه شود، پس
   * حالا نبودنش یعنی `true` و باز گذاشتن یک مسیر باید صریح باشد.
   */
  readonly requireAuth?: boolean;
  /** Permission required after authentication. Omitted routes use a conservative method default. */
  readonly permission?: PermissionScope;
  readonly schema?: object;
}

export interface PlatformConfig {
  readonly port: number;
  readonly host: string;
  readonly token?: string;
  readonly allowRemote?: boolean;
  readonly maxBodyBytes?: number;
  readonly projectsRoot?: string;
  readonly staticDir?: string;
  /**
   * data root برای registry دائمی پروژه‌ها (`registry.json` و manifest هر
   * پروژه). وقتی داده نشود، registry فقط در حافظه نگه داشته می‌شود و چیزی
   * روی دیسک نوشته نمی‌شود — که برای تست‌ها رفتار درست است.
   */
  readonly dataRoot?: string;
}

// ── Graph View Model Types ───────────────────────────────────────────────

export type NodeType =
  | 'project'
  | 'module'
  | 'file'
  | 'class'
  | 'function'
  | 'method'
  | 'interface'
  | 'struct'
  | 'trait'
  | 'api'
  | 'workflow'
  | 'business_entity';

export interface GraphNode {
  readonly id: string;
  readonly type: NodeType;
  readonly label: string;
  readonly parentId?: string;
  readonly metadata: {
    readonly path?: string;
    readonly line?: number;
    readonly endLine?: number;
    readonly language?: string;
    readonly role?: string;
    readonly complexity?: number;
    readonly importance?: number;
    readonly referencesCount?: number;
    readonly isEntryPoint?: boolean;
  };
}

export type EdgeRelation =
  | 'contains'
  | 'imports'
  | 'calls'
  | 'references'
  | 'extends'
  | 'implements'
  | 'depends_on'
  | 'uses'
  | 'executes';

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: EdgeRelation;
  readonly metadata: {
    readonly confidence: number;
    readonly basis: 'resolved' | 'name-match' | 'transitive' | 'blueprint';
    readonly sourceKind: 'compiler' | 'tree-sitter' | 'heuristic' | 'inferred';
    readonly line?: number;
  };
}

export interface SubgraphResponse {
  readonly level: 'architecture' | 'module' | 'file' | 'symbol' | 'neighborhood' | 'workflow';
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly summary: {
    readonly totalNodes: number;
    readonly totalEdges: number;
    readonly confidentRatio: number;
  };
}

export interface IndexJobStatus {
  readonly jobId: string;
  readonly projectId: string;
  readonly status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly phase: string;
  readonly progress: number;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly error?: string;
  readonly result?: unknown;
}
