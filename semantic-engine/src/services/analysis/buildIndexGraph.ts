/**
 * buildIndexGraph — یک گراف، نه یکی به‌ازای هر ابزار.
 *
 * `simulate_mutation` و `detect_architecture_violations` هر دو همین گراف را
 * دستی و کمی متفاوت می‌ساختند، و هر دو **فقط سمبل‌ها** را node می‌کردند. ولی
 * سرِ و انتهای یال‌ها همیشه سمبل نیست:
 *
 *   • `graphs.dependencyGraph` بین **فایل‌ها** است (`from`/`to`شناسهٔ فایل)،
 *   • `graphs.callGraph` وقتی فراخوانی در سطح ماژول باشد `callerKind: "file"`
 *     دارد و شناسهٔ caller یک fileId است،
 *   • مقصد یک یال هم می‌تواند فقط یک نام خارجی باشد (`console.log`) که هیچ
 *     سمبلی برایش وجود ندارد.
 *
 * دو نشانهٔ همین نقص، در خروجی‌های واقعی دیده می‌شد:
 *
 *   • `callerFile: "unknown"` در `simulate_mutation` — node فایل هرگز
 *     اضافه نشده بود، پس `getNode(fileId)` تعریف‌نشده برمی‌گشت؛
 *   • چرخه‌هایی در `detect_architecture_violations` که فقط با سه هش
 *     گزارش می‌شدند، درحالی‌که مسیر فایل‌هایشان دقیقاً در همان ایندکس بود.
 *
 * این‌جا یک بار ساخته می‌شود تا دو پیاده‌سازی برای یک سؤال دو جواب ندهند.
 */

import { AnalysisGraph, AnalysisNode } from './AnalysisGraph';
import type { ProjectIndexReader } from '../../ai/ProjectIndexReader';

export interface BuildIndexGraphOptions {
  /**
   * یال‌های call graph هم اضافه شوند؟
   *
   * پیش‌فرض **خاموش**. `simulate_mutation` آن‌ها را می‌خواهد (یک rename حتی
   * وقتی هیچ import عوض نمی‌شود می‌تواند فراخوان‌ها را بشکند)، ولی
   * `detect_architecture_violations` روی «قاعدهٔ معماری» حرف می‌زند:
   * دور‌شدنِ import بین ماژول‌ها. با یال‌های فراخوانی، هر recursive شدنِ
   * درون‌فایلی — `World.clear → destroyEntity → clear` — «چرخهٔ وابستگی»
   * گزارش می‌شد و سیگنال اصلی زیر نویز گم می‌شد (اندازه‌گیری‌شده: ۱ چرخهٔ
   * واقعی در برابر ۴، که سه‌تای آخرش بازگشت درون‌فایلی بود).
   */
  readonly callEdges?: boolean;
}

/** شناسه‌های غیرسمبل (فایل/نام خارجی) هم node می‌گیرند، با label خوانا. */
export function buildIndexGraph(
  reader: ProjectIndexReader,
  options: BuildIndexGraphOptions = {}
): AnalysisGraph {
  const graph = new AnalysisGraph();
  const index = reader.projectIndex;

  for (const file of reader.getAllFiles()) {
    graph.addNode({
      id: file.id,
      type: 'file',
      label: file.path,
      metadata: { path: file.path, role: file.role ?? null, lines: file.lines },
    });
  }

  for (const symbol of reader.getAllSymbols()) {
    const file = reader.getFileById(symbol.fileId);
    graph.addNode({
      id: symbol.id,
      type: symbol.kind || 'symbol',
      label: symbol.name,
      metadata: { path: file?.path, line: symbol.line, fullyQualifiedName: symbol.fullyQualifiedName },
    });
  }

  for (const [idx, dep] of (index.graphs?.dependencyGraph ?? []).entries()) {
    graph.addEdge({
      id: `e_${idx}`,
      source: dep.from,
      target: dep.to,
      relation: 'depends_on',
      metadata: {
        confidence: dep.provenance?.confidence ?? 0,
        line: dep.provenance?.location?.line ?? null,
      },
    });
  }

  /*
  | یک rename/delete حتی وقتی هیچ یال import عوض نمی‌شود می‌تواند فراخوان‌ها
  | را بشکند — پس call graph هم داخل گراف می‌آید (آن چیزی که پیاده‌سازی اول
  | جا انداخته بود و هر سمبل دارای caller را «امن» گزارش می‌کرد).
  |
  | فقط برای ابزاری که واقعاً فراخوان می‌پرسد؛ برای قاعدهٔ معماری خاموش است
  | (بالا، `callEdges` را ببینید).
  */
  if (options.callEdges !== true) return graph;

  for (const [idx, call] of (index.graphs?.callGraph ?? []).entries()) {
    graph.addEdge({
      id: `call_${idx}`,
      source: call.caller,
      target: call.callee,
      relation: 'calls',
      /*
      | `line` همان جایی است که می‌شکند. بدون آن، «۱۲ ارجاع شکسته» یعنی
      | دوازده سطر یکسان که هیچ‌کس نمی‌تواند بینشان تمایزی قائل شود.
      */
      metadata: { confidence: call.provenance?.confidence ?? 0, line: call.line ?? null },
    });
  }

  /*
  | یال‌هایی که سرِ آن‌ها نام خارجی است (`console.log`) یا انتهای آن‌ها به
  | pkg: می‌رسد، node از پیش‌سازندهٔ گراف نمی‌گیرند؛ `addEdge` خودش placeholder
  | می‌سازد و label همان نام می‌ماند — که خوانا‌تر از یک شناسهٔ بی‌نام است.
  */
  return graph;
}

/** توصیف خوانای یک گره: «نام» در «مسیر»، به‌جای شناسهٔ هش. */
export function describeNode(graph: AnalysisGraph, id: string): string {
  const node: AnalysisNode | undefined = graph.getNode(id);
  if (!node) return id;
  const path = node.metadata?.path;
  if (node.type === 'file') return path ?? node.label;
  const line = typeof node.metadata?.line === 'number' ? `:${node.metadata.line}` : '';
  return path ? `${path}${line} → ${node.label}` : node.label;
}

/** مسیر فایل یک گره، اگر معلوم باشد. */
export function nodePath(graph: AnalysisGraph, id: string): string | undefined {
  return graph.getNode(id)?.metadata?.path ?? undefined;
}
