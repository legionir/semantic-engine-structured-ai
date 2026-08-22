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
  private readonly registry: AiToolRegistry;
  private transport?: StdioServerTransport;

  constructor(options: McpServerOptions) {
    const reader = new ProjectIndexReader(options.projectIndex);
    this.registry = new AiToolRegistry({
      reader,
      workspaceRoot: options.workspaceRoot,
      projectHash: options.projectIndex.generatedAt,
      enableCache: true,
      ...(options.blueprint ? { blueprint: options.blueprint } : {}),
    });

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
    await this.server.close();
  }
}
