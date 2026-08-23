/**
 * SemanticEngineMcpServer — MCP server با استفاده از SDK رسمی @modelcontextprotocol/sdk.
 *
 * Transport: stdio (default) یا SSE (future).
 * قابلیت‌ها:
 * - tools/list
 * - tools/call
 *
 * برای استفاده در CLI:
 *   node dist/ai/mcp/SemanticEngineMcpServer.js <path-to-project-index.json>
 */

import * as fs from 'fs';
import * as path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ProjectIndexReader } from '../ProjectIndexReader';
import { AiToolRegistry } from '../AiToolRegistry';
import type { BlueprintIndex } from '../discovery/BlueprintIndex';
import { AiToolInput } from '../tools/types';
import { ProjectIndex } from '../../core/types/project-index.types';
import { resolveProjectIndexPath } from '../../core/config/ProjectPaths';
import { loadBlueprintBeside } from '../discovery/loadBlueprint';

export interface McpServerOptions {
  readonly projectIndex: ProjectIndex;
  readonly workspaceRoot?: string;
  /**
   * blueprint، اگر کنار project-index پیدا شد.
   *
   * SE-BP-06 — تا فاز ۴۳ blueprint نوشته می‌شد و هرگز خوانده
   * نمی‌شد. حالا `discover_context` از آن به‌عنوان منبع دومِ دانه
   * استفاده می‌کند.
   */
  readonly blueprint?: BlueprintIndex;
}

export class SemanticEngineMcpServer {
  private readonly server: Server;
  private registry: AiToolRegistry;
  private readonly workspaceRoot?: string;
  private transport?: StdioServerTransport;
  private indexWatcher?: fs.FSWatcher;
  private reloadTimer?: NodeJS.Timeout;
  private watchedIndexPath?: string;

  constructor(options: McpServerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.registry = this.createRegistry(options.projectIndex, options.blueprint);

    this.server = new Server(
      {
        name: 'semantic-engine',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerHandlers();
  }

  private createRegistry(projectIndex: ProjectIndex, blueprint?: BlueprintIndex): AiToolRegistry {
    const reader = new ProjectIndexReader(projectIndex);
    return new AiToolRegistry({
      reader,
      workspaceRoot: this.workspaceRoot,
      projectHash: projectIndex.generatedAt,
      enableCache: true,
      ...(blueprint ? { blueprint } : {}),
    });
  }

  /**
   * تعویض snapshot داخل سرور بدون قطع transport.
   */
  reload(projectIndex: ProjectIndex, blueprint?: BlueprintIndex): void {
    this.registry = this.createRegistry(projectIndex, blueprint);
  }

  /**
   * دنبال‌کردن آرتیفکت‌های watch شده. نوشتن OutputWriter اتمیک است و
   * ممکن است ابتدا rename فایل موقت و سپس تغییر فایل نهایی را گزارش
   * کند؛ debounce کوتاه اجازه می‌دهد هر دو رویداد یک reload شوند.
   */
  watchIndexFile(indexPath = resolveProjectIndexPath(this.workspaceRoot ?? process.cwd())): void {
    const absoluteIndexPath = path.resolve(indexPath);
    if (this.indexWatcher || !fs.existsSync(path.dirname(absoluteIndexPath))) return;

    this.watchedIndexPath = absoluteIndexPath;
    const directory = path.dirname(absoluteIndexPath);
    const indexName = path.basename(absoluteIndexPath);

    try {
      this.indexWatcher = fs.watch(directory, (event, filename) => {
        const changed = filename ? String(filename) : '';
        if (!changed || changed === indexName || changed === 'blueprint.json' || changed === 'project-artifacts.manifest.json') {
          this.scheduleReload();
        }
      });
      this.indexWatcher.on('error', () => {
        /* شکست watcher نباید transport MCP را از کار بیندازد. */
      });
    } catch {
      this.indexWatcher = undefined;
    }
  }

  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined;
      this.reloadFromDisk();
    }, 75);
    this.reloadTimer.unref?.();
  }

  private reloadFromDisk(): void {
    const indexPath = this.watchedIndexPath;
    if (!indexPath || !fs.existsSync(indexPath)) return;

    try {
      const projectIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as ProjectIndex;
      const loaded = loadBlueprintBeside(indexPath);
      this.reload(projectIndex, loaded.index ?? undefined);
    } catch {
      /* هنگام تعویض اتمیک فایل ممکن است snapshot موقتاً ناقص باشد. */
      this.scheduleReload();
    }
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = this.registry.list().map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Tool['inputSchema'],
      }));
      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = (request.params.arguments ?? {}) as AiToolInput;

      try {
        const result = await this.registry.executeWithValidation(toolName, args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
          isError: !result.success,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: false, error: message, items: [] }),
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * شروع server روی stdio.
   */
  async start(): Promise<void> {
    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);
  }

  /**
   * اتصال server به یک transport سفارشی (مثل HTTP/SSE).
   */
  async connectTransport(transport: Transport): Promise<void> {
    this.transport = transport as StdioServerTransport;
    await this.server.connect(transport);
  }

  async close(): Promise<void> {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
    this.indexWatcher?.close();
    this.indexWatcher = undefined;
    await this.server.close();
  }
}
