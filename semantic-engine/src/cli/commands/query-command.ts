/**
 * `semantic-engine query` — MIG-53.
 *
 * روی همان `AiToolRegistry` که سرور MCP استفاده می‌کند. هر ابزاری که
 * آن‌جا ثبت شود، این‌جا هم بدون تغییر کد در دسترس است.
 */

import * as fs from 'fs';
import { AiToolRegistry } from '../../ai/AiToolRegistry';
import { ProjectIndexReader } from '../../ai/ProjectIndexReader';
import { ProjectIndex } from '../../core/types/project-index.types';
import { EXIT, ParsedArgs, stringOption } from '../args';
import { CommandContext, CommandResult } from './types';
import { normalizeWorkspaceRoot, resolveProjectIndexPath, workspaceRootFromIndex } from '../../core/config/ProjectPaths';
import { migrateLegacyArtifacts } from '../../core/config/migrateLegacyArtifacts';
import { indexLookupFromArgs } from '../projectPathsFromArgs';

/** گزینه‌هایی که خودِ CLI مصرف می‌کند و پارامتر ابزار نیستند. */
const RESERVED = new Set(['index', 'json', 'root', 'help', 'version']);

export async function runQuery(args: ParsedArgs, context: CommandContext): Promise<CommandResult> {
  const root = normalizeWorkspaceRoot(stringOption(args.options, 'root') ?? context.cwd);
  const lookup = indexLookupFromArgs(args, root);
  migrateLegacyArtifacts({
    workspaceRoot: root,
    projectId: lookup.projectId ?? '',
    location: lookup.location,
    ...(lookup.dataRoot !== undefined ? { dataRoot: lookup.dataRoot } : {}),
  });
  const indexPath = resolveProjectIndexPath(root, stringOption(args.options, 'index'), lookup);

  if (!fs.existsSync(indexPath)) {
    return {
      code: EXIT.failure,
      error:
        `index not found: ${indexPath}\n` +
        `run "semantic-engine index" first, or pass --index <path>`,
    };
  }

  let projectIndex: ProjectIndex;
  try {
    projectIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as ProjectIndex;
  } catch (error) {
    return {
      code: EXIT.failure,
      error: `index is not readable JSON: ${indexPath}\n${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  /*
  | SE-EXP-05: `rootPath` مسیر واقعی است؛ `root` فقط نام کوتاه پروژه.
  | دادنِ `root` به‌عنوان workspaceRoot یعنی هر ابزاری که فایل
  | می‌خواند، به یک مسیر بی‌معنا نگاه کند.
  */
  const workspaceRoot = stringOption(args.options, 'root')
    ? root
    : workspaceRootFromIndex(projectIndex, indexPath);

  const registry = new AiToolRegistry({
    reader: new ProjectIndexReader(projectIndex),
    workspaceRoot,
  });

  const toolName = args.positional[0];
  if (!toolName) {
    const tools = registry.list();
    return {
      code: EXIT.ok,
      json: { ok: true, tools: tools.map(tool => ({ name: tool.name, description: tool.description })) },
      text: tools.map(tool => `${tool.name.padEnd(22)} ${tool.description}`).join('\n'),
    };
  }

  if (!registry.get(toolName)) {
    const available = registry.list().map(tool => tool.name).join(', ');
    return {
      code: EXIT.usage,
      error: `unknown tool: ${toolName}\navailable: ${available}`,
    };
  }

  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args.options)) {
    if (RESERVED.has(key)) continue;
    params[key] = value;
  }

  const result = await registry.execute(toolName, params);

  const payload = {
    items: result.items,
    ...(result.context !== undefined ? { context: result.context } : {}),
    ...(result.metadata !== undefined ? { metadata: result.metadata } : {}),
  };

  return {
    code: result.success ? EXIT.ok : EXIT.failure,
    json: { ok: result.success, result: payload, ...(result.error ? { error: result.error } : {}) },
    ...(result.success
      ? { text: JSON.stringify(payload, null, 2) }
      : { error: result.error ?? 'tool failed' }),
  };
}
